import fp from 'fastify-plugin';
import { analyzeUpload, commitUpload, getUploadStatus } from '../controllers/uploads.controllers.js';

export default fp(async (fastify) => {
  fastify.post('/api/uploads/financial/analyze', { preHandler: [fastify.authenticate] }, analyzeUpload);
  fastify.post('/api/uploads/financial/commit', { preHandler: [fastify.authenticate] }, commitUpload);
  fastify.get('/api/uploads/:uploadId', { preHandler: [fastify.authenticate] }, getUploadStatus);
});
