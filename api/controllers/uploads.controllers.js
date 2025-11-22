import { db } from '../firestore.js';
import { Storage } from '@google-cloud/storage';
import { parseFileHeaders, suggestMapping } from '../lib/uploadUtils.js';
import { processUpload } from '../workers/uploadWorker.js';

const storage = new Storage();
const BUCKET_NAME = 'vsuite-objects';

// POST /api/uploads/financial/analyze
export async function analyzeUpload(request, reply) {
  const { companyId } = request.query;
  if (!companyId) return reply.code(400).send({ error: 'companyId required' });

  const data = await request.file();
  if (!data) return reply.code(400).send({ error: 'No file uploaded' });

  const uploadId = `upl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const ext = data.filename.split('.').pop();
  const storagePath = `uploads/${companyId}/${uploadId}.${ext}`;

  // Upload to GCS
  const bucket = storage.bucket(BUCKET_NAME);
  const file = bucket.file(storagePath);
  const buffer = await data.toBuffer();
  await file.save(buffer);

  // Create Upload record
  await db.collection('uploads').doc(uploadId).set({
    id: uploadId,
    tenantId: companyId,
    type: 'FinancialTemplateV1',
    filename: data.filename,
    storagePath,
    status: 'pending',
    createdAt: new Date()
  });

  // Parse headers and samples
  const { columns, options } = await parseFileHeaders(buffer, data.filename);

  // Get existing mapping if any
  const mappingSnap = await db.collection('uploadMappings')
    .where('tenantId', '==', companyId)
    .where('type', '==', 'FinancialTemplateV1')
    .limit(1)
    .get();

  let suggestedMappingResult;
  if (!mappingSnap.empty) {
    suggestedMappingResult = mappingSnap.docs[0].data().mapping;
  } else {
    suggestedMappingResult = await suggestMapping(columns.map(c => c.name));
  }

  reply.send({
    uploadId,
    columns,
    suggestedMapping: suggestedMappingResult,
    requiredFields: ['month', 'revenue'],
    optionsDefaults: options
  });
}

// POST /api/uploads/financial/commit
export async function commitUpload(request, reply) {
  const { companyId } = request.query;
  if (!companyId) return reply.code(400).send({ error: 'companyId required' });
  const { uploadId, mapping, options } = request.body;

  if (!uploadId || !mapping) {
    return reply.code(400).send({ error: 'uploadId and mapping required' });
  }

  // Validate upload belongs to tenant
  const uploadDoc = await db.collection('uploads').doc(uploadId).get();
  if (!uploadDoc.exists || uploadDoc.data().tenantId !== companyId) {
    return reply.code(404).send({ error: 'Upload not found' });
  }

  if (uploadDoc.data().status !== 'pending') {
    return reply.code(400).send({ error: 'Upload already processed' });
  }

  // Validate required fields
  if (mapping.month == null || mapping.revenue == null) {
    return reply.code(400).send({ error: 'month and revenue mapping required' });
  }

  // Save/update mapping
  const mappingSnap = await db.collection('uploadMappings')
    .where('tenantId', '==', companyId)
    .where('type', '==', 'FinancialTemplateV1')
    .limit(1)
    .get();

  const mappingData = {
    tenantId: companyId,
    type: 'FinancialTemplateV1',
    mapping,
    options,
    updatedAt: new Date()
  };

  if (mappingSnap.empty) {
    mappingData.createdAt = new Date();
    await db.collection('uploadMappings').add(mappingData);
  } else {
    await db.collection('uploadMappings').doc(mappingSnap.docs[0].id).update(mappingData);
  }

  // Process upload (async)
  processUpload(uploadId, mapping, options).catch(err => {
    console.error('Upload processing error:', err);
  });

  reply.send({ uploadId, status: 'queued' });
}

// GET /api/uploads/:uploadId
export async function getUploadStatus(request, reply) {
  const { uploadId } = request.params;
  const { companyId } = request.query;
  if (!companyId) return reply.code(400).send({ error: 'companyId required' });

  const doc = await db.collection('uploads').doc(uploadId).get();
  if (!doc.exists || doc.data().tenantId !== companyId) {
    return reply.code(404).send({ error: 'Upload not found' });
  }

  const data = doc.data();
  reply.send({
    id: data.id,
    type: data.type,
    status: data.status,
    rowCount: data.rowCount || null,
    errorMessage: data.errorMessage || null,
    processedAt: data.processedAt || null
  });
}
