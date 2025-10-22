import OAuthClient from 'intuit-oauth';
import axios from 'axios';
import { db } from '../firestore.js';

// Removed unused parseQbResponse after switching to Axios helper

function getQbBaseUrl(env) {
  return env === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

async function qbAxiosGet({ accessToken, url }) {
  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    },
    withCredentials: false,
    maxRedirects: 0
  });
  return res.data;
}

function createQuickBooksClient() {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const env = (process.env.QB_ENV || 'sandbox').toLowerCase(); // 'sandbox' | 'production'
  const baseUrl = process.env.BASE_URL;
  const redirectUri = `${baseUrl}/api/integrations/quickbooks/callback`;

  if (!clientId || !clientSecret || !baseUrl) {
    throw new Error('Missing QuickBooks OAuth env vars (QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, BASE_URL)');
  }

  return new OAuthClient({
    clientId,
    clientSecret,
    environment: env === 'production' ? 'production' : 'sandbox',
    redirectUri
  });
}

export const qbConnect = async (req, reply) => {
  try {
    const userId = req.user?.id;
    const companyId = req.query?.companyId || null;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const oauthClient = createQuickBooksClient();
    const state = await req.server.jwt.sign({ userId, companyId }, { expiresIn: '10m' });

    const authUri = oauthClient.authorizeUri({
      scope: (process.env.QB_SCOPES || [
        'com.intuit.quickbooks.accounting',
        'openid',
        'profile',
        'email',
        'phone',
        'address'
      ].join(' ')),
      state
    });

    // Return the authorization URL as JSON so the frontend can
    // perform a top-level navigation (avoids CORS on XHR redirects)
    return reply.code(200).send({ redirectUrl: authUri });
  } catch (e) {
    req.log.error(e, 'QuickBooks connect error');
    return reply.code(500).send({ error: 'Failed to start QuickBooks OAuth', details: e.message });
  }
};

export const qbCallback = async (req, reply) => {
  try {
    const { code, state, realmId } = req.query || {};
    if (!code || !state || !realmId) return reply.code(400).send({ error: 'Missing code/state/realmId' });

    const decoded = await req.server.jwt.verify(state);
    const { userId, companyId } = decoded || {};
    if (!userId) return reply.code(400).send({ error: 'Invalid state' });

    const oauthClient = createQuickBooksClient();

    const fullUrl = req.raw.url.startsWith('http')
      ? req.raw.url
      : `${(req.headers['x-forwarded-proto'] || 'https')}://${req.headers.host}${req.raw.url}`;
    const authResponse = await oauthClient.createToken(fullUrl);
    const token = authResponse.getJson();

    const expiresAt = token?.expires_in ? (Date.now() + (token.expires_in * 1000)) : Date.now() + 55 * 60 * 1000;

    // Optional: fetch user & company snapshot
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
    } catch (err) {
      req.log.warn({ err }, 'QuickBooks: failed to fetch optional user/company snapshot');
    }

    const docRef = db.collection('quickbooks_connections').doc(userId);
    await docRef.set({
      userId,
      user: userData,
      companyId: companyId || null,
      company: companyData,
      realmId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      idToken: token.id_token || null,
      tokenType: token.token_type || 'Bearer',
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return reply.redirect(`${process.env.FRONTEND_URL}/dashboard/settings?integration=quickbooks&status=connected&realmId=${realmId}`, 302);
  } catch (e) {
    req.log.error(e, 'QuickBooks callback error');
    return reply.code(500).send({ error: 'Failed to complete QuickBooks OAuth', details: e.message });
  }
};

export async function getQuickBooksAccessTokenForUser(userId) {
  const snap = await db.collection('quickbooks_connections').where('userId', '==', userId).limit(1).get();
  if (snap.empty) throw new Error('No QuickBooks connection found');
  const data = snap.docs[0].data();

  const oauthClient = createQuickBooksClient();
  oauthClient.setToken({
    token_type: data.tokenType || 'Bearer',
    access_token: data.accessToken,
    refresh_token: data.refreshToken,
    id_token: data.idToken || undefined,
    expires_in: Math.max(0, Math.floor((data.expiresAt - Date.now()) / 1000))
  });

  // Refresh if expiring within 60s
  if (Date.now() > (data.expiresAt - 60000)) {
    const authResponse = await oauthClient.refresh();
    const newToken = authResponse.getJson();
    const expiresAt = newToken?.expires_in ? (Date.now() + newToken.expires_in * 1000) : (Date.now() + 55 * 60 * 1000);
    await snap.docs[0].ref.update({
      accessToken: newToken.access_token,
      refreshToken: newToken.refresh_token || data.refreshToken,
      idToken: newToken.id_token || data.idToken || null,
      tokenType: newToken.token_type || data.tokenType || 'Bearer',
      expiresAt,
      updatedAt: new Date()
    });
    return newToken.access_token;
  }

  return data.accessToken;
}

// ---- Helpers ----
async function getQbContext(userId) {
  const snap = await db.collection('quickbooks_connections').where('userId', '==', userId).limit(1).get();
  if (snap.empty) throw new Error('No QuickBooks connection found');
  const data = snap.docs[0].data();

  const oauthClient = createQuickBooksClient();
  oauthClient.setToken({
    token_type: data.tokenType || 'Bearer',
    access_token: data.accessToken,
    refresh_token: data.refreshToken,
    id_token: data.idToken || undefined,
    expires_in: Math.max(0, Math.floor((data.expiresAt - Date.now()) / 1000))
  });

  if (Date.now() > (data.expiresAt - 60000)) {
    const authResponse = await oauthClient.refresh();
    const newToken = authResponse.getJson();
    const expiresAt = newToken?.expires_in ? (Date.now() + newToken.expires_in * 1000) : (Date.now() + 55 * 60 * 1000);
    await snap.docs[0].ref.update({
      accessToken: newToken.access_token,
      refreshToken: newToken.refresh_token || data.refreshToken,
      idToken: newToken.id_token || data.idToken || null,
      tokenType: newToken.token_type || data.tokenType || 'Bearer',
      expiresAt,
      updatedAt: new Date()
    });
    oauthClient.setToken({
      token_type: newToken.token_type || 'Bearer',
      access_token: newToken.access_token,
      refresh_token: newToken.refresh_token || data.refreshToken,
      id_token: newToken.id_token || undefined,
      expires_in: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
    });
  }

  const realmId = data.realmId;
  if (!realmId) throw new Error('Missing realmId in QuickBooks connection');
  return { oauthClient, realmId };
}

// ---- Core data fetchers ----
export const getQbAccounts = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { oauthClient, realmId } = await getQbContext(userId);
    const base = getQbBaseUrl(oauthClient.environment);
    const q = encodeURIComponent('select * from Account');
    const accessToken = await getQuickBooksAccessTokenForUser(userId);
    const data = await qbAxiosGet({ accessToken, url: `${base}/v3/company/${realmId}/query?query=${q}` });
    return reply.code(200).send({ accounts: data?.QueryResponse?.Account || [] });
  } catch (e) {
    req.log.error(e, 'QuickBooks getQbAccounts error');
    return reply.code(500).send({ error: 'Failed to fetch accounts', details: e.message });
  }
};

export const getQbCustomers = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { oauthClient, realmId } = await getQbContext(userId);
    const base = getQbBaseUrl(oauthClient.environment);
    const q = encodeURIComponent('select * from Customer');
    const accessToken = await getQuickBooksAccessTokenForUser(userId);
    const data = await qbAxiosGet({ accessToken, url: `${base}/v3/company/${realmId}/query?query=${q}` });
    return reply.code(200).send({ customers: data?.QueryResponse?.Customer || [] });
  } catch (e) {
    req.log.error(e, 'QuickBooks getQbCustomers error');
    return reply.code(500).send({ error: 'Failed to fetch customers', details: e.message });
  }
};

export const getQbVendors = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { oauthClient, realmId } = await getQbContext(userId);
    const base = getQbBaseUrl(oauthClient.environment);
    const q = encodeURIComponent('select * from Vendor');
    const accessToken = await getQuickBooksAccessTokenForUser(userId);
    const data = await qbAxiosGet({ accessToken, url: `${base}/v3/company/${realmId}/query?query=${q}` });
    return reply.code(200).send({ vendors: data?.QueryResponse?.Vendor || [] });
  } catch (e) {
    req.log.error(e, 'QuickBooks getQbVendors error');
    return reply.code(500).send({ error: 'Failed to fetch vendors', details: e.message });
  }
};

export const getQbItems = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { oauthClient, realmId } = await getQbContext(userId);
    const base = getQbBaseUrl(oauthClient.environment);
    const q = encodeURIComponent('select * from Item');
    const accessToken = await getQuickBooksAccessTokenForUser(userId);
    const data = await qbAxiosGet({ accessToken, url: `${base}/v3/company/${realmId}/query?query=${q}` });
    return reply.code(200).send({ items: data?.QueryResponse?.Item || [] });
  } catch (e) {
    req.log.error(e, 'QuickBooks getQbItems error');
    return reply.code(500).send({ error: 'Failed to fetch items', details: e.message });
  }
};

export const getQbInvoices = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { oauthClient, realmId } = await getQbContext(userId);
    const base = getQbBaseUrl(oauthClient.environment);
    const q = encodeURIComponent('select * from Invoice');
    const accessToken = await getQuickBooksAccessTokenForUser(userId);
    const data = await qbAxiosGet({ accessToken, url: `${base}/v3/company/${realmId}/query?query=${q}` });
    return reply.code(200).send({ invoices: data?.QueryResponse?.Invoice || [] });
  } catch (e) {
    req.log.error(e, 'QuickBooks getQbInvoices error');
    return reply.code(500).send({ error: 'Failed to fetch invoices', details: e.message });
  }
};

export const getQbBills = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { oauthClient, realmId } = await getQbContext(userId);
    const base = getQbBaseUrl(oauthClient.environment);
    const q = encodeURIComponent('select * from Bill');
    const accessToken = await getQuickBooksAccessTokenForUser(userId);
    const data = await qbAxiosGet({ accessToken, url: `${base}/v3/company/${realmId}/query?query=${q}` });
    return reply.code(200).send({ bills: data?.QueryResponse?.Bill || [] });
  } catch (e) {
    req.log.error(e, 'QuickBooks getQbBills error');
    return reply.code(500).send({ error: 'Failed to fetch bills', details: e.message });
  }
};

export const getQbPayments = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { oauthClient, realmId } = await getQbContext(userId);
    const base = getQbBaseUrl(oauthClient.environment);
    const q = encodeURIComponent('select * from Payment');
    const accessToken = await getQuickBooksAccessTokenForUser(userId);
    const data = await qbAxiosGet({ accessToken, url: `${base}/v3/company/${realmId}/query?query=${q}` });
    return reply.code(200).send({ payments: data?.QueryResponse?.Payment || [] });
  } catch (e) {
    req.log.error(e, 'QuickBooks getQbPayments error');
    return reply.code(500).send({ error: 'Failed to fetch payments', details: e.message });
  }
};

export const getQbJournals = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { oauthClient, realmId } = await getQbContext(userId);
    const base = getQbBaseUrl(oauthClient.environment);
    const q = encodeURIComponent('select * from JournalEntry');
    const accessToken = await getQuickBooksAccessTokenForUser(userId);
    const data = await qbAxiosGet({ accessToken, url: `${base}/v3/company/${realmId}/query?query=${q}` });
    return reply.code(200).send({ journals: data?.QueryResponse?.JournalEntry || [] });
  } catch (e) {
    req.log.error(e, 'QuickBooks getQbJournals error');
    return reply.code(500).send({ error: 'Failed to fetch journals', details: e.message });
  }
};

// General Ledger report
export const getQbGeneralLedger = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const { oauthClient, realmId } = await getQbContext(userId);
    const base = getQbBaseUrl(oauthClient.environment);
    const from = req.query?.from || '1900-01-01';
    const to = req.query?.to || new Date().toISOString().slice(0, 10);
    const accessToken = await getQuickBooksAccessTokenForUser(userId);
    const data = await qbAxiosGet({ accessToken, url: `${base}/v3/company/${realmId}/reports/GeneralLedger?start_date=${encodeURIComponent(from)}&end_date=${encodeURIComponent(to)}` });
    return reply.code(200).send({ report: data || {} });
  } catch (e) {
    req.log.error(e, 'QuickBooks getQbGeneralLedger error');
    return reply.code(500).send({ error: 'Failed to fetch general ledger', details: e.message });
  }
};

export const getQbConnectionStatus = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    
    const snap = await db.collection('quickbooks_connections').where('userId', '==', userId).limit(1).get();
    
    if (snap.empty) {
      return reply.code(200).send({ connected: false, status: 'not_connected' });
    }
    
    const data = snap.docs[0].data();
    const isExpired = Date.now() >= data.expiresAt;
    
    return reply.code(200).send({
      connected: true,
      status: isExpired ? 'expired' : 'active',
      expiresAt: data.expiresAt,
      createdAt: data.createdAt,
      realmId: data.realmId,
      companyId: data.companyId,
      company: data.company
    });
  } catch (e) {
    req.log.error(e, 'QuickBooks getQbConnectionStatus error');
    return reply.code(500).send({ error: 'Failed to check QuickBooks connection status', details: e.message });
  }
};


