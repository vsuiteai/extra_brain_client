import fp from 'fastify-plugin';
import {
  updateProfilePicture,
  getUser,
  updatePersonalInfo,
  updateContactInfo,
  updateEmailNotifPreferences,
  updateMoreActivity,
  changePassword,
} from '../controllers/user.controllers.js';

export default fp(async (fastify) => {
  fastify.post('/api/user/:userId/profile-picture', { preHandler: [fastify.authenticate] }, updateProfilePicture);
  fastify.get('/api/user/:userId', { preHandler: [fastify.authenticate] }, getUser);
  fastify.put('/api/user/:userId/personal-info', { preHandler: [fastify.authenticate] }, updatePersonalInfo);
  fastify.put('/api/user/:userId/contact-info', { preHandler: [fastify.authenticate] }, updateContactInfo);
  fastify.put('/api/user/:userId/email-notif-preferences', { prehandler: [fastify.authenticate] }, updateEmailNotifPreferences);
  fastify.put('/api/user/:userId/more-activity', { preHandler: [fastify.authenticate] }, updateMoreActivity);
  fastify.put('/api/user/:userId/change-password', { preHandler: [fastify.authenticate] }, changePassword);
});