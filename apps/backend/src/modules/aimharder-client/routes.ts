import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../shared/prisma.js";
import { encryptSecret, decryptSecret } from "../../shared/crypto.js";
import { requireAuth } from "../auth/plugin.js";
import { AimharderError, getClassesForDay, loginToAimharder } from "./client.js";
import { calendarDateForWeekday, toAimharderDay, toISODate } from "../../shared/dates.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function aimharderRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/aimharder/credentials",
    { preHandler: requireAuth },
    async (request) => {
      const cred = await prisma.aimharderCredential.findUnique({
        where: { userId: request.user!.id },
      });
      if (!cred) return { configured: false };
      return {
        configured: true,
        email: cred.aimharderEmail,
        boxSubdomain: cred.boxSubdomain,
      };
    }
  );

  fastify.post(
    "/api/aimharder/credentials",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = credentialsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Email o contrasenya no vàlids" });
      }

      let login;
      try {
        login = await loginToAimharder(parsed.data.email, parsed.data.password);
      } catch (err) {
        if (err instanceof AimharderError) {
          return reply.code(400).send({ error: err.message });
        }
        return reply.code(502).send({ error: "No s'ha pogut contactar amb AimHarder" });
      }

      await prisma.aimharderCredential.upsert({
        where: { userId: request.user!.id },
        create: {
          userId: request.user!.id,
          aimharderEmail: parsed.data.email,
          encryptedPassword: encryptSecret(parsed.data.password),
          boxSubdomain: login.boxSubdomain,
          boxId: login.boxId,
        },
        update: {
          aimharderEmail: parsed.data.email,
          encryptedPassword: encryptSecret(parsed.data.password),
          boxSubdomain: login.boxSubdomain,
          boxId: login.boxId,
        },
      });

      return { configured: true, email: parsed.data.email, boxSubdomain: login.boxSubdomain };
    }
  );

  fastify.get(
    "/api/aimharder/classes",
    { preHandler: requireAuth },
    async (request, reply) => {
      const weekday = Number((request.query as { weekday?: string }).weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        return reply.code(400).send({ error: "weekday ha de ser un número de 0 a 6" });
      }

      const cred = await prisma.aimharderCredential.findUnique({
        where: { userId: request.user!.id },
      });
      if (!cred) {
        return reply.code(400).send({ error: "Encara no has configurat el compte d'AimHarder" });
      }

      const day = toAimharderDay(toISODate(calendarDateForWeekday(weekday)));
      try {
        const login = await loginToAimharder(cred.aimharderEmail, decryptSecret(cred.encryptedPassword));
        const classes = await getClassesForDay(login.cookies, cred.boxSubdomain, cred.boxId, day);
        return { day, classes };
      } catch (err) {
        if (err instanceof AimharderError) {
          return reply.code(400).send({ error: err.message });
        }
        return reply.code(502).send({ error: "No s'ha pogut contactar amb AimHarder" });
      }
    }
  );
}
