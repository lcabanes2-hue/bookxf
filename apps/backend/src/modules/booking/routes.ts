import type { FastifyInstance } from "fastify";
import { prisma } from "../../shared/prisma.js";
import { requireAuth } from "../auth/plugin.js";

export async function bookingRoutes(fastify: FastifyInstance) {
  // Intents encara pendents (per mostrar l'avís/confirmació a l'app el dia
  // que toca obrir la reserva).
  fastify.get("/api/booking/upcoming", { preHandler: requireAuth }, async (request) => {
    const attempts = await prisma.bookingAttempt.findMany({
      where: { userId: request.user!.id, status: { in: ["PROGRAMADA", "INTENTANT_RESERVAR"] } },
      orderBy: { openAt: "asc" },
    });
    return attempts.map((a) => ({
      id: a.id,
      targetClassDate: a.targetClassDate,
      targetClassTime: a.targetClassTime,
      className: a.className,
      status: a.status,
      openAt: a.openAt,
    }));
  });

  fastify.get("/api/booking/history", { preHandler: requireAuth }, async (request) => {
    const attempts = await prisma.bookingAttempt.findMany({
      where: { userId: request.user!.id, status: { in: ["RESERVADA", "LLISTA_ESPERA", "ERROR", "CANCELLADA"] } },
      orderBy: { openAt: "desc" },
      take: 20,
    });
    return attempts.map((a) => ({
      id: a.id,
      targetClassDate: a.targetClassDate,
      targetClassTime: a.targetClassTime,
      className: a.className,
      status: a.status,
      resultMessage: a.resultMessage,
    }));
  });
}
