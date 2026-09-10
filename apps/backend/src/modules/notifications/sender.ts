// Interfície de notificacions: envia un email real (Gmail SMTP via
// Nodemailer) i sempre desa un NotificationLog, tant si ha anat bé com si
// no (per poder-ho consultar/depurar més endavant).
import { prisma } from "../../shared/prisma.js";
import { getMailer } from "../../shared/mailer.js";

export async function sendNotification(params: {
  userId: string;
  bookingAttemptId: string;
  channel: "reminder" | "result";
  subject: string;
  body: string;
}) {
  console.log(`[notificació:${params.channel}] ${params.subject} — ${params.body}`);

  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  let status = "sent";

  if (!user) {
    status = "failed";
  } else {
    try {
      await getMailer().sendMail({
        from: `"Reserves CrossFit" <${process.env.SMTP_USER}>`,
        to: user.email,
        subject: params.subject,
        text: params.body,
      });
    } catch (err) {
      console.error("Error enviant email:", err);
      status = "failed";
    }
  }

  await prisma.notificationLog.create({
    data: {
      userId: params.userId,
      bookingAttemptId: params.bookingAttemptId,
      channel: params.channel,
      status,
    },
  });
}
