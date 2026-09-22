// Scheduler de precisió: per cada ScheduleSlot actiu, calcula quan s'obre
// la propera reserva i dispara la petició real a AimHarder just en aquell
// moment (amb reintents curts). Viu dins el mateix procés del backend
// (Map de setTimeout en memòria), amb la BD com a font de veritat i
// re-armat de tot a l'arrencada — veure el pla del projecte per context.
import { prisma } from "../../shared/prisma.js";
import { decryptSecret } from "../../shared/crypto.js";
import { calendarDateForWeekday, combineDateAndTime, toAimharderDay, toISODate } from "../../shared/dates.js";
import { sendNotification } from "../notifications/sender.js";
import {
  AimharderError,
  bookClass,
  getClassesForDay,
  loginToAimharder,
} from "../aimharder-client/client.js";
import type { BookingAttempt, ScheduleSlot } from "@prisma/client";

const BOOKING_OPEN_LEAD_MS = 24 * 60 * 60 * 1000; // el gimnàs obre reserves 24h abans
const REMINDER_LEAD_MS = 6 * 60 * 60 * 1000; // avís 6h abans que obri
const RETRY_BURST_MS = 20 * 1000; // finestra de reintents un cop obre
const RETRY_INTERVAL_MS = 300;
const MISSED_GRACE_MS = 10 * 60 * 1000; // si ens hem passat més d'això, no ho intentem tard
const RESYNC_INTERVAL_MS = 30 * 60 * 1000;
// Fem login i busquem l'id de la classe uns segons ABANS que obri, perquè
// a l'obrir de veritat l'única petició de xarxa que calgui fer sigui la
// de reservar. Sense això, el primer intent no arribava a AimHarder fins
// 1-3s després de l'obertura real (temps de login + consulta de classes),
// temps de sobra perquè altra gent es quedi les últimes places.
const PREP_LEAD_MS = 8 * 1000;

const bookTimers = new Map<string, NodeJS.Timeout>();
const reminderTimers = new Map<string, NodeJS.Timeout>();
const prepTimers = new Map<string, NodeJS.Timeout>();

interface PreparedBooking {
  cookies: string;
  boxSubdomain: string;
  classId: number;
}
const preparedAttempts = new Map<string, PreparedBooking>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearTimersFor(attemptId: string) {
  const bookTimer = bookTimers.get(attemptId);
  if (bookTimer) {
    clearTimeout(bookTimer);
    bookTimers.delete(attemptId);
  }
  const reminderTimer = reminderTimers.get(attemptId);
  if (reminderTimer) {
    clearTimeout(reminderTimer);
    reminderTimers.delete(attemptId);
  }
  const prepTimer = prepTimers.get(attemptId);
  if (prepTimer) {
    clearTimeout(prepTimer);
    prepTimers.delete(attemptId);
  }
  preparedAttempts.delete(attemptId);
}

// Fa login i resol l'id de la classe amb antelació, i ho deixa en memòria
// perquè runBookingProcess el pugui fer servir directament. És només una
// optimització de velocitat: si falla per qualsevol motiu, runBookingProcess
// ho torna a fer tot des de zero com abans.
async function prepareAttempt(attemptId: string) {
  try {
    const attempt = await prisma.bookingAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.status !== "PROGRAMADA") return;

    const credential = await prisma.aimharderCredential.findUnique({ where: { userId: attempt.userId } });
    if (!credential) return;

    const login = await loginToAimharder(credential.aimharderEmail, decryptSecret(credential.encryptedPassword));
    const classes = await getClassesForDay(
      login.cookies,
      login.boxSubdomain,
      credential.boxId,
      toAimharderDay(attempt.targetClassDate)
    );
    const match = classes.find(
      (c) => c.time.startsWith(attempt.targetClassTime) && c.className === attempt.className
    );
    if (!match) return;

    preparedAttempts.set(attemptId, {
      cookies: login.cookies,
      boxSubdomain: login.boxSubdomain,
      classId: match.id,
    });
  } catch (err) {
    console.error(`Error preparant per endavant l'attempt ${attemptId}:`, err);
  }
}

// `skipDate` (format YYYY-MM-DD) només cal quan es crida just després de
// resoldre un intent per aquella data concreta (per encadenar la setmana
// següent en el mateix instant, abans que la BD reflecteixi el canvi).
//
// A més, per cada data candidata: si ja hi ha un intent RESOLT (no
// PROGRAMADA) que coincideix amb la configuració ACTUAL del slot
// (mateixa hora i classe) és que aquella ocurrència ja s'ha gestionat de
// veritat (reservada, error, etc.) — avancem a la setmana següent en
// lloc de duplicar-la. Si l'intent resolt és d'una configuració DIFERENT
// (per exemple d'una classe que l'usuari ja ha canviat), es considera
// historial obsolet i s'ignora — es crea un intent nou igualment (així
// no repeteix el bug on l'historial d'una altra classe feia saltar la
// data real moltes setmanes endavant).
async function materializeAttemptForSlot(
  slot: ScheduleSlot,
  skipDate?: string
): Promise<BookingAttempt | null> {
  if (!slot.active || !slot.time) return null;

  let candidateDate = calendarDateForWeekday(slot.weekday);
  if (combineDateAndTime(candidateDate, slot.time).getTime() <= Date.now()) {
    candidateDate = new Date(candidateDate);
    candidateDate.setDate(candidateDate.getDate() + 7);
  }

  for (let i = 0; i < 6; i++) {
    const targetClassDate = toISODate(candidateDate);

    if (skipDate && targetClassDate === skipDate) {
      candidateDate = new Date(candidateDate);
      candidateDate.setDate(candidateDate.getDate() + 7);
      continue;
    }

    const openAt = new Date(combineDateAndTime(candidateDate, slot.time).getTime() - BOOKING_OPEN_LEAD_MS);
    const existing = await prisma.bookingAttempt.findFirst({
      where: { scheduleSlotId: slot.id, targetClassDate },
    });

    if (!existing) {
      return prisma.bookingAttempt.create({
        data: {
          userId: slot.userId,
          scheduleSlotId: slot.id,
          targetClassDate,
          targetClassTime: slot.time,
          className: slot.className,
          status: "PROGRAMADA",
          openAt,
        },
      });
    }

    if (existing.status === "PROGRAMADA") {
      if (existing.targetClassTime !== slot.time || existing.className !== slot.className) {
        return prisma.bookingAttempt.update({
          where: { id: existing.id },
          data: {
            targetClassTime: slot.time,
            className: slot.className,
            aimharderClassId: null,
            openAt,
          },
        });
      }
      return existing;
    }

    const matchesCurrentConfig =
      existing.targetClassTime === slot.time && existing.className === slot.className;
    if (matchesCurrentConfig) {
      // Ja resolt per aquesta configuració exacta: setmana següent.
      candidateDate = new Date(candidateDate);
      candidateDate.setDate(candidateDate.getDate() + 7);
      continue;
    }

    // Historial obsolet (d'una altra classe/hora): l'ignorem i creem
    // l'intent nou per a la configuració actual.
    return prisma.bookingAttempt.create({
      data: {
        userId: slot.userId,
        scheduleSlotId: slot.id,
        targetClassDate,
        targetClassTime: slot.time,
        className: slot.className,
        status: "PROGRAMADA",
        openAt,
      },
    });
  }

  return null;
}

function armTimers(attempt: BookingAttempt) {
  clearTimersFor(attempt.id);
  if (attempt.status !== "PROGRAMADA") return;

  const now = Date.now();
  const openAtMs = attempt.openAt.getTime();

  if (openAtMs > now) {
    bookTimers.set(
      attempt.id,
      setTimeout(() => runBookingProcess(attempt.id), openAtMs - now)
    );

    const prepAtMs = openAtMs - PREP_LEAD_MS;
    prepTimers.set(
      attempt.id,
      setTimeout(() => prepareAttempt(attempt.id), Math.max(0, prepAtMs - now))
    );
  } else if (now - openAtMs <= RETRY_BURST_MS + MISSED_GRACE_MS) {
    bookTimers.set(attempt.id, setTimeout(() => runBookingProcess(attempt.id), 0));
  } else {
    prisma.bookingAttempt
      .update({
        where: { id: attempt.id },
        data: {
          status: "ERROR",
          resultMessage: "S'ha perdut la finestra de reserva (el servidor estava aturat).",
          attemptFinishedAt: new Date(),
        },
      })
      .catch((err) => console.error("Error marcant attempt com a perdut:", err));
    return;
  }

  const reminderAtMs = openAtMs - REMINDER_LEAD_MS;
  if (reminderAtMs > now) {
    reminderTimers.set(
      attempt.id,
      setTimeout(() => sendReminderIfNeeded(attempt.id), reminderAtMs - now)
    );
  } else if (openAtMs > now) {
    // Ja hauríem d'haver avisat però encara hi som a temps: avisa ara.
    sendReminderIfNeeded(attempt.id).catch((err) => console.error("Error enviant recordatori:", err));
  }
}

async function sendReminderIfNeeded(attemptId: string) {
  const alreadySent = await prisma.notificationLog.findFirst({
    where: { bookingAttemptId: attemptId, channel: "reminder" },
  });
  if (alreadySent) return;

  const attempt = await prisma.bookingAttempt.findUnique({
    where: { id: attemptId },
    include: { scheduleSlot: true },
  });
  if (!attempt || attempt.status !== "PROGRAMADA") return;

  await sendNotification({
    userId: attempt.userId,
    bookingAttemptId: attempt.id,
    channel: "reminder",
    subject: "Recordatori de reserva propera",
    body: `D'aquí poques hores intentarem reservar-te "${attempt.className ?? "la classe"}" del ${attempt.targetClassDate} a les ${attempt.targetClassTime}. Si vols canviar-ho, entra a l'app abans que s'obri la reserva.`,
  });
}

export async function runBookingProcess(attemptId: string) {
  await prisma.bookingAttempt.update({
    where: { id: attemptId },
    data: { status: "INTENTANT_RESERVAR", attemptStartedAt: new Date() },
  });

  const attempt = await prisma.bookingAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) return;

  const credential = await prisma.aimharderCredential.findUnique({
    where: { userId: attempt.userId },
  });
  if (!credential) {
    await finishAttempt(attempt.id, "ERROR", "No hi ha credencials d'AimHarder configurades", 0);
    return;
  }

  const aimharderDay = toAimharderDay(attempt.targetClassDate);

  let cookies: string;
  let boxSubdomain: string;
  let classId: number;

  // Si prepareAttempt() ja ha fet login i ha trobat l'id de la classe uns
  // segons abans (cas normal), ens estalviem aquestes dues peticions just
  // ara i anem directes a reservar. Si no hi és (arrencada del servidor a
  // mitja finestra, prep ha fallat, etc.), ho fem tot des de zero com abans.
  const prepared = preparedAttempts.get(attempt.id);
  preparedAttempts.delete(attempt.id);

  if (prepared) {
    cookies = prepared.cookies;
    boxSubdomain = prepared.boxSubdomain;
    classId = prepared.classId;
    await prisma.bookingAttempt.update({ where: { id: attempt.id }, data: { aimharderClassId: String(classId) } });
  } else {
    try {
      const login = await loginToAimharder(credential.aimharderEmail, decryptSecret(credential.encryptedPassword));
      cookies = login.cookies;
      boxSubdomain = login.boxSubdomain;
    } catch (err) {
      await finishAttempt(attempt.id, "ERROR", `No s'ha pogut iniciar sessió a AimHarder: ${message(err)}`, 0);
      return;
    }

    try {
      const classes = await getClassesForDay(cookies, boxSubdomain, credential.boxId, aimharderDay);
      const match = classes.find(
        (c) => c.time.startsWith(attempt.targetClassTime) && c.className === attempt.className
      );
      if (!match) {
        await finishAttempt(attempt.id, "ERROR", "No s'ha trobat aquesta classe al calendari d'AimHarder d'aquell dia", 0);
        return;
      }
      classId = match.id;
      await prisma.bookingAttempt.update({ where: { id: attempt.id }, data: { aimharderClassId: String(classId) } });
    } catch (err) {
      await finishAttempt(attempt.id, "ERROR", `Error consultant classes: ${message(err)}`, 0);
      return;
    }
  }

  let retries = 0;
  let useInsist = false;
  let lastBookState: number | null = null;
  let reservationId: string | null = null;
  const deadline = Date.now() + RETRY_BURST_MS;

  while (Date.now() < deadline) {
    retries++;
    try {
      const result = await bookClass(cookies, boxSubdomain, classId, aimharderDay, useInsist);
      lastBookState = result.bookState;
      reservationId = result.reservationId;

      if (lastBookState === 1 || lastBookState === 0) break;
      if (lastBookState === -1) {
        useInsist = true; // classe plena: a partir d'ara intenta llista d'espera
      }
      if (lastBookState === -2 || lastBookState === -5 || lastBookState === -7) break;
    } catch (err) {
      if (err instanceof AimharderError) {
        // Sessió caducada o similar: re-login i seguim intentant.
        try {
          const login = await loginToAimharder(
            credential.aimharderEmail,
            decryptSecret(credential.encryptedPassword)
          );
          cookies = login.cookies;
        } catch {
          // si el re-login falla, esperem i tornem a provar
        }
      }
    }
    await sleep(RETRY_INTERVAL_MS);
  }

  if ((lastBookState === 1 || lastBookState === 0) && reservationId) {
    const finalStatus = useInsist ? "LLISTA_ESPERA" : "RESERVADA";
    await prisma.bookingAttempt.update({
      where: { id: attempt.id },
      data: { reservationId },
    });
    await finishAttempt(
      attempt.id,
      finalStatus,
      finalStatus === "RESERVADA"
        ? "Reserva feta. AimHarder no sempre distingeix una plaça confirmada d'una entrada a la llista d'espera en aquest primer pas: si la classe ja estava plena, comprova-ho a l'app o al correu d'AimHarder per assegurar-te."
        : "A la llista d'espera (la classe estava plena)",
      retries
    );
  } else {
    const messages: Record<number, string> = {
      [-2]: "No tens cap tarifa contractada que inclogui aquesta classe",
      [-5]: "Tens un pagament pendent a AimHarder",
      [-7]: "S'ha reservat massa tard (la finestra ja havia tancat)",
    };
    const msg =
      (lastBookState !== null ? messages[lastBookState] : undefined) ??
      "No s'ha pogut confirmar la reserva dins el temps disponible";
    await finishAttempt(attempt.id, "ERROR", msg, retries);
  }

  // Encadena la propera setmana d'aquest slot (mai la mateixa data que
  // acabem de resoldre).
  if (attempt.scheduleSlotId) {
    const slot = await prisma.scheduleSlot.findUnique({ where: { id: attempt.scheduleSlotId } });
    if (slot) await syncSlotRecord(slot, attempt.targetClassDate);
  }
}

async function finishAttempt(
  attemptId: string,
  status: "RESERVADA" | "LLISTA_ESPERA" | "ERROR",
  message: string,
  retries: number
) {
  const attempt = await prisma.bookingAttempt.update({
    where: { id: attemptId },
    data: { status, resultMessage: message, retriesCount: retries, attemptFinishedAt: new Date() },
  });

  // Abans només avisàvem per LLISTA_ESPERA/ERROR (per RESERVADA es confiava
  // en l'email propi d'AimHarder). Descobert que AimHarder pot respondre
  // "reservada" (bookState 0/1) encara que en realitat hagis entrat a la
  // llista d'espera real (classes amb aforament + cua, p.ex. "14 (4)") —
  // no ho distingeix de manera fiable, i cap projecte de la comunitat ho
  // té resolt tampoc. Per no deixar mai ningú sense avís, ara enviem
  // sempre el nostre email, també quan sembla "RESERVADA".
  const subject =
    status === "RESERVADA" ? "🟢 Reserva feta" : status === "LLISTA_ESPERA" ? "🟡 A la llista d'espera" : "🔴 Error reservant";
  await sendNotification({
    userId: attempt.userId,
    bookingAttemptId: attempt.id,
    channel: "result",
    subject,
    body: `${attempt.className ?? "Classe"} del ${attempt.targetClassDate} a les ${attempt.targetClassTime}: ${message}`,
  });
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function cancelFutureAttemptsForSlot(slotId: string) {
  const attempts = await prisma.bookingAttempt.findMany({
    where: { scheduleSlotId: slotId, status: "PROGRAMADA" },
  });
  for (const attempt of attempts) {
    clearTimersFor(attempt.id);
    await prisma.bookingAttempt.update({ where: { id: attempt.id }, data: { status: "CANCELLADA" } });
  }
}

export async function syncSlotRecord(slot: ScheduleSlot, skipDate?: string) {
  if (!slot.active || !slot.time) {
    await cancelFutureAttemptsForSlot(slot.id);
    return;
  }
  const attempt = await materializeAttemptForSlot(slot, skipDate);
  if (attempt) armTimers(attempt);
}

export async function onScheduleSlotChanged(slotId: string) {
  const slot = await prisma.scheduleSlot.findUnique({ where: { id: slotId } });
  if (slot) await syncSlotRecord(slot);
}

export async function syncAllSchedules() {
  const slots = await prisma.scheduleSlot.findMany({ where: { active: true } });
  for (const slot of slots) {
    try {
      await syncSlotRecord(slot);
    } catch (err) {
      console.error(`Error sincronitzant ScheduleSlot ${slot.id}:`, err);
    }
  }
}

export function startScheduler() {
  syncAllSchedules().catch((err) => console.error("Error a la sincronització inicial del scheduler:", err));
  setInterval(() => {
    syncAllSchedules().catch((err) => console.error("Error a la resincronització periòdica:", err));
  }, RESYNC_INTERVAL_MS);
}
