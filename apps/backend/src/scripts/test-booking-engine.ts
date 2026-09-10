// Prova d'integració temporal del motor de reserves (scheduler/engine.ts)
// contra AimHarder real. Crea un BookingAttempt manual (sense passar per
// ScheduleSlot ni pel càlcul de les 24h) i crida runBookingProcess()
// directament, per validar tot el mecanisme abans de confiar-hi sense
// vigilància durant 24h reals.
import "../shared/load-env.js";
import { prisma } from "../shared/prisma.js";
import { runBookingProcess } from "../modules/scheduler/engine.js";
import { toISODate } from "../shared/dates.js";

function getArg(name: string): string | undefined {
  const prefix = `--${name}`;
  return process.argv.find((a) => a.startsWith(prefix + "="))?.slice(prefix.length + 1);
}

async function main() {
  const email = getArg("email");
  const time = getArg("time");
  const className = getArg("className");
  if (!email || !time || !className) {
    console.error('Ús: --email="..." --time="16:30" --className="OPEN BOX"');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("Usuari no trobat");

  const attempt = await prisma.bookingAttempt.create({
    data: {
      userId: user.id,
      targetClassDate: toISODate(new Date()),
      targetClassTime: time,
      className,
      status: "PROGRAMADA",
      openAt: new Date(Date.now() - 1000),
    },
  });

  console.log("BookingAttempt de prova creat:", attempt.id);
  console.log("Executant runBookingProcess()...\n");

  await runBookingProcess(attempt.id);

  const result = await prisma.bookingAttempt.findUnique({ where: { id: attempt.id } });
  console.log("\nResultat final:", JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
