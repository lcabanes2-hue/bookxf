// Xifratge reversible per a la contrasenya del compte d'AimHarder de cada
// usuari (a diferència de la contrasenya de login de l'app, aquesta l'hem
// de poder recuperar en clar per fer login contra AimHarder en nom seu).
//
// La clau mestra viu NOMÉS a la variable d'entorn MASTER_KEY del servidor,
// mai a la base de dades ni al frontend.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const masterKey = process.env.MASTER_KEY;
  if (!masterKey) {
    throw new Error("Falta la variable d'entorn MASTER_KEY");
  }
  return scryptSync(masterKey, "aimharder-credentials", 32);
}

export function encryptSecret(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivHex, authTagHex, encryptedHex] = payload.split(":");
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error("Format de secret xifrat no vàlid");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
