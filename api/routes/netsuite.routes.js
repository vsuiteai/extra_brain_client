import fp from 'fastify-plugin';
import { netsuiteConnect, netsuiteCallback, getNsAccounts, getNsJournals, getNsInvoices, getNsBills, getNsPayments, getNsCustomers, getNsVendors, getNsItems } from '../controllers/netsuite.controllers.js';

export default fp(async (fastify) => {
  fastify.get('/api/integrations/netsuite/connect', { preHandler: [fastify.authenticate] }, netsuiteConnect);
  fastify.get('/api/integrations/netsuite/callback', netsuiteCallback);
  fastify.get('/api/integrations/netsuite/accounts', { preHandler: [fastify.authenticate] }, getNsAccounts);
  fastify.get('/api/integrations/netsuite/journals', { preHandler: [fastify.authenticate] }, getNsJournals);
  fastify.get('/api/integrations/netsuite/invoices', { preHandler: [fastify.authenticate] }, getNsInvoices);
  fastify.get('/api/integrations/netsuite/bills', { preHandler: [fastify.authenticate] }, getNsBills);
  fastify.get('/api/integrations/netsuite/payments', { preHandler: [fastify.authenticate] }, getNsPayments);
  fastify.get('/api/integrations/netsuite/customers', { preHandler: [fastify.authenticate] }, getNsCustomers);
  fastify.get('/api/integrations/netsuite/vendors', { preHandler: [fastify.authenticate] }, getNsVendors);
  fastify.get('/api/integrations/netsuite/items', { preHandler: [fastify.authenticate] }, getNsItems);
});


