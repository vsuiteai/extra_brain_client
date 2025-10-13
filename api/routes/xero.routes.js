import fp from 'fastify-plugin';
import { xeroConnect, xeroCallback, getAccounts, getContacts, getItems, getInvoices, getPayments, getJournals } from '../controllers/xero.controllers.js';

export default fp(async (fastify) => {
  fastify.get('/api/integrations/xero/connect', { preHandler: [fastify.authenticate] }, xeroConnect);
  fastify.get('/api/integrations/xero/callback', xeroCallback);
  fastify.get('/api/integrations/xero/accounts', { preHandler: [fastify.authenticate] }, getAccounts);
  fastify.get('/api/integrations/xero/contacts', { preHandler: [fastify.authenticate] }, getContacts);
  fastify.get('/api/integrations/xero/items', { preHandler: [fastify.authenticate] }, getItems);
  fastify.get('/api/integrations/xero/invoices', { preHandler: [fastify.authenticate] }, getInvoices);
  fastify.get('/api/integrations/xero/payments', { preHandler: [fastify.authenticate] }, getPayments);
  fastify.get('/api/integrations/xero/journals', { preHandler: [fastify.authenticate] }, getJournals);
});


