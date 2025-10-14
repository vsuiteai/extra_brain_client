import { db } from '../firestore.js';
import { XeroClient } from 'xero-node';

const XERO_SCOPES = (
  process.env.XERO_SCOPES || [
    'offline_access',
    'accounting.settings.read',
    'accounting.contacts.read',
    'accounting.transactions',
    'accounting.reports.read'
  ].join(' ')
);

function createXeroClient() {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  const redirectUri = `${process.env.BASE_URL}/api/integrations/xero/callback`;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing Xero OAuth env vars (XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI)');
  }

  return new XeroClient({
    clientId,
    clientSecret,
    redirectUris: [redirectUri],
    scopes: XERO_SCOPES.split(/\s+/)
  });
}

export const xeroConnect = async (req, reply) => {
  const userId = req.user?.id;
  const companyId = req.query?.companyId;
  try {
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const xero = createXeroClient();
    const state = await req.server.jwt.sign({ userId, companyId }, { expiresIn: '10m' });
    const consentUrl = await xero.buildConsentUrl();
    const url = new URL(consentUrl);
    url.searchParams.set('state', state);
    return reply.redirect(url.toString());
  } catch (e) {
    req.log.error(e, 'Xero connect error');
    return reply.code(500).send({ error: 'Failed to start Xero OAuth', details: e.message });
  }
};

export const xeroCallback = async (req, reply) => {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const fullUrl = `${proto}://${host}${req.raw.url}`;
  const { code, state } = req.query || {};
  if (!code || !state) return reply.code(400).send({ error: 'Missing code/state' });
  try {
    const decoded = await req.server.jwt.verify(state);
    const { userId, companyId } = decoded || {};
    let companyData = null;
    let userData = null;

    const xero = createXeroClient();
    await xero.apiCallback(fullUrl);
    await xero.updateTenants();
    const tenant = xero.tenants?.[0];

    const tokens = xero.readTokenSet();
    const expiresAt = tokens.expires_at ? new Date(tokens.expires_at).getTime() : (Date.now() + (tokens.expires_in || 0) * 1000);

    if (companyId) {
      const companyDoc = await db.collection('companies').doc(companyId).get();
      companyData = companyDoc.data();
    }

    if (userId) {
      const userDoc = await db.collection('users').doc(userId).get();
      userData = userDoc.data();
    }

    const docRef = db.collection('xero_connections').doc(`${userId}_${tenant?.tenantId || 'tenant'}`);
    await docRef.set({
      userId,
      user: userData || null,
      companyId: companyId || null,
      company: companyData || null,
      tenantId: tenant?.tenantId || null,
      tenantName: tenant?.tenantName || null,
      idToken: tokens.id_token || null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return reply.code(200).send({ status: 'connected', tenant: tenant || null });
  } catch (e) {
    req.log.error(e, 'Xero callback error');
    return reply.code(500).send({ error: 'Failed to complete Xero OAuth', details: e.message });
  }
};

export const getXeroAccessToken = async ({ userId }) => {
  const snap = await db.collection('xero_connections').where('userId', '==', userId).limit(1).get();
  if (snap.empty) throw new Error('No Xero connection found');
  const data = snap.docs[0].data();

  const xero = createXeroClient();
  await xero.initialize();
  xero.setTokenSet({
    access_token: data.accessToken,
    refresh_token: data.refreshToken,
    id_token: data.idToken || undefined,
    token_type: 'Bearer',
    expires_in: Math.max(0, Math.floor((data.expiresAt - Date.now()) / 1000))
  });

  if (Date.now() > (data.expiresAt - 60000)) {
    const newTokens = await xero.refreshToken();
    const expiresAt = newTokens.expires_at ? new Date(newTokens.expires_at).getTime() : (Date.now() + (newTokens.expires_in || 0) * 1000);
    await snap.docs[0].ref.update({
      accessToken: newTokens.access_token,
      refreshToken: newTokens.refresh_token || data.refreshToken,
      idToken: newTokens.id_token || data.idToken || null,
      expiresAt,
      updatedAt: new Date()
    });
    return newTokens.access_token;
  }

  return data.accessToken;
};


// Build an authenticated Xero client and resolve tenantId for the current user
async function getXeroContext(userId) {
  const snap = await db.collection('xero_connections').where('userId', '==', userId).limit(1).get();
  if (snap.empty) throw new Error('No Xero connection found');
  const data = snap.docs[0].data();

  const xero = createXeroClient();
  await xero.initialize();
  xero.setTokenSet({
    access_token: data.accessToken,
    refresh_token: data.refreshToken,
    id_token: data.idToken || undefined,
    token_type: 'Bearer',
    expires_in: Math.max(0, Math.floor((data.expiresAt - Date.now()) / 1000))
  });

  if (Date.now() > (data.expiresAt - 60000)) {
    const newTokens = await xero.refreshToken();
    const expiresAt = newTokens.expires_at ? new Date(newTokens.expires_at).getTime() : (Date.now() + (newTokens.expires_in || 0) * 1000);
    await snap.docs[0].ref.update({
      accessToken: newTokens.access_token,
      refreshToken: newTokens.refresh_token || data.refreshToken,
      idToken: newTokens.id_token || data.idToken || null,
      expiresAt,
      updatedAt: new Date()
    });
    xero.setTokenSet({
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token || data.refreshToken,
      id_token: newTokens.id_token || data.idToken || undefined,
      token_type: 'Bearer',
      expires_in: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
    });
  }

  const tenantId = data.tenantId;
  if (!tenantId) throw new Error('Missing tenantId for Xero connection');
  return { xero, tenantId };
}

// ---- Core data fetchers ----
export const getAccounts = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { xero, tenantId } = await getXeroContext(userId);
    const res = await xero.accountingApi.getAccounts(tenantId);
    return reply.code(200).send({ accounts: res.body?.accounts || [] });
  } catch (e) {
    req.log.error(e, 'Xero getAccounts error');
    return reply.code(500).send({ error: 'Failed to fetch accounts', details: e.message });
  }
};

export const getContacts = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const page = Number(req.query?.page) || 1;
    const { xero, tenantId } = await getXeroContext(userId);
    const res = await xero.accountingApi.getContacts(tenantId, undefined, undefined, undefined, undefined, page);
    return reply.code(200).send({ contacts: res.body?.contacts || [], page });
  } catch (e) {
    req.log.error(e, 'Xero getContacts error');
    return reply.code(500).send({ error: 'Failed to fetch contacts', details: e.message });
  }
};

export const getItems = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const page = Number(req.query?.page) || 1;
    const { xero, tenantId } = await getXeroContext(userId);
    const res = await xero.accountingApi.getItems(tenantId, undefined, undefined, page);
    return reply.code(200).send({ items: res.body?.items || [], page });
  } catch (e) {
    req.log.error(e, 'Xero getItems error');
    return reply.code(500).send({ error: 'Failed to fetch items', details: e.message });
  }
};

// Invoices (sales) and Bills (purchases) are both Invoices in Xero, distinguished by Type
export const getInvoices = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const type = (req.query?.type || 'ACCREC').toUpperCase(); // ACCREC = invoices, ACCPAY = bills
    const status = req.query?.status; // e.g., AUTHORISED, PAID, DRAFT
    const page = Number(req.query?.page) || 1;

    const whereParts = [`Type=="${type}"`];
    const where = whereParts.join(' && ');

    const { xero, tenantId } = await getXeroContext(userId);
    const statuses = status ? [status] : undefined;
    const res = await xero.accountingApi.getInvoices(tenantId, undefined, where, undefined, undefined, undefined, undefined, statuses, page);
    return reply.code(200).send({ invoices: res.body?.invoices || [], page, type, status: status || null });
  } catch (e) {
    req.log.error(e, 'Xero getInvoices error');
    return reply.code(500).send({ error: 'Failed to fetch invoices', details: e.message });
  }
};

export const getPayments = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const page = Number(req.query?.page) || 1;
    const { xero, tenantId } = await getXeroContext(userId);
    const res = await xero.accountingApi.getPayments(tenantId, undefined, undefined, page);
    return reply.code(200).send({ payments: res.body?.payments || [], page });
  } catch (e) {
    req.log.error(e, 'Xero getPayments error');
    return reply.code(500).send({ error: 'Failed to fetch payments', details: e.message });
  }
};

export const getJournals = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const page = Number(req.query?.page) || 1;
    const { xero, tenantId } = await getXeroContext(userId);
    const res = await xero.accountingApi.getJournals(tenantId, undefined, undefined, page);
    return reply.code(200).send({ journals: res.body?.journals || [], page });
  } catch (e) {
    req.log.error(e, 'Xero getJournals error');
    return reply.code(500).send({ error: 'Failed to fetch journals', details: e.message });
  }
};


