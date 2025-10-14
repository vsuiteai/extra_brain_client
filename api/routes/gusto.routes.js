import fp from 'fastify-plugin';
import { gustoConnect, gustoCallback, gustoDisconnect } from '../controllers/gusto.controllers.js';

export default fp(async (fastify) => {
  fastify.get('/api/integrations/gusto/connect', { preHandler: [fastify.authenticate] }, gustoConnect);
  fastify.get('/api/integrations/gusto/callback', gustoCallback);
  fastify.post('/api/integrations/gusto/disconnect', { preHandler: [fastify.authenticate] }, gustoDisconnect);
});



