import axios from 'axios';
import crypto from 'crypto';
import { db } from '../firestore.js';

function getSalesforceAuthorizeUrl() {
  const base = process.env.SALESFORCE_LOGIN_BASE_URL || 'https://login.salesforce.com';
  const url = new URL('/services/oauth2/authorize', base);
  return url.toString().replace(/\/$/, '');
}

function getSalesforceTokenUrl() {
  const base = process.env.SALESFORCE_LOGIN_BASE_URL || 'https://login.salesforce.com';
  const url = new URL('/services/oauth2/token', base);
  return url.toString();
}

function getRedirectUri() {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) throw new Error('Missing BASE_URL');
  return `${baseUrl}/api/integrations/salesforce/callback`;
}

function ensureClientCreds() {
  const clientId = process.env.SALESFORCE_CONSUMER_KEY;
  const clientSecret = process.env.SALESFORCE_CONSUMER_SECRET;
  if (!clientId || !clientSecret) throw new Error('Missing Salesforce env vars (SALESFORCE_CONSUMER_KEY, SALESFORCE_CONSUMER_SECRET)');
  return { clientId, clientSecret };
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateCodeVerifier() {
  return b64url(crypto.randomBytes(32));
}

function codeChallengeFromVerifier(verifier) {
  return b64url(crypto.createHash('sha256').update(verifier).digest());
}

export const salesforceConnect = async (req, reply) => {
  const userId = req.user?.id;
  const companyId = req.query?.companyId;
  try {
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const { clientId } = ensureClientCreds();
    const redirectUri = getRedirectUri();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = codeChallengeFromVerifier(codeVerifier);
    const state = await req.server.jwt.sign({ userId, companyId, codeVerifier }, { expiresIn: '10m' });

    const authorizeUrl = new URL(getSalesforceAuthorizeUrl());
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    const scopes = process.env.SALESFORCE_SCOPES || 'api,refresh_token,offline_access';
    authorizeUrl.searchParams.set('scope', scopes);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    return reply.code(200).send({ redirectUrl: authorizeUrl.toString() });
  } catch (e) {
    req.log.error(e, 'Salesforce connect error');
    return reply.code(500).send({ error: 'Failed to start Salesforce OAuth', details: e.message });
  }
};

export const salesforceCallback = async (req, reply) => {
  const { code, state } = req.query || {};
  if (!code || !state) return reply.code(400).send({ error: 'Missing code/state' });
  try {
    const decoded = await req.server.jwt.verify(state);
    const { userId, companyId, codeVerifier } = decoded || {};
    if (!userId) return reply.code(400).send({ error: 'Invalid state' });
    if (!codeVerifier) return reply.code(400).send({ error: 'Missing PKCE verifier in state' });

    const { clientId, clientSecret } = ensureClientCreds();
    const redirectUri = getRedirectUri();

    let companyData = null;
    let userData = null;
    try {
      if (companyId) {
        const companyDoc = await db.collection('companies').doc(companyId).get();
        companyData = { ...companyDoc.data(), id: companyDoc.id };
      }
      if (userId) {
        const userDoc = await db.collection('users').doc(userId).get();
        userData = { ...userDoc.data(), id: userDoc.id };
      }
    } catch(e) {
      console.log(e)
    }

    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('code', code);
    params.set('client_id', clientId);
    params.set('client_secret', clientSecret);
    params.set('redirect_uri', redirectUri);
    params.set('code_verifier', codeVerifier);

    const tokenRes = await axios.post(getSalesforceTokenUrl(), params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      instance_url: instanceUrl,
      id: idUrl,
      issued_at: issuedAt,
      scope,
      token_type: tokenType
    } = tokenRes.data || {};

    const expiresAt = Date.now() + (Number(process.env.SALESFORCE_ACCESS_TTL_SEC || 3600) * 1000);

    const docRef = db.collection('salesforce_connections').doc(userId);
    await docRef.set({
      userId,
      user: userData || null,
      companyId: companyId || null,
      company: companyData || null,
      instanceUrl: instanceUrl || null,
      idUrl: idUrl || null,
      scope: scope || null,
      tokenType: tokenType || 'Bearer',
      accessToken,
      refreshToken: refreshToken || null,
      expiresAt,
      issuedAt: issuedAt || null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return reply.redirect(`${process.env.FRONTEND_URL}/dashboard/settings?integration=salesforce&status=connected&instanceUrl=${instanceUrl}`, 302);
  } catch (e) {
    req.log.error(e, 'Salesforce callback error');
    return reply.code(500).send({ error: 'Failed to complete Salesforce OAuth', details: e.message });
  }
};

export const getSalesforceAccessToken = async ({ userId }) => {
  const snap = await db.collection('salesforce_connections').where('userId', '==', userId).limit(1).get();
  if (snap.empty) throw new Error('No Salesforce connection found');
  const data = snap.docs[0].data();

  if (Date.now() < (data.expiresAt - 60000)) {
    return data.accessToken;
  }

  if (!data.refreshToken) throw new Error('No refresh token stored for Salesforce');

  const { clientId, clientSecret } = ensureClientCreds();
  const params = new URLSearchParams();
  params.set('grant_type', 'refresh_token');
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  params.set('refresh_token', data.refreshToken);

  const tokenRes = await axios.post(getSalesforceTokenUrl(), params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  const { access_token: newAccess, issued_at: issuedAt } = tokenRes.data || {};
  const expiresAt = Date.now() + (Number(process.env.SALESFORCE_ACCESS_TTL_SEC || 3600) * 1000);

  await snap.docs[0].ref.update({
    accessToken: newAccess,
    expiresAt,
    issuedAt: issuedAt || data.issuedAt || null,
    updatedAt: new Date()
  });

  return newAccess;
};

export const getSalesforceContext = async (userId) => {
  const snap = await db.collection('salesforce_connections').where('userId', '==', userId).limit(1).get();
  if (snap.empty) throw new Error('No Salesforce connection found');
  const data = snap.docs[0].data();
  const accessToken = await getSalesforceAccessToken({ userId });
  const instanceUrl = data.instanceUrl;
  if (!instanceUrl) throw new Error('Missing Salesforce instanceUrl');
  return { accessToken, instanceUrl };
};


// ---- Helpers for querying Salesforce data ----
function getApiBase(instanceUrl) {
  const version = process.env.SALESFORCE_API_VERSION || 'v60.0';
  return `${instanceUrl}/services/data/${version}`;
}

async function sfRequest({ accessToken, instanceUrl, method = 'GET', path, params }) {
  const url = new URL(path.startsWith('http') ? path : `${getApiBase(instanceUrl)}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(String(k), String(v));
    });
  }
  const res = await axios({
    url: url.toString(),
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });
  return res.data;
}

async function listSObjects({ accessToken, instanceUrl }) {
  const data = await sfRequest({ accessToken, instanceUrl, path: '/sobjects' });
  const names = new Set((data?.sobjects || []).map(s => s?.name).filter(Boolean));
  return names;
}

// async function objectExists({ accessToken, instanceUrl }, objectName) {
//   try {
//     const names = await listSObjects({ accessToken, instanceUrl });
//     return names.has(objectName);
//   } catch {
//     return false;
//   }
// }

async function chooseFirstExistingObject(ctx, candidates) {
  const names = await listSObjects(ctx);
  for (const n of candidates) {
    if (names.has(n)) return n;
  }
  return null;
}

async function describeObject({ accessToken, instanceUrl }, objectName) {
  return await sfRequest({ accessToken, instanceUrl, path: `/sobjects/${encodeURIComponent(objectName)}/describe` });
}

async function selectAvailableFields(ctx, objectName, desiredFields) {
  const d = await describeObject(ctx, objectName);
  const available = new Set((d?.fields || []).map(f => f?.name).filter(Boolean));
  const fields = desiredFields.filter(f => available.has(f));
  return fields.length > 0 ? fields : ['Id', 'Name', 'CreatedDate'];
}

async function runSoql({ accessToken, instanceUrl }, soql) {
  const data = await sfRequest({ accessToken, instanceUrl, path: '/query', params: { q: soql } });
  return { records: data?.records || [], nextRecordsUrl: data?.nextRecordsUrl || null, totalSize: data?.totalSize || 0 };
}

// ---- Core object handlers ----
export const getSfCustomers = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { accessToken, instanceUrl } = await getSalesforceContext(userId);
    const limit = Math.min(Number(req.query?.limit) || 200, 2000);
    const fields = ['Id', 'Name', 'Type', 'BillingStreet', 'BillingCity', 'BillingState', 'BillingPostalCode', 'BillingCountry', 'ShippingStreet', 'ShippingCity', 'ShippingState', 'ShippingPostalCode', 'ShippingCountry', 'Phone', 'Website', 'CreatedDate', 'LastModifiedDate'];
    const projection = fields.join(', ');
    const where = `Type LIKE 'Customer%'`;
    const soql = `SELECT ${projection} FROM Account WHERE ${where} ORDER BY LastModifiedDate DESC LIMIT ${limit}`;
    const data = await runSoql({ accessToken, instanceUrl }, soql);
    return reply.code(200).send({ customers: data.records, total: data.totalSize });
  } catch (e) {
    req.log.error(e, 'Salesforce getSfCustomers error');
    return reply.code(500).send({ error: 'Failed to fetch Salesforce customers', details: e.message });
  }
};

export const getSfVendors = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { accessToken, instanceUrl } = await getSalesforceContext(userId);
    const limit = Math.min(Number(req.query?.limit) || 200, 2000);
    const fields = ['Id', 'Name', 'Type', 'BillingStreet', 'BillingCity', 'BillingState', 'BillingPostalCode', 'BillingCountry', 'Phone', 'Website', 'CreatedDate', 'LastModifiedDate'];
    const projection = fields.join(', ');
    const where = `Type LIKE 'Vendor%' OR Type LIKE 'Supplier%'`;
    const soql = `SELECT ${projection} FROM Account WHERE (${where}) ORDER BY LastModifiedDate DESC LIMIT ${limit}`;
    const data = await runSoql({ accessToken, instanceUrl }, soql);
    return reply.code(200).send({ vendors: data.records, total: data.totalSize });
  } catch (e) {
    req.log.error(e, 'Salesforce getSfVendors error');
    return reply.code(500).send({ error: 'Failed to fetch Salesforce vendors', details: e.message });
  }
};

export const getSfItems = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { accessToken, instanceUrl } = await getSalesforceContext(userId);
    const limit = Math.min(Number(req.query?.limit) || 200, 2000);
    const fields = ['Id', 'Name', 'ProductCode', 'IsActive', 'Family', 'Description', 'CreatedDate', 'LastModifiedDate'];
    const projection = fields.join(', ');
    const soql = `SELECT ${projection} FROM Product2 WHERE IsActive = true ORDER BY LastModifiedDate DESC LIMIT ${limit}`;
    const data = await runSoql({ accessToken, instanceUrl }, soql);
    return reply.code(200).send({ items: data.records, total: data.totalSize });
  } catch (e) {
    req.log.error(e, 'Salesforce getSfItems error');
    return reply.code(500).send({ error: 'Failed to fetch Salesforce items', details: e.message });
  }
};

export const getSfInvoices = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { accessToken, instanceUrl } = await getSalesforceContext(userId);
    const limit = Math.min(Number(req.query?.limit) || 200, 2000);
    const ctx = { accessToken, instanceUrl };
    const override = (req.query?.object || '').toString();
    const candidates = override ? [override] : ['Invoice', 'BillingInvoice__c', 'Invoice__c', 'sbqq__Invoice__c', 'zuora__Invoice__c'];
    const objectName = await chooseFirstExistingObject(ctx, candidates);
    if (!objectName) return reply.code(404).send({ error: 'No invoice object found', candidates });
    const desired = ['Id', 'Name', 'Status', 'TotalAmount', 'Amount', 'Balance', 'AccountId', 'BillToId', 'InvoiceDate', 'Invoice_Date__c', 'DueDate', 'Due_Date__c', 'CreatedDate', 'LastModifiedDate'];
    const fields = await selectAvailableFields(ctx, objectName, desired);
    const soql = `SELECT ${fields.join(', ')} FROM ${objectName} ORDER BY LastModifiedDate DESC LIMIT ${limit}`;
    const data = await runSoql(ctx, soql);
    return reply.code(200).send({ invoices: data.records, object: objectName, total: data.totalSize });
  } catch (e) {
    req.log.error(e, 'Salesforce getSfInvoices error');
    return reply.code(500).send({ error: 'Failed to fetch Salesforce invoices', details: e.message });
  }
};

export const getSfBills = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { accessToken, instanceUrl } = await getSalesforceContext(userId);
    const limit = Math.min(Number(req.query?.limit) || 200, 2000);
    const ctx = { accessToken, instanceUrl };
    const override = (req.query?.object || '').toString();
    const candidates = override ? [override] : ['VendorInvoice__c', 'Bill__c', 'Payable__c'];
    const objectName = await chooseFirstExistingObject(ctx, candidates);
    if (!objectName) return reply.code(404).send({ error: 'No bill object found', candidates });
    const desired = ['Id', 'Name', 'Status', 'TotalAmount', 'Amount', 'Balance', 'Vendor__c', 'AccountId', 'InvoiceDate__c', 'DueDate__c', 'CreatedDate', 'LastModifiedDate'];
    const fields = await selectAvailableFields(ctx, objectName, desired);
    const soql = `SELECT ${fields.join(', ')} FROM ${objectName} ORDER BY LastModifiedDate DESC LIMIT ${limit}`;
    const data = await runSoql(ctx, soql);
    return reply.code(200).send({ bills: data.records, object: objectName, total: data.totalSize });
  } catch (e) {
    req.log.error(e, 'Salesforce getSfBills error');
    return reply.code(500).send({ error: 'Failed to fetch Salesforce bills', details: e.message });
  }
};

export const getSfPayments = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { accessToken, instanceUrl } = await getSalesforceContext(userId);
    const limit = Math.min(Number(req.query?.limit) || 200, 2000);
    const ctx = { accessToken, instanceUrl };
    const override = (req.query?.object || '').toString();
    const candidates = override ? [override] : ['Payment', 'BillingPayment__c', 'Payment__c'];
    const objectName = await chooseFirstExistingObject(ctx, candidates);
    if (!objectName) return reply.code(404).send({ error: 'No payment object found', candidates });
    const desired = ['Id', 'Name', 'Status', 'Amount', 'TotalAmount', 'AccountId', 'Invoice__c', 'PaymentDate', 'Payment_Date__c', 'CreatedDate', 'LastModifiedDate'];
    const fields = await selectAvailableFields(ctx, objectName, desired);
    const soql = `SELECT ${fields.join(', ')} FROM ${objectName} ORDER BY LastModifiedDate DESC LIMIT ${limit}`;
    const data = await runSoql(ctx, soql);
    return reply.code(200).send({ payments: data.records, object: objectName, total: data.totalSize });
  } catch (e) {
    req.log.error(e, 'Salesforce getSfPayments error');
    return reply.code(500).send({ error: 'Failed to fetch Salesforce payments', details: e.message });
  }
};

export const getSfChartOfAccounts = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { accessToken, instanceUrl } = await getSalesforceContext(userId);
    const limit = Math.min(Number(req.query?.limit) || 200, 2000);
    const ctx = { accessToken, instanceUrl };
    const override = (req.query?.object || '').toString();
    const candidates = override ? [override] : ['GLAccount__c', 'General_Ledger_Account__c', 'LedgerAccount__c', 'AccountingAccount__c'];
    const objectName = await chooseFirstExistingObject(ctx, candidates);
    if (!objectName) return reply.code(404).send({ error: 'No chart of accounts object found', candidates });
    const desired = ['Id', 'Name', 'Code__c', 'Number__c', 'AccountNumber__c', 'Type__c', 'SubType__c', 'CreatedDate', 'LastModifiedDate'];
    const fields = await selectAvailableFields(ctx, objectName, desired);
    const soql = `SELECT ${fields.join(', ')} FROM ${objectName} ORDER BY Name ASC LIMIT ${limit}`;
    const data = await runSoql(ctx, soql);
    return reply.code(200).send({ accounts: data.records, object: objectName, total: data.totalSize });
  } catch (e) {
    req.log.error(e, 'Salesforce getSfChartOfAccounts error');
    return reply.code(500).send({ error: 'Failed to fetch Salesforce chart of accounts', details: e.message });
  }
};

export const getSfGeneralLedger = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { accessToken, instanceUrl } = await getSalesforceContext(userId);
    const limit = Math.min(Number(req.query?.limit) || 200, 2000);
    const ctx = { accessToken, instanceUrl };
    const override = (req.query?.object || '').toString();
    const candidates = override ? [override] : ['GLTransaction__c', 'LedgerEntry__c', 'JournalEntry__c', 'JournalEntryLine__c'];
    const objectName = await chooseFirstExistingObject(ctx, candidates);
    if (!objectName) return reply.code(404).send({ error: 'No general ledger object found', candidates });
    const desired = ['Id', 'Name', 'Amount__c', 'Amount', 'Debit__c', 'Credit__c', 'DebitAmount__c', 'CreditAmount__c', 'GLAccount__c', 'Account__c', 'Description__c', 'Description', 'EntryDate__c', 'PostingDate__c', 'TransactionDate__c', 'CreatedDate', 'LastModifiedDate'];
    const fields = await selectAvailableFields(ctx, objectName, desired);
    const soql = `SELECT ${fields.join(', ')} FROM ${objectName} ORDER BY LastModifiedDate DESC LIMIT ${limit}`;
    const data = await runSoql(ctx, soql);
    return reply.code(200).send({ entries: data.records, object: objectName, total: data.totalSize });
  } catch (e) {
    req.log.error(e, 'Salesforce getSfGeneralLedger error');
    return reply.code(500).send({ error: 'Failed to fetch Salesforce general ledger', details: e.message });
  }
};


