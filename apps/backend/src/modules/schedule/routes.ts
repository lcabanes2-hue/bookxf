import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../shared/prisma.js";
import { requireAuth } from "../auth/plugin.js";
import { onScheduleSlotChanged } from "../scheduler/engine.js";

const setSlotSchema = z.object({
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format d'hora no vàlid (HH:mm)")
    .nullable(),
  className: z.string().trim().min(1).nullable().optional(),
});

export async function scheduleRoutes(fastify: FastifyInstance) {
  fastify.get("/api/schedule/week", { preHandler: requireAuth }, async (request) => {
    const slots = await prisma.scheduleSlot.findMany({
      where: { userId: request.user!.id, active: true },
      orderBy: { weekday: "asc" },
    });

    const byWeekday = new Map(slots.map((s) => [s.weekday, s]));
    return Array.from({ length: 7 }, (_, weekday) => {
      const slot = byWeekday.get(weekday);
      return {
        weekday,
        time: slot?.time ?? null,
        className: slot?.className ?? null,
      };
    });
  });

  fastify.put(
    "/api/schedule/week/:weekday",
    { preHandler: requireAuth },
    async (request, reply) => {
      const weekday = Number((request.params as { weekday: string }).weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        return reply.code(400).send({ error: "weekday ha de ser un número de 0 a 6" });
      }

      const parsed = setSlotSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Dades no vàlides" });
      }

      const userId = request.user!.id;
      let slotId: string | null = null;

      if (parsed.data.time) {
        const slot = await prisma.scheduleSlot.upsert({
          where: { userId_weekday: { userId, weekday } },
          update: { time: parsed.data.time, className: parsed.data.className ?? null, active: true },
          create: {
            userId,
            weekday,
            time: parsed.data.time,
            className: parsed.data.className ?? null,
            active: true,
          },
        });
        slotId = slot.id;
      } else {
        const slot = await prisma.scheduleSlot.findUnique({
          where: { userId_weekday: { userId, weekday } },
        });
        if (slot) {
          await prisma.scheduleSlot.update({ where: { id: slot.id }, data: { active: false } });
          slotId = slot.id;
        }
      }

      if (slotId) {
        onScheduleSlotChanged(slotId).catch((err) =>
          request.log.error(err, "Error sincronitzant el scheduler després d'editar la planificació")
        );
      }

      return { ok: true };
    }
  );
}
