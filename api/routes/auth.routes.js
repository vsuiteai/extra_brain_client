import fp from 'fastify-plugin';
import {
  googleAuth,
  login,
  logout,
  microsoftAuth,
  refreshTokens,
  signUp,
  forgotPassword,
  resetPassword,
  googleLogin
} from '../controllers/auth.controllers.js';

export default fp(async (fastify) => {
  fastify.post('/api/auth/login', login);
  fastify.post('/api/auth/signup', signUp);
  fastify.post('/api/auth/refresh-token', refreshTokens(fastify));
  fastify.post('/api/auth/logout', logout(fastify));
  fastify.get('/api/auth/google-login', googleLogin);
  fastify.get('/api/auth/google', googleAuth);
  fastify.post('/api/auth/microsoft', microsoftAuth);
  fastify.post('/api/auth/forgot-password', forgotPassword)
  fastify.post('/api/auth/reset-password', resetPassword);
});