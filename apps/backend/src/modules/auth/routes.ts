import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../shared/prisma.js";
import { hashPassword, verifyPassword } from "../../shared/password.js";
import { createSession, destroySession, SESSION_COOKIE_NAME } from "./session.js";
import { requireAuth } from "./plugin.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "La contrasenya ha de tenir almenys 8 caràcters"),
});

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dades de login no vàlides" });
    }

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    const ok = user && verifyPassword(parsed.data.password, user.passwordHash);
    if (!ok || !user) {
      return reply.code(401).send({ error: "Email o contrasenya incorrectes" });
    }

    const { token, expiresAt } = await createSession(user.id);
    reply.setCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      mustChangePassword: user.mustChangePassword,
    };
  });

  fastify.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token) await destroySession(token);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  fastify.get("/api/auth/me", { preHandler: requireAuth }, async (request) => {
    const user = request.user!;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      mustChangePassword: user.mustChangePassword,
    };
  });

  fastify.post(
    "/api/auth/change-password",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Dades no vàlides" });
      }

      const user = request.user!;
      if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
        return reply.code(401).send({ error: "La contrasenya actual no és correcta" });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashPassword(parsed.data.newPassword),
          mustChangePassword: false,
        },
      });

      return { ok: true };
    }
  );
}
