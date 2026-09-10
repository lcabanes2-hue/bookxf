// Client d'AimHarder (enginyeria inversa, validada manualment a la Fase 0
// amb el compte real de l'usuari — veure CLAUDE.md per als detalls i el
// bug ja detectat de l'id de cancel·lació).
//
// Únic punt del codi que coneix els endpoints reals d'AimHarder: si
// AimHarder canvia res, només cal tocar aquest fitxer.
import { randomBytes } from "node:crypto";

export class AimharderError extends Error {}

function extractCookies(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

export interface AimharderLoginResult {
  cookies: string;
  boxSubdomain: string;
  boxId: string;
  userName: string;
}

export async function loginToAimharder(
  email: string,
  password: string
): Promise<AimharderLoginResult> {
  const fingerprint = randomBytes(16).toString("hex");

  const response = await fetch("https://login.aimharder.com/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: email, password, fingerprint, iniframe: 0 }),
  });

  const cookies = extractCookies(response);
  if (!cookies) {
    throw new AimharderError("Login incorrecte: email o contrasenya no vàlids");
  }

  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new AimharderError("Resposta inesperada d'AimHarder en el login");
  }

  const role = body?.data?.userData?.roles?.[0];
  if (!role?.centre_url || !role?.boid) {
    throw new AimharderError("No s'ha pogut trobar el gimnàs (box) del compte");
  }

  return {
    cookies,
    boxSubdomain: role.centre_url as string,
    boxId: String(role.boid),
    userName: body?.data?.userData?.name ?? "",
  };
}

export interface AimharderClass {
  id: number;
  time: string;
  timeId: string;
  className: string;
  limit: number;
  occupation: number;
  bookState: number | null;
}

export async function getClassesForDay(
  cookies: string,
  boxSubdomain: string,
  boxId: string,
  day: string // "YYYYMMDD"
): Promise<AimharderClass[]> {
  const url = `https://${boxSubdomain}/api/bookings?day=${day}&box=${boxId}&familyId=`;
  const response = await fetch(url, { headers: { Cookie: cookies } });

  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new AimharderError("Resposta inesperada d'AimHarder consultant classes");
  }

  if (body?.logout) {
    throw new AimharderError("La sessió amb AimHarder ha caducat");
  }

  const bookings = Array.isArray(body?.bookings) ? body.bookings : [];
  return bookings.map((b: any) => ({
    id: b.id,
    time: b.time,
    timeId: b.timeid,
    className: b.className,
    limit: b.limit,
    occupation: b.ocupation,
    bookState: b.bookState ?? null,
  }));
}

export interface AimharderBookResult {
  bookState: number;
  reservationId: string;
}

export async function bookClass(
  cookies: string,
  boxSubdomain: string,
  classId: number,
  day: string,
  insist: boolean,
  familyId = ""
): Promise<AimharderBookResult> {
  const response = await fetch(`https://${boxSubdomain}/api/book`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
    body: new URLSearchParams({
      id: String(classId),
      day,
      insist: insist ? "1" : "0",
      familyId,
    }),
  });

  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new AimharderError("Resposta inesperada d'AimHarder reservant la classe");
  }

  if (body?.logout) {
    throw new AimharderError("La sessió amb AimHarder ha caducat");
  }

  return { bookState: body.bookState, reservationId: String(body.id) };
}

export async function cancelBooking(
  cookies: string,
  boxSubdomain: string,
  reservationId: string,
  day: string,
  familyId = ""
): Promise<{ cancelState: number }> {
  // IMPORTANT: reservationId ha de ser el que retorna bookClass()
  // (bookResult.reservationId), NO l'id de la franja horària — veure
  // CLAUDE.md per l'explicació del bug que ho va provocar.
  const response = await fetch(`https://${boxSubdomain}/api/cancelBook`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
    body: new URLSearchParams({ id: reservationId, day, familyId }),
  });

  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new AimharderError("Resposta inesperada d'AimHarder cancel·lant la reserva");
  }

  return { cancelState: body.cancelState };
}
