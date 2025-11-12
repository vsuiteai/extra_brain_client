import fp from 'fastify-plugin';
import { getFinancialSummary, getFinancialSource } from '../controllers/financial.controllers.js';

export default fp(async (fastify) => {
  fastify.get('/api/financial/summary', { preHandler: [fastify.authenticate] }, getFinancialSummary);
  fastify.get('/api/financial/source', { preHandler: [fastify.authenticate] }, getFinancialSource);
});
