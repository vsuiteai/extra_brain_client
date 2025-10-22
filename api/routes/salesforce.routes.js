import fp from 'fastify-plugin';
import { salesforceConnect, salesforceCallback, getSfCustomers, getSfVendors, getSfItems, getSfInvoices, getSfBills, getSfPayments, getSfChartOfAccounts, getSfGeneralLedger, getSfConnectionStatus } from '../controllers/salesforce.controllers.js';

export default fp(async (fastify) => {
  fastify.get('/api/integrations/salesforce/connect', { preHandler: [fastify.authenticate] }, salesforceConnect);
  fastify.get('/api/integrations/salesforce/callback', salesforceCallback);
  fastify.get('/api/integrations/salesforce/status', { preHandler: [fastify.authenticate] }, getSfConnectionStatus);
  fastify.get('/api/integrations/salesforce/customers', { preHandler: [fastify.authenticate] }, getSfCustomers);
  fastify.get('/api/integrations/salesforce/vendors', { preHandler: [fastify.authenticate] }, getSfVendors);
  fastify.get('/api/integrations/salesforce/items', { preHandler: [fastify.authenticate] }, getSfItems);
  fastify.get('/api/integrations/salesforce/invoices', { preHandler: [fastify.authenticate] }, getSfInvoices);
  fastify.get('/api/integrations/salesforce/bills', { preHandler: [fastify.authenticate] }, getSfBills);
  fastify.get('/api/integrations/salesforce/payments', { preHandler: [fastify.authenticate] }, getSfPayments);
  fastify.get('/api/integrations/salesforce/chart-of-accounts', { preHandler: [fastify.authenticate] }, getSfChartOfAccounts);
  fastify.get('/api/integrations/salesforce/general-ledger', { preHandler: [fastify.authenticate] }, getSfGeneralLedger);
});


