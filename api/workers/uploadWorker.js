import { db } from '../firestore.js';
import { Storage } from '@google-cloud/storage';
import { parseFileWithMapping, toNumber, toOptionalNumber, normalizeMonth } from '../lib/uploadUtils.js';

const storage = new Storage();
const BUCKET_NAME = 'vsuite-objects';

export async function processUpload(uploadId, mapping, options) {
  const uploadDoc = await db.collection('uploads').doc(uploadId).get();
  if (!uploadDoc.exists) return;

  const upload = uploadDoc.data();

  await db.collection('uploads').doc(uploadId).update({
    status: 'processing'
  });

  try {
    // Download file from GCS
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(upload.storagePath);
    const [buffer] = await file.download();

    // Parse rows
    const rows = await parseFileWithMapping(buffer, upload.filename, options);

    let count = 0;

    for (const row of rows) {
      const monthRaw = row[mapping.month];
      const revenueRaw = row[mapping.revenue];

      if (!monthRaw || revenueRaw == null || revenueRaw === '') continue;

      const month = normalizeMonth(monthRaw, options.dateFormat);
      if (!month) continue;

      const revenue = toNumber(revenueRaw);
      const cogs = mapping.cogs != null ? toNumber(row[mapping.cogs]) : 0;
      const opex = mapping.opex != null ? toNumber(row[mapping.opex]) : 0;
      const ebitda = mapping.ebitda != null
        ? toNumber(row[mapping.ebitda])
        : revenue - cogs - opex;

      const cash = mapping.cash != null ? toOptionalNumber(row[mapping.cash]) : null;
      const ar = mapping.ar != null ? toOptionalNumber(row[mapping.ar]) : null;
      const ap = mapping.ap != null ? toOptionalNumber(row[mapping.ap]) : null;
      const inventory = mapping.inventory != null ? toOptionalNumber(row[mapping.inventory]) : null;

      const arDays = ar && revenue > 0 ? (ar / revenue) * 365 : null;
      const apDays = ap && cogs > 0 ? (ap / cogs) * 365 : null;
      const inventoryDays = inventory && cogs > 0 ? (inventory / cogs) * 365 : null;

      // Upsert into FinancialSnapshotMonthly
      const docId = `${upload.tenantId}_${month}`;
      await db.collection('financialSnapshotMonthly').doc(docId).set({
        id: docId,
        tenantId: upload.tenantId,
        month,
        revenue,
        cogs,
        opex,
        ebitda,
        cash,
        arDays,
        apDays,
        inventoryDays,
        source: 'upload',
        updatedAt: new Date()
      }, { merge: true });

      count++;
    }

    // Calculate aggregated financials
    const latestMonth = rows.map(row => normalizeMonth(row[mapping.month], options.dateFormat)).filter(Boolean).sort().pop();
    const latestRow = rows.find(row => normalizeMonth(row[mapping.month], options.dateFormat) === latestMonth);
    
    if (latestRow) {
      const revenue = toNumber(latestRow[mapping.revenue]);
      const cogs = mapping.cogs != null ? toNumber(latestRow[mapping.cogs]) : 0;
      const opex = mapping.opex != null ? toNumber(latestRow[mapping.opex]) : 0;
      const ebitda = mapping.ebitda != null ? toNumber(latestRow[mapping.ebitda]) : revenue - cogs - opex;
      
      await db.collection('companies').doc(upload.tenantId).set({
        Financials: {
          Revenue: revenue,
          COGS: cogs,
          OPEX: opex,
          EBITDA: ebitda
        },
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }

    await db.collection('uploads').doc(uploadId).update({
      status: 'succeeded',
      processedAt: new Date(),
      rowCount: count,
      errorMessage: null
    });
  } catch (err) {
    console.error('Upload processing error:', err);
    await db.collection('uploads').doc(uploadId).update({
      status: 'failed',
      errorMessage: err.message || 'Unknown error'
    });
    throw err;
  }
}
