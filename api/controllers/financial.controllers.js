import { db } from '../firestore.js';

// GET /api/financial/summary
export async function getFinancialSummary(request, reply) {
  const { companyId } = request.query;
  if (!companyId) return reply.code(400).send({ error: 'companyId required' });

  const { startMonth, endMonth } = request.query;

  let query = db.collection('financialSnapshotMonthly')
    .where('tenantId', '==', companyId)
    .orderBy('month', 'desc');

  if (startMonth) query = query.where('month', '>=', startMonth);
  if (endMonth) query = query.where('month', '<=', endMonth);

  const snap = await query.get();
  const data = snap.docs.map(doc => doc.data());

  reply.send({ data });
}

// GET /api/financial/source
export async function getFinancialSource(request, reply) {
  const { companyId } = request.query;
  if (!companyId) return reply.code(400).send({ error: 'companyId required' });

  const snapshotSnap = await db.collection('financialSnapshotMonthly')
    .where('tenantId', '==', companyId)
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get();

  const uploadSnap = await db.collection('uploads')
    .where('tenantId', '==', companyId)
    .where('status', '==', 'succeeded')
    .orderBy('processedAt', 'desc')
    .limit(1)
    .get();

  const currentSource = snapshotSnap.empty ? null : snapshotSnap.docs[0].data().source;
  const lastUploadAt = uploadSnap.empty ? null : uploadSnap.docs[0].data().processedAt;

  reply.send({
    currentSource,
    lastUploadAt,
    lastIntegrationSyncAt: null // TODO: implement when integrations are syncing
  });
}
