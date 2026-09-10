// Utilitat temporal de desenvolupament per restablir una contrasenya.
// Ús: npx tsx src/scripts/reset-password.ts --email="..." --password="..."
import "../shared/load-env.js";
import { prisma } from "../shared/prisma.js";
import { hashPassword } from "../shared/password.js";

function getArg(name: string): string | undefined {
  const prefix = `--${name}`;
  const arg = process.argv.find((a) => a.startsWith(prefix + "="));
  return arg?.slice(prefix.length + 1);
}

async function main() {
  const email = getArg("email");
  const password = getArg("password");
  if (!email || !password) {
    console.error('Ús: --email="..." --password="..."');
    process.exit(1);
  }
  await prisma.user.update({
    where: { email },
    data: { passwordHash: hashPassword(password), mustChangePassword: true },
  });
  console.log(`Contrasenya restablerta per ${email}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
