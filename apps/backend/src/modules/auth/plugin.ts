import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@prisma/client";
import { getUserForSessionToken, SESSION_COOKIE_NAME } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

// S'aplica directament sobre la instància arrel (no via fastify.register)
// perquè decorateRequest/addHook han d'afectar totes les rutes, no només
// les d'un subcontext encapsulat.
export function applyAuthPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest("user", null);

  fastify.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) return;
    request.user = await getUserForSessionToken(token);
  });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.code(401).send({ error: "No autenticat" });
  }
}
