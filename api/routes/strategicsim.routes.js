import fp from 'fastify-plugin';

import {
  getMarketShare,
  getSimulationByStatus,
  filterSimulationsByTimeframe,
  getCompetitiveIndexScore,
  getScenarioROI,
  searchSimulations,
  createSimulation,
  generateDeliverablesPDF,
  runScenarioSensitivity
} from '../controllers/strategicsim.controllers.js';


export default fp(async (fastify) => {
  fastify.get('/api/strategicsim/kpis/:companyId/market-share', { preHandler: [fastify.authenticate] }, getMarketShare);
  fastify.get('/api/strategicSim/simulations/:companyId/:status', { preHandler: [fastify.authenticate] }, getSimulationByStatus);
  fastify.get('/api/strategicSim/simulations/:companyId/timeframe/:days', { preHandler: [fastify.authenticate] }, filterSimulationsByTimeframe);
  fastify.get('/api/strategicSim/simulations/:companyId/competitive-index-score', { preHandler: [fastify.authenticate] }, getCompetitiveIndexScore);
  fastify.get('/api/strategicSim/simulations/:companyId/scenario-roi', { preHandler: [fastify.authenticate] }, getScenarioROI);
  fastify.get('/api/strategicSim/simulations/:companyId/search/:query', { preHandler: [fastify.authenticate] }, searchSimulations);
  fastify.post('/api/strategicSim/simulations/:companyId', { preHandler: [fastify.authenticate] }, createSimulation);
  fastify.post('/api/strategicSim/simulations/:companyId/deliverables', { preHandler: [fastify.authenticate] }, generateDeliverablesPDF);
  fastify.post('/api/strategicSim/simulations/:companyId/sensitivity', { preHandler: [fastify.authenticate] }, runScenarioSensitivity);
});