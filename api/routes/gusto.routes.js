import fp from 'fastify-plugin';
import { gustoConnect, gustoCallback, gustoDisconnect, getGustoCompanies, getGustoCompany, getGustoEmployees, getGustoPayrolls, getGustoLocations, getGustoConnectionStatus } from '../controllers/gusto.controllers.js';

export default fp(async (fastify) => {
  fastify.get('/api/integrations/gusto/connect', { preHandler: [fastify.authenticate] }, gustoConnect);
  fastify.get('/api/integrations/gusto/callback', gustoCallback);
  fastify.post('/api/integrations/gusto/disconnect', { preHandler: [fastify.authenticate] }, gustoDisconnect);
  fastify.get('/api/integrations/gusto/status', { preHandler: [fastify.authenticate] }, getGustoConnectionStatus);
  fastify.get('/api/integrations/gusto/companies', { preHandler: [fastify.authenticate] }, getGustoCompanies);
  fastify.get('/api/integrations/gusto/company', { preHandler: [fastify.authenticate] }, getGustoCompany);
  fastify.get('/api/integrations/gusto/employees', { preHandler: [fastify.authenticate] }, getGustoEmployees);
  fastify.get('/api/integrations/gusto/payrolls', { preHandler: [fastify.authenticate] }, getGustoPayrolls);
  fastify.get('/api/integrations/gusto/locations', { preHandler: [fastify.authenticate] }, getGustoLocations);
});



