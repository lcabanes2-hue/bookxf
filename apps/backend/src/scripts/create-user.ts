// Crea un usuari de l'app (no d'AimHarder). No hi ha registre públic
// perquè és una app privada per a la família.
//
// Ús: npx tsx src/scripts/create-user.ts --name "Lluís" --email lluis@example.com --password "una-contrasenya-forta"
import "../shared/load-env.js";
import { prisma } from "../shared/prisma.js";
import { hashPassword } from "../shared/password.js";

function getArg(name: string): string | undefined {
  const prefix = `--${name}`;
  const arg = process.argv.find((a) => a.startsWith(prefix + "="));
  return arg?.slice(prefix.length + 1);
}

async function main() {
  const name = getArg("name");
  const email = getArg("email");
  const password = getArg("password");

  if (!name || !email || !password) {
    console.error(
      'Ús: npx tsx src/scripts/create-user.ts --name="Nom" --email="email@exemple.com" --password="contrasenya"'
    );
    process.exit(1);
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: hashPassword(password),
      mustChangePassword: true,
    },
  });

  console.log(`Usuari creat: ${user.id} (${user.email})`);
}

main()
  .catch((err) => {
    console.error("Error creant l'usuari:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
