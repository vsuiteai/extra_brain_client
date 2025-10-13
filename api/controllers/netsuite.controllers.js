import axios from 'axios';
import { db } from '../firestore.js';

const NETSUITE_SCOPES = (
  process.env.NETSUITE_SCOPES || [
    'rest_webservices',
    'restlets'
  ].join(' ')
);

function getAuthorizeBaseUrl() {
  const base = process.env.NETSUITE_AUTH_BASE_URL || (process.env.NETSUITE_ACCOUNT_ID ? `https://${process.env.NETSUITE_ACCOUNT_ID}.app.netsuite.com` : null);
  if (!base) throw new Error('Missing NetSuite auth base URL. Set NETSUITE_AUTH_BASE_URL or NETSUITE_ACCOUNT_ID');
  return base.replace(/\/$/, '');
}

function getTokenBaseUrl() {
  const base = process.env.NETSUITE_TOKEN_BASE_URL || (process.env.NETSUITE_ACCOUNT_ID ? `https://${process.env.NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com` : null);
  if (!base) throw new Error('Missing NetSuite token base URL. Set NETSUITE_TOKEN_BASE_URL or NETSUITE_ACCOUNT_ID');
  return base.replace(/\/$/, '');
}

function getRedirectUri() {
  const redirectUri = `${process.env.BASE_URL}/api/integrations/netsuite/callback`;
  return redirectUri;
}

function ensureClientCreds() {
  const clientId = process.env.NETSUITE_CLIENT_ID;
  const clientSecret = process.env.NETSUITE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Missing NetSuite OAuth env vars (NETSUITE_CLIENT_ID, NETSUITE_CLIENT_SECRET)');
  return { clientId, clientSecret };
}

export const netsuiteConnect = async (req, reply) => {
  const userId = req.user?.id;
  const companyId = req.query?.companyId;
  try {
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const authBaseUrl = getAuthorizeBaseUrl();
    const { clientId } = ensureClientCreds();
    const redirectUri = getRedirectUri();

    const state = await req.server.jwt.sign({ userId, companyId }, { expiresIn: '10m' });

    const authorizeUrl = new URL('/app/login/oauth2/authorize.nl', authBaseUrl);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', NETSUITE_SCOPES);
    authorizeUrl.searchParams.set('state', state);

    return reply.redirect(authorizeUrl.toString());
  } catch (e) {
    req.log.error(e, 'NetSuite connect error');
    return reply.code(500).send({ error: 'Failed to start NetSuite OAuth', details: e.message });
  }
};

export const netsuiteCallback = async (req, reply) => {
  const { code, state } = req.query || {};
  if (!code || !state) return reply.code(400).send({ error: 'Missing code/state' });
  try {
    const decoded = await req.server.jwt.verify(state);
    const { userId, companyId } = decoded || {};
    if (!userId) return reply.code(400).send({ error: 'Invalid state' });

    const tokenBaseUrl = getTokenBaseUrl();
    const { clientId, clientSecret } = ensureClientCreds();
    const redirectUri = getRedirectUri();

    let companyData = null;
    let userData = null;

    if (companyId) {
      const companyDoc = await db.collection('companies').doc(companyId).get();
      companyData = { ...companyDoc.data(), id: companyDoc.id };
    }

    if (userId) {
      const userDoc = await db.collection('users').doc(userId).get();
      userData = { ...userDoc.data(), id: userDoc.id };
    }

    const tokenUrl = new URL('/services/rest/auth/oauth2/v1/token', tokenBaseUrl).toString();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('code', code);
    params.set('redirect_uri', redirectUri);

    const tokenRes = await axios.post(tokenUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basic}`
      }
    });

    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      scope,
      realm
    } = tokenRes.data || {};

    const expiresAt = Date.now() + (Number(expiresIn || 0) * 1000);

    const docRef = db.collection('netsuite_connections').doc(userId);
    await docRef.set({
      userId,
      user: userData || null,
      companyId: companyId || null,
      company: companyData || null,
      realm: realm || null,
      scope: scope || NETSUITE_SCOPES,
      accessToken,
      refreshToken: refreshToken || null,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return reply.code(200).send({ status: 'connected', realm: realm || null });
  } catch (e) {
    req.log.error(e, 'NetSuite callback error');
    return reply.code(500).send({ error: 'Failed to complete NetSuite OAuth', details: e.message });
  }
};

export const getNetsuiteAccessToken = async ({ userId }) => {
  const snap = await db.collection('netsuite_connections').where('userId', '==', userId).limit(1).get();
  if (snap.empty) throw new Error('No NetSuite connection found');
  const data = snap.docs[0].data();

  if (Date.now() < (data.expiresAt - 60000)) {
    return data.accessToken;
  }

  const tokenBaseUrl = getTokenBaseUrl();
  const { clientId, clientSecret } = ensureClientCreds();
  const tokenUrl = new URL('/services/rest/auth/oauth2/v1/token', tokenBaseUrl).toString();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  if (!data.refreshToken) throw new Error('No refresh token stored for NetSuite');

  const params = new URLSearchParams();
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', data.refreshToken);

  const tokenRes = await axios.post(tokenUrl, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basic}`
    }
  });

  const { access_token: newAccess, refresh_token: newRefresh, expires_in: newExpires } = tokenRes.data || {};
  const expiresAt = Date.now() + (Number(newExpires || 0) * 1000);

  await snap.docs[0].ref.update({
    accessToken: newAccess,
    refreshToken: newRefresh || data.refreshToken,
    expiresAt,
    updatedAt: new Date()
  });

  return newAccess;
};

async function getNetsuiteContext(userId) {
  const snap = await db.collection('netsuite_connections').where('userId', '==', userId).limit(1).get();
  if (snap.empty) throw new Error('No NetSuite connection found');
  const data = snap.docs[0].data();

  const accessToken = await getNetsuiteAccessToken({ userId });
  const realm = (data.realm || process.env.NETSUITE_ACCOUNT_ID || '').toLowerCase();
  if (!realm) throw new Error('Missing NetSuite realm/account id');
  const recordsBaseUrl = `https://${realm}.suitetalk.api.netsuite.com/services/rest/record/v1`;
  return { accessToken, recordsBaseUrl };
}

async function fetchRecordList({ accessToken, url, params }) {
  const fullUrl = new URL(url);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) fullUrl.searchParams.set(String(key), String(value));
    });
  }
  const res = await axios.get(fullUrl.toString(), {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });
  return res.data;
}

export const getNsAccounts = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const limit = Number(req.query?.limit) || 50;
    const offset = Number(req.query?.offset) || 0;
    const { accessToken, recordsBaseUrl } = await getNetsuiteContext(userId);
    const data = await fetchRecordList({ accessToken, url: `${recordsBaseUrl}/account`, params: { limit, offset } });
    return reply.code(200).send({
        accounts: data?.items || [],
        count: data?.count || 0,
        hasMore: Boolean(data?.hasMore),
        offset,
        limit
    });
  } catch (e) {
    req.log.error(e, 'NetSuite getNsAccounts error');
    return reply.code(500).send({ error: 'Failed to fetch NetSuite accounts', details: e.message });
  }
};

export const getNsJournals = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const limit = Number(req.query?.limit) || 50;
    const offset = Number(req.query?.offset) || 0;
    const { accessToken, recordsBaseUrl } = await getNetsuiteContext(userId);
    const data = await fetchRecordList({ accessToken, url: `${recordsBaseUrl}/journalEntry`, params: { limit, offset } });
    return reply.code(200).send({ journals: data?.items || [], count: data?.count || 0, hasMore: Boolean(data?.hasMore), offset, limit });
  } catch (e) {
    req.log.error(e, 'NetSuite getNsJournals error');
    return reply.code(500).send({ error: 'Failed to fetch NetSuite journals', details: e.message });
  }
};

export const getNsInvoices = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const limit = Number(req.query?.limit) || 50;
    const offset = Number(req.query?.offset) || 0;
    const { accessToken, recordsBaseUrl } = await getNetsuiteContext(userId);
    const data = await fetchRecordList({ accessToken, url: `${recordsBaseUrl}/invoice`, params: { limit, offset } });
    return reply.code(200).send({ invoices: data?.items || [], count: data?.count || 0, hasMore: Boolean(data?.hasMore), offset, limit });
  } catch (e) {
    req.log.error(e, 'NetSuite getNsInvoices error');
    return reply.code(500).send({ error: 'Failed to fetch NetSuite invoices', details: e.message });
  }
};

export const getNsBills = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const limit = Number(req.query?.limit) || 50;
    const offset = Number(req.query?.offset) || 0;
    const { accessToken, recordsBaseUrl } = await getNetsuiteContext(userId);
    const data = await fetchRecordList({ accessToken, url: `${recordsBaseUrl}/vendorBill`, params: { limit, offset } });
    return reply.code(200).send({ bills: data?.items || [], count: data?.count || 0, hasMore: Boolean(data?.hasMore), offset, limit });
  } catch (e) {
    req.log.error(e, 'NetSuite getNsBills error');
    return reply.code(500).send({ error: 'Failed to fetch NetSuite bills', details: e.message });
  }
};

export const getNsPayments = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const limit = Number(req.query?.limit) || 50;
    const offset = Number(req.query?.offset) || 0;
    const type = (req.query?.type || 'all').toLowerCase();
    const { accessToken, recordsBaseUrl } = await getNetsuiteContext(userId);

    const endpoints = [];
    if (type === 'customer' || type === 'all') endpoints.push('customerPayment');
    if (type === 'vendor' || type === 'all') endpoints.push('vendorPayment');

    const results = await Promise.all(endpoints.map((ep) => fetchRecordList({ accessToken, url: `${recordsBaseUrl}/${ep}`, params: { limit, offset } }).catch(() => ({ items: [] })) ));
    const merged = results.flatMap(r => r?.items || []).map(item => ({ ...item }));
    return reply.code(200).send({ payments: merged, type, offset, limit });
  } catch (e) {
    req.log.error(e, 'NetSuite getNsPayments error');
    return reply.code(500).send({ error: 'Failed to fetch NetSuite payments', details: e.message });
  }
};

export const getNsCustomers = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const limit = Number(req.query?.limit) || 50;
    const offset = Number(req.query?.offset) || 0;
    const { accessToken, recordsBaseUrl } = await getNetsuiteContext(userId);
    const data = await fetchRecordList({ accessToken, url: `${recordsBaseUrl}/customer`, params: { limit, offset } });
    return reply.code(200).send({ customers: data?.items || [], count: data?.count || 0, hasMore: Boolean(data?.hasMore), offset, limit });
  } catch (e) {
    req.log.error(e, 'NetSuite getNsCustomers error');
    return reply.code(500).send({ error: 'Failed to fetch NetSuite customers', details: e.message });
  }
};

export const getNsVendors = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const limit = Number(req.query?.limit) || 50;
    const offset = Number(req.query?.offset) || 0;
    const { accessToken, recordsBaseUrl } = await getNetsuiteContext(userId);
    const data = await fetchRecordList({ accessToken, url: `${recordsBaseUrl}/vendor`, params: { limit, offset } });
    return reply.code(200).send({ vendors: data?.items || [], count: data?.count || 0, hasMore: Boolean(data?.hasMore), offset, limit });
  } catch (e) {
    req.log.error(e, 'NetSuite getNsVendors error');
    return reply.code(500).send({ error: 'Failed to fetch NetSuite vendors', details: e.message });
  }
};

export const getNsItems = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const limit = Number(req.query?.limit) || 50;
    const offset = Number(req.query?.offset) || 0;
    const typesParam = (req.query?.types || '').toString();
    const requestedTypes = typesParam ? typesParam.split(',').map(s => s.trim()).filter(Boolean) : ['inventoryItem', 'nonInventorySaleItem', 'serviceSaleItem'];
    const { accessToken, recordsBaseUrl } = await getNetsuiteContext(userId);

    const promises = requestedTypes.map((t) => fetchRecordList({ accessToken, url: `${recordsBaseUrl}/${t}`, params: { limit, offset } }).catch(() => ({ items: [] })));
    const results = await Promise.all(promises);
    const items = results.flatMap(r => r?.items || []).map(item => ({ ...item }));
    return reply.code(200).send({ items, types: requestedTypes, offset, limit });
  } catch (e) {
    req.log.error(e, 'NetSuite getNsItems error');
    return reply.code(500).send({ error: 'Failed to fetch NetSuite items', details: e.message });
  }
};

