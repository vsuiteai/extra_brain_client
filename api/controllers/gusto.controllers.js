import axios from 'axios';
import { db } from '../firestore.js';

const GUSTO_AUTH_BASE = process.env.GUSTO_AUTH_BASE || 'https://api.gusto.com';
const GUSTO_API_BASE = process.env.GUSTO_API_BASE || 'https://api.gusto.com';
const GUSTO_SCOPES = (
  process.env.GUSTO_SCOPES || [
    'user.read',
    'company.read'
  ].join(' ')
);

function getRedirectUri() {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) throw new Error('Missing BASE_URL env var');
  return `${baseUrl}/api/integrations/gusto/callback`;
}

function ensureClientCreds() {
  const clientId = process.env.GUSTO_CLIENT_ID;
  const clientSecret = process.env.GUSTO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing Gusto OAuth env vars (GUSTO_CLIENT_ID, GUSTO_CLIENT_SECRET)');
  }
  return { clientId, clientSecret };
}

export const gustoConnect = async (req, reply) => {
  try {
    const userId = req.user?.id;
    const companyId = req.query?.companyId || null;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const { clientId } = ensureClientCreds();
    const redirectUri = getRedirectUri();
    const state = await req.server.jwt.sign({ userId, companyId }, { expiresIn: '10m' });

    const authorizeUrl = new URL('/oauth/authorize', GUSTO_AUTH_BASE);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', GUSTO_SCOPES);
    authorizeUrl.searchParams.set('state', state);

    return reply.redirect(authorizeUrl.toString());
  } catch (e) {
    req.log.error(e, 'Gusto connect error');
    return reply.code(500).send({ error: 'Failed to start Gusto OAuth', details: e.message });
  }
};

export const gustoCallback = async (req, reply) => {
  const { code, state } = req.query || {};
  if (!code || !state) return reply.code(400).send({ error: 'Missing code/state' });
  try {
    const decoded = await req.server.jwt.verify(state);
    const { userId, companyId } = decoded || {};
    if (!userId) return reply.code(400).send({ error: 'Invalid state' });

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
    } catch {}

    const tokenUrl = new URL('/oauth/token', GUSTO_AUTH_BASE).toString();
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
      token_type: tokenType,
      scope
    } = tokenRes.data || {};

    const expiresAt = Date.now() + (Number(expiresIn || 0) * 1000);

    const docRef = db.collection('gusto_connections').doc(userId);
    await docRef.set({
      userId,
      user: userData || null,
      companyId: companyId || null,
      company: companyData || null,
      scope: scope || GUSTO_SCOPES,
      tokenType: tokenType || 'Bearer',
      accessToken,
      refreshToken: refreshToken || null,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return reply.code(200).send({ status: 'connected' });
  } catch (e) {
    req.log.error(e, 'Gusto callback error');
    return reply.code(500).send({ error: 'Failed to complete Gusto OAuth', details: e.message });
  }
};

export const gustoDisconnect = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const snap = await db.collection('gusto_connections').where('userId', '==', userId).limit(1).get();
    if (!snap.empty) {
      await snap.docs[0].ref.delete();
    }
    return reply.code(200).send({ status: 'disconnected' });
  } catch (e) {
    req.log.error(e, 'Gusto disconnect error');
    return reply.code(500).send({ error: 'Failed to disconnect Gusto', details: e.message });
  }
};

export const getGustoAccessTokenForUser = async (userId) => {
  const snap = await db.collection('gusto_connections').where('userId', '==', userId).limit(1).get();
  if (snap.empty) throw new Error('No Gusto connection found');
  const data = snap.docs[0].data();

  if (Date.now() < (data.expiresAt - 60000) && data.accessToken) {
    return data.accessToken;
  }

  if (!data.refreshToken) throw new Error('No refresh token stored for Gusto');

  const { clientId, clientSecret } = ensureClientCreds();
  const tokenUrl = new URL('/oauth/token', GUSTO_AUTH_BASE).toString();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const params = new URLSearchParams();
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', data.refreshToken);

  const tokenRes = await axios.post(tokenUrl, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basic}`
    }
  });

  const { access_token: newAccess, refresh_token: newRefresh, expires_in: newExpires, token_type: tokenType } = tokenRes.data || {};
  const expiresAt = Date.now() + (Number(newExpires || 0) * 1000);

  await snap.docs[0].ref.update({
    accessToken: newAccess,
    refreshToken: newRefresh || data.refreshToken,
    tokenType: tokenType || data.tokenType || 'Bearer',
    expiresAt,
    updatedAt: new Date()
  });

  return newAccess;
};

// ---- Data helpers ----
async function gustoApiGet(path, accessToken, params = undefined) {
  const url = new URL(path, GUSTO_API_BASE).toString();
  const res = await axios.get(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    },
    params
  });
  return res.data;
}

// ---- Data endpoints ----
export const getGustoCompanies = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const token = await getGustoAccessTokenForUser(userId);
    const companies = await gustoApiGet('/v1/companies', token);
    return reply.code(200).send({ companies: companies || [] });
  } catch (e) {
    req.log.error(e, 'Gusto getGustoCompanies error');
    return reply.code(500).send({ error: 'Failed to fetch companies', details: e.message });
  }
};

export const getGustoCompany = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const companyId = req.query?.companyId;
    if (!companyId) return reply.code(400).send({ error: 'Missing companyId' });
    const token = await getGustoAccessTokenForUser(userId);
    const company = await gustoApiGet(`/v1/companies/${encodeURIComponent(companyId)}`, token);
    return reply.code(200).send({ company: company || null });
  } catch (e) {
    req.log.error(e, 'Gusto getGustoCompany error');
    return reply.code(500).send({ error: 'Failed to fetch company', details: e.message });
  }
};

export const getGustoEmployees = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const companyId = req.query?.companyId;
    if (!companyId) return reply.code(400).send({ error: 'Missing companyId' });
    const token = await getGustoAccessTokenForUser(userId);
    const employees = await gustoApiGet(`/v1/companies/${encodeURIComponent(companyId)}/employees`, token);
    return reply.code(200).send({ employees: employees || [] });
  } catch (e) {
    req.log.error(e, 'Gusto getGustoEmployees error');
    return reply.code(500).send({ error: 'Failed to fetch employees', details: e.message });
  }
};

export const getGustoPayrolls = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const companyId = req.query?.companyId;
    if (!companyId) return reply.code(400).send({ error: 'Missing companyId' });
    const token = await getGustoAccessTokenForUser(userId);
    const payrolls = await gustoApiGet(`/v1/companies/${encodeURIComponent(companyId)}/payrolls`, token);
    return reply.code(200).send({ payrolls: payrolls || [] });
  } catch (e) {
    req.log.error(e, 'Gusto getGustoPayrolls error');
    return reply.code(500).send({ error: 'Failed to fetch payrolls', details: e.message });
  }
};

export const getGustoLocations = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
    const companyId = req.query?.companyId;
    if (!companyId) return reply.code(400).send({ error: 'Missing companyId' });
    const token = await getGustoAccessTokenForUser(userId);
    const locations = await gustoApiGet(`/v1/companies/${encodeURIComponent(companyId)}/locations`, token);
    return reply.code(200).send({ locations: locations || [] });
  } catch (e) {
    req.log.error(e, 'Gusto getGustoLocations error');
    return reply.code(500).send({ error: 'Failed to fetch locations', details: e.message });
  }
};


