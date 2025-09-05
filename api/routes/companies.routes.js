import fp from 'fastify-plugin';

import {
  getCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany
} from "../controllers/companies.controllers.js";

export default fp(async (fastify) => {
  fastify.get("/api/companies", { preHandler: [fastify.authenticate] }, getCompanies);
  fastify.get("/api/companies/:id", { preHandler: [fastify.authenticate] }, getCompany);
  fastify.post("/api/companies", { preHandler: [fastify.authenticate] }, createCompany);
  fastify.put("/api/companies/:id", { preHandler: [fastify.authenticate] }, updateCompany);
  fastify.delete("/api/companies/:id", { preHandler: [fastify.authenticate] }, deleteCompany);
});
