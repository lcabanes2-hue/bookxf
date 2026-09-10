// Utilitat temporal de desenvolupament.
// Ús: npx tsx src/scripts/delete-aimharder-credential.ts --email="..."
import "../shared/load-env.js";
import { prisma } from "../shared/prisma.js";

function getArg(name: string): string | undefined {
  const prefix = `--${name}`;
  const arg = process.argv.find((a) => a.startsWith(prefix + "="));
  return arg?.slice(prefix.length + 1);
}

async function main() {
  const email = getArg("email");
  if (!email) {
    console.error('Ús: --email="..."');
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error("Usuari no trobat");
    process.exit(1);
  }
  await prisma.aimharderCredential.deleteMany({ where: { userId: user.id } });
  console.log(`Credencial d'AimHarder eliminada per a ${email}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
