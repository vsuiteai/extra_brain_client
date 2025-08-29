import 'dotenv/config';
import Fastify from 'fastify';
import { generateTokens } from './lib/utils.js';
import cors from '@fastify/cors';
import multipart from "@fastify/multipart";
import formbody from '@fastify/formbody';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import fs from 'fs';
import yaml from 'yaml';

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(formbody);
await app.register(multipart);
await app.register(jwt, { secret: process.env.JWT_SECRET || 'supersecret' });
app.decorate('generateTokens', (payload) => generateTokens(app, payload));
app.decorate('authenticate', async function (req, reply) {
  try {
    await req.jwtVerify();
  } catch (err) {
    console.error('Authentication error:', err);
    reply.code(401).send({ error: 'Unauthorized' });
  }
});

// 🔹 Load OpenAPI spec
const file = fs.readFileSync('api/openapi.yml', 'utf8');
const openapiSpec = yaml.parse(file);

// 🔹 Register Swagger with your OpenAPI spec
await app.register(swagger, {
  mode: 'static',
  specification: {
    document: openapiSpec,
  },
});

// 🔹 Swagger UI at /docs
await app.register(swaggerUI, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: false,
  },
});

// Health
app.get('/health', async () => ({ status: 'ok' }));


// KPIs
// fastify.get('/api/kpis', async () => {
//   const snapshot = await db.collection('kpis').get();
//   return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
// });
// fastify.get('/api/kpi/:layer', async (req) => {
//   const { layer } = req.params;
//   const snapshot = await db.collection('kpis').where('layer', '==', layer).get();
//   return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
// });
// fastify.post('/api/kpi', async (req, reply) => {
//   const data = req.body;
//   await db.collection('kpis').add(data);
//   reply.code(201).send({ status: 'success' });
// });

// // Brain
// fastify.get('/api/personas', async () => {
//   const snap = await db.collection('personas').get();
//   return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
// });
// fastify.get('/api/prompts/:personaId', async (req) => {
//   const { personaId } = req.params;
//   const snap = await db.collection('prompts').where('personaRef', '==', personaId).get();
//   return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
// });
// fastify.get('/api/subPrompts/:promptId', async (req) => {
//   const { promptId } = req.params;
//   const snap = await db.collection('subPrompts').where('promptRef', '==', promptId).get();
//   return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
// });
// fastify.get('/api/outputInstructions/:promptId', async (req) => {
//   const { promptId } = req.params;
//   const snap = await db.collection('outputInstructions').where('context', '>=', promptId).get();
//   return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
// });

await app.register(authRoutes);
await app.register(userRoutes);

const port = process.env.PORT || 8080;
app.listen({ port, host: '0.0.0.0' });
