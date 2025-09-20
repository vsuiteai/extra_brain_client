import fp from 'fastify-plugin';

import {
  getMarketShare,
  getSimulationByStatus,
  filterSimulationsByTimeframe,
  getCompetitiveIndexScore,
  getScenarioROI
} from '../controllers/strategicsim.controllers';


export default fp(async (fastify) => {
  fastify.get('/api/strategicsim/kpis/:companyId/market-share', { preHandler: [fastify.authenticate] }, getMarketShare);
  fastify.get('/strategicSim/simulations/:companyId/:status', { preHandler: [fastify.authenticate] }, getSimulationByStatus);
  fastify.get('/strategicSim/simulations/:companyId/timeframe/:days', { preHandler: [fastify.authenticate] }, filterSimulationsByTimeframe);
  fastify.get('/strategicSim/simulations/:companyId/competitive-index-score', { preHandler: [fastify.authenticate] }, getCompetitiveIndexScore);
  fastify.get('/strategicSim/simulations/:companyId/scenario-roi', { preHandler: [fastify.authenticate] }, getScenarioROI);
});