import "../shared/load-env.js";
import { prisma } from "../shared/prisma.js";

function getArg(name: string) {
  const prefix = `--${name}`;
  return process.argv.find((a) => a.startsWith(prefix + "="))?.slice(prefix.length + 1);
}

async function main() {
  const attemptId = getArg("attemptId");
  if (!attemptId) throw new Error('Ús: --attemptId="..."');
  await prisma.notificationLog.deleteMany({ where: { bookingAttemptId: attemptId } });
  await prisma.bookingAttempt.delete({ where: { id: attemptId } });
  console.log("Netejat.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
