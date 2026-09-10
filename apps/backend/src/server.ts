import "./shared/load-env.js";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import { applyAuthPlugin } from "./modules/auth/plugin.js";
import { authRoutes } from "./modules/auth/routes.js";
import { scheduleRoutes } from "./modules/schedule/routes.js";
import { aimharderRoutes } from "./modules/aimharder-client/routes.js";
import { bookingRoutes } from "./modules/booking/routes.js";
import { startScheduler } from "./modules/scheduler/engine.js";

const app = Fastify({ logger: true });

await app.register(cookie);
applyAuthPlugin(app);
await app.register(authRoutes);
await app.register(scheduleRoutes);
await app.register(aimharderRoutes);
await app.register(bookingRoutes);

app.get("/api/health", async () => ({ ok: true }));

await app.register(staticFiles, {
  root: fileURLToPath(new URL("../public", import.meta.url)),
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

startScheduler();
