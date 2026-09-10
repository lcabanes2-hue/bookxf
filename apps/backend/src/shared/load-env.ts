// Carrega variables d'entorn des de ".env" (a la carpeta apps/backend).
// Import només per efecte secundari, sempre com el PRIMER import del
// fitxer d'entrada (server.ts, scripts/*.ts) perquè la resta de mòduls
// (com shared/prisma.ts o shared/crypto.ts) ja trobin process.env omplert.
import { readFileSync, existsSync } from "node:fs";

const path = new URL("../../.env", import.meta.url);
if (existsSync(path)) {
  const content = readFileSync(path, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (value && process.env[key] === undefined) process.env[key] = value;
  }
}
