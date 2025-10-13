import fp from 'fastify-plugin';
import { qbConnect, qbCallback, getQbAccounts, getQbCustomers, getQbVendors, getQbItems, getQbInvoices, getQbBills, getQbPayments, getQbJournals, getQbGeneralLedger } from '../controllers/quickbooks.controllers.js';

export default fp(async (fastify) => {
  fastify.get('/api/integrations/quickbooks/connect', { preHandler: [fastify.authenticate] }, qbConnect);
  fastify.get('/api/integrations/quickbooks/callback', qbCallback);
  fastify.get('/api/integrations/quickbooks/accounts', { preHandler: [fastify.authenticate] }, getQbAccounts);
  fastify.get('/api/integrations/quickbooks/customers', { preHandler: [fastify.authenticate] }, getQbCustomers);
  fastify.get('/api/integrations/quickbooks/vendors', { preHandler: [fastify.authenticate] }, getQbVendors);
  fastify.get('/api/integrations/quickbooks/items', { preHandler: [fastify.authenticate] }, getQbItems);
  fastify.get('/api/integrations/quickbooks/invoices', { preHandler: [fastify.authenticate] }, getQbInvoices);
  fastify.get('/api/integrations/quickbooks/bills', { preHandler: [fastify.authenticate] }, getQbBills);
  fastify.get('/api/integrations/quickbooks/payments', { preHandler: [fastify.authenticate] }, getQbPayments);
  fastify.get('/api/integrations/quickbooks/journals', { preHandler: [fastify.authenticate] }, getQbJournals);
  fastify.get('/api/integrations/quickbooks/general-ledger', { preHandler: [fastify.authenticate] }, getQbGeneralLedger);
});


