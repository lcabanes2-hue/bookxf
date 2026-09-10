import "../shared/load-env.js";
import { prisma } from "../shared/prisma.js";
import { decryptSecret } from "../shared/crypto.js";
import { loginToAimharder, cancelBooking, getClassesForDay } from "../modules/aimharder-client/client.js";
import { toAimharderDay } from "../shared/dates.js";

function getArg(name: string) {
  const prefix = `--${name}`;
  return process.argv.find((a) => a.startsWith(prefix + "="))?.slice(prefix.length + 1);
}

async function main() {
  const attemptId = getArg("attemptId");
  if (!attemptId) throw new Error('Ús: --attemptId="..."');

  const attempt = await prisma.bookingAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const cred = await prisma.aimharderCredential.findUniqueOrThrow({ where: { userId: attempt.userId } });
  const login = await loginToAimharder(cred.aimharderEmail, decryptSecret(cred.encryptedPassword));

  const day = toAimharderDay(attempt.targetClassDate);
  const result = await cancelBooking(login.cookies, cred.boxSubdomain, attempt.reservationId!, day);
  console.log("cancelBooking result:", result);

  const classes = await getClassesForDay(login.cookies, cred.boxSubdomain, cred.boxId, day);
  const match = classes.find((c) => c.id === Number(attempt.aimharderClassId));
  console.log("Estat real després de cancel·lar (bookState hauria de ser null):", match?.bookState);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
