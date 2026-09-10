// Prova de connexió amb AimHarder (Fase 0 del projecte).
// Per defecte NOMÉS fa login i consulta classes, sense reservar res.
// Executar: node scripts/aimharder-spike.mjs
//
// Amb --test-book també reserva una classe OPEN BOX amb places lliures
// i la cancel·la immediatament, per validar l'endpoint de reserva real.
// Executar: node scripts/aimharder-spike.mjs --test-book

import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

function loadEnvLocal() {
  const path = new URL("../.env.local", import.meta.url);
  if (!existsSync(path)) {
    console.error(
      "No trobo el fitxer .env.local. Copia .env.local.example a .env.local i omple'l amb el teu email i contrasenya d'AimHarder."
    );
    process.exit(1);
  }
  const content = readFileSync(path, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (value) process.env[key] = value;
  }
}

function extractCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  loadEnvLocal();

  const email = process.env.AIMHARDER_EMAIL;
  const password = process.env.AIMHARDER_PASSWORD;
  const boxSubdomain = process.env.AIMHARDER_BOX_SUBDOMAIN;
  const boxId = process.env.AIMHARDER_BOX_ID;

  if (!email || !password) {
    console.error("Falten AIMHARDER_EMAIL o AIMHARDER_PASSWORD a .env.local");
    process.exit(1);
  }

  console.log("1) Provant login a AimHarder...");
  const fingerprint = randomBytes(16).toString("hex");

  const loginResponse = await fetch("https://login.aimharder.com/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: email,
      password,
      fingerprint,
      iniframe: 0,
    }),
  });

  console.log(`   Status HTTP: ${loginResponse.status}`);

  const cookies = extractCookies(loginResponse);
  console.log(`   Cookies de sessió rebudes: ${cookies ? "sí" : "NO"}`);

  let loginBody;
  try {
    loginBody = await loginResponse.json();
  } catch {
    loginBody = null;
  }

  if (loginBody) {
    // Imprimim el JSON sencer per poder-hi trobar boxId/subdomini,
    // però mai imprimim la contrasenya (no forma part d'aquesta resposta).
    console.log("   Resposta del login (per trobar-hi el box, si cal):");
    console.log(JSON.stringify(loginBody, null, 2));
  }

  if (!cookies) {
    console.error(
      "\n❌ No s'ha rebut cap cookie de sessió. El login probablement ha fallat (credencials incorrectes o format de petició no vàlid)."
    );
    process.exit(1);
  }

  console.log("\n✅ Login aparentment correcte (hem rebut cookies de sessió).");

  if (!boxSubdomain || !boxId) {
    console.log(
      "\n⚠️  No tinc AIMHARDER_BOX_SUBDOMAIN / AIMHARDER_BOX_ID a .env.local, així que no puc provar la consulta de classes."
    );
    console.log(
      "   Mira la resposta del login de dalt (o inspecciona la pestanya Xarxa del navegador quan entres a AimHarder) per trobar aquests valors i afegeix-los a .env.local."
    );
    return;
  }

  console.log("\n2) Provant consulta de classes de demà...");
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const day =
    tomorrow.getFullYear().toString() +
    String(tomorrow.getMonth() + 1).padStart(2, "0") +
    String(tomorrow.getDate()).padStart(2, "0");
  console.log(
    `   (Data de prova: ${day} — sempre "demà", mai avui, perquè cancel·lar una classe d'avui pot fer-te perdre el crèdit si falten menys de 3h)`
  );

  const bookingsUrl = `https://${boxSubdomain}/api/bookings?day=${day}&box=${boxId}&familyId=`;
  const bookingsResponse = await fetch(bookingsUrl, {
    headers: { Cookie: cookies },
  });

  console.log(`   Status HTTP: ${bookingsResponse.status}`);

  let bookingsBody;
  try {
    bookingsBody = await bookingsResponse.json();
  } catch {
    bookingsBody = await bookingsResponse.text();
  }

  console.log("   Resposta:");
  console.log(
    typeof bookingsBody === "string"
      ? bookingsBody.slice(0, 1000)
      : JSON.stringify(bookingsBody, null, 2)
  );

  console.log(
    "\n✅ Prova acabada. Revisa a dalt si s'han llistat classes correctament."
  );

  const testBook = process.argv.includes("--test-book");
  const bookOnly = process.argv.includes("--book-only");
  if (!testBook && !bookOnly) {
    console.log(
      "\n(Per provar també l'endpoint de RESERVAR, executa amb --test-book (reserva i cancel·la sol) o --book-only (reserva i la cancel·les tu manualment des de l'app))"
    );
    return;
  }

  const bookings = Array.isArray(bookingsBody?.bookings)
    ? bookingsBody.bookings
    : [];
  const candidate = bookings.find(
    (b) =>
      b.className === "OPEN BOX" && !b.bookState && b.ocupation < b.limit
  );

  if (!candidate) {
    console.log(
      "\n⚠️  No he trobat cap classe 'OPEN BOX' amb places lliures demà per fer la prova de reserva. Prova un altre dia."
    );
    return;
  }

  console.log(
    `\n3) Provant RESERVA real de: ${candidate.className} ${candidate.time} (id ${candidate.id})...`
  );

  const bookResponse = await fetch(`https://${boxSubdomain}/api/book`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
    },
    body: new URLSearchParams({
      id: String(candidate.id),
      day,
      insist: "0",
      familyId: "",
    }),
  });

  console.log(`   Status HTTP: ${bookResponse.status}`);
  let bookResult;
  try {
    bookResult = await bookResponse.json();
  } catch {
    bookResult = await bookResponse.text();
  }
  console.log("   Resposta:", JSON.stringify(bookResult, null, 2));

  if (bookOnly) {
    console.log(
      `\n✅ Reserva feta. Ara entra a l'app d'AimHarder al mòbil i comprova que et surt "${candidate.className} ${candidate.time}" com a reservada.`
    );
    console.log(
      "   Quan ho hagis comprovat, cancel·la-la TU MATEIX des de l'app (és demà, així que hi ha marge de sobres respecte les 3h de marge de cancel·lació)."
    );
    return;
  }

  if (typeof bookResult !== "object" || bookResult?.bookState !== 1) {
    console.log(
      "\n⚠️  La reserva no sembla haver anat bé (bookState diferent de 1), no intento cancel·lar res."
    );
    return;
  }

  // IMPORTANT: cancel·lem amb l'id de RESERVA que retorna /api/book
  // (bookResult.id), NO amb l'id de la franja horària (candidate.id).
  // Vam detectar que fer-ho amb l'id de la franja diu "cancelState: 1"
  // però NO cancel·la la reserva de veritat.
  const reservationId = bookResult.id;

  console.log(
    `\n4) Cancel·lant la reserva de prova immediatament (reservationId ${reservationId})...`
  );
  const cancelResponse = await fetch(`https://${boxSubdomain}/api/cancelBook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
    },
    body: new URLSearchParams({
      id: String(reservationId),
      day,
      familyId: "",
    }),
  });

  console.log(`   Status HTTP: ${cancelResponse.status}`);
  let cancelResult;
  try {
    cancelResult = await cancelResponse.json();
  } catch {
    cancelResult = await cancelResponse.text();
  }
  console.log("   Resposta:", JSON.stringify(cancelResult, null, 2));

  console.log(
    "\n5) Re-consultant les classes per confirmar de veritat que ja no hi ha reserva (no ens refiem només del cancelState)..."
  );
  const verifyResponse = await fetch(bookingsUrl, { headers: { Cookie: cookies } });
  let verifyBody;
  try {
    verifyBody = await verifyResponse.json();
  } catch {
    verifyBody = null;
  }
  const verifyBookings = Array.isArray(verifyBody?.bookings) ? verifyBody.bookings : [];
  const stillBooked = verifyBookings.find(
    (b) => b.id === candidate.id && b.bookState
  );

  if (stillBooked) {
    console.log(
      "\n❌ ENCARA SURT COM A RESERVADA a la consulta de classes. Cancel·la-la manualment des de l'app ARA MATEIX."
    );
  } else {
    console.log(
      "\n✅ Confirmat per API: la classe ja NO surt reservada. Igualment, si vols estar del tot tranquil, comprova-ho també a l'app."
    );
  }
}

main().catch((err) => {
  console.error("\n❌ Error inesperat durant la prova:", err.message);
  process.exit(1);
});
