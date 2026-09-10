// Interfície de notificacions. Primera implementació: només log per
// consola (i es desa sempre un NotificationLog). Substituir per email
// real (Fase 5) és només canviar aquesta funció.
import { prisma } from "../../shared/prisma.js";

export async function sendNotification(params: {
  userId: string;
  bookingAttemptId: string;
  channel: "reminder" | "result";
  subject: string;
  body: string;
}) {
  // TODO Fase 5: enviar per email de veritat (Nodemailer/SMTP). De moment
  // només ho deixem registrat perquè es pugui veure a l'historial.
  console.log(`[notificació:${params.channel}] ${params.subject} — ${params.body}`);

  await prisma.notificationLog.create({
    data: {
      userId: params.userId,
      bookingAttemptId: params.bookingAttemptId,
      channel: params.channel,
      status: "sent",
    },
  });
}
