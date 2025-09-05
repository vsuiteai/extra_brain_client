import fp from 'fastify-plugin';

import {
  getCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany
} from "../controllers/companies.controllers.js";

export default fp(async (fastify) => {
  fastify.get("/companies", { preHandler: [fastify.authenticate] }, getCompanies);
  fastify.get("/companies/:id", { preHandler: [fastify.authenticate] }, getCompany);
  fastify.post("/companies", { preHandler: [fastify.authenticate] }, createCompany);
  fastify.put("/companies/:id", { preHandler: [fastify.authenticate] }, updateCompany);
  fastify.delete("/companies/:id", { preHandler: [fastify.authenticate] }, deleteCompany);
});
