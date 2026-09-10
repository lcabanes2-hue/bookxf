import "../shared/load-env.js";
import { prisma } from "../shared/prisma.js";

const users = await prisma.user.findMany({
  include: { aimharderCredential: true, scheduleSlots: { where: { active: true } } },
});
for (const u of users) {
  console.log(`${u.email}: aimharder=${u.aimharderCredential ? "sí" : "no"}, mustChangePassword=${u.mustChangePassword}`);
  for (const s of u.scheduleSlots) {
    console.log(`  weekday=${s.weekday} time=${s.time} className=${s.className}`);
  }
}
const attempts = await prisma.bookingAttempt.findMany({ orderBy: { createdAt: "asc" } });
console.log("\nTots els BookingAttempts:");
for (const a of attempts) {
  console.log(`  id=${a.id} ${a.targetClassDate} ${a.targetClassTime} ${a.className} -> ${a.status} (created ${a.createdAt.toISOString()})`);
}
await prisma.$disconnect();
