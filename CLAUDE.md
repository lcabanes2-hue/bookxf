# Auto-reserves CrossFit (AimHarder)

App privada per automatitzar les reserves de classes de CrossFit a AimHarder
(CrossFit Manresa) per a 2 usuaris (l'usuari i el seu pare). Les places
s'obren 24h abans de cada classe i s'omplen ràpid; l'app ha de reservar
automàticament en el moment exacte en què s'obre la reserva, segons una
planificació setmanal recurrent configurada per cada usuari.

El pla complet (arquitectura, roadmap per fases) està a
`C:\Users\mlbig\.claude\plans\misty-purring-pascal.md`. Aquest fitxer és
un resum de treball per continuar sessions futures.

## Flux de treball d'aquest projecte

- L'usuari escriu codi en local (Windows, VS Code) i el puja al repositori
  de GitHub `lcabanes2-hue/bookxf` (repo `origin` d'aquest directori).
- **Una altra persona** gestiona el servidor de producció (Hetzner, regió
  Falkenstein/Núremberg, Alemanya) via SSH des d'un altre ordinador.
  L'usuari NO desplega directament — cal donar-li instruccions clares
  quan hi hagi alguna cosa a desplegar.
- L'usuari és bastant nou en desenvolupament (no tenia Node.js ni sabia
  si el tenia instal·lat; cal guiar-lo pas a pas en operacions de terminal
  i VS Code, sense donar per fet que sap navegar carpetes, copiar fitxers,
  etc.)

## Integració amb AimHarder (validada amb dades reals, Fase 0 — FET)

No hi ha API pública oficial. Investigat a partir de projectes de la
comunitat ([fitbot-mcp](https://github.com/alliso/fitbot-mcp),
[fitbot](https://github.com/pablobuenaposada/fitbot),
[aimharder-bot](https://github.com/epereztg/aimharder-bot)) i **confirmat
en producció** amb el compte real de l'usuari (CrossFit Manresa,
`boxSubdomain=crossfitmanresa.aimharder.com`, `boxId=8445`):

- **Login**: `POST https://login.aimharder.com/api/login`, JSON
  `{ username, password, fingerprint, iniframe: 0 }`. Retorna cookies de
  sessió (via `Set-Cookie`) + dades d'usuari amb `roles[].boid` (boxId) i
  `roles[].centre_url` (subdomini del box).
- **Consulta de classes**: `GET https://{subdomini}/api/bookings?day=YYYYMMDD&box={boxId}&familyId=`
  amb la cookie de sessió. Retorna `bookings[]`, cada entrada amb `id`
  (identificador de la FRANJA, no de la reserva), `className`, `time`,
  `limit`, `ocupation`, `bookState` (null si tu no l'has reservada).
- **Reservar**: `POST https://{subdomini}/api/book`,
  `application/x-www-form-urlencoded`, body `{ id, day, insist, familyId }`
  (`id` = el de la franja). Resposta: `{ bookState, id }` on **aquest `id`
  de resposta és el de la RESERVA, diferent del de la franja**.
  `bookState`: `1`/`0` reservada, `-1` plena (usar `insist=1` per llista
  d'espera), `-2` sense tarifa, `-4` massa aviat (encara no obre), `-5`
  pagament pendent, `-7` massa tard.
- **Cancel·lar**: `POST https://{subdomini}/api/cancelBook`,
  form-urlencoded, body `{ id, day, familyId }`.
  ⚠️ **IMPORTANT / bug ja detectat i corregit**: cal fer servir l'`id` de
  RESERVA que retorna `/api/book` (`bookResult.id`), NO l'`id` de la
  franja horària. Amb l'`id` de la franja, `/api/cancelBook` respon
  `{"cancelState":1}` (sembla èxit) però **NO cancel·la la reserva de
  veritat** — ho vam detectar perquè la classe va quedar reservada de
  debò tot i la resposta "correcta". Sempre verificar l'estat real
  tornant a consultar `/api/bookings` després de cancel·lar, no confiar
  només en `cancelState`.
- **Regla de negoci del gimnàs**: cancel·lar una reserva a menys de 3h de
  la classe fa perdre el crèdit. Qualsevol prova ha de ser sempre sobre
  classes de "demà" o més tard, mai d'avui.
- Cap bloqueig geogràfic detectat fent proves des de casa (Espanya).
  Encara per confirmar des del servidor d'Hetzner (Alemanya) quan es
  desplegui, però Alemanya no consta com a regió problemàtica (els
  bloquejos reportats per altres projectes eren des dels EUA).
- Script de proves: `scripts/aimharder-spike.mjs` (arrel del repo).
  `node scripts/aimharder-spike.mjs` (només login+consulta, segur),
  `--book-only` (reserva i la canceŀles tu manualment des de l'app),
  `--test-book` (reserva i cancel·la automàticament, ja amb el fix de
  l'id de reserva correcte i una verificació final que torna a consultar
  l'estat real).

## Arquitectura i stack (decidits)

- Backend: Fastify + TypeScript, mòduls per carpeta a
  `apps/backend/src/modules/{auth,users,schedule,booking,scheduler,aimharder-client,notifications}`.
- BD: Prisma + **SQLite** (mateixa BD en local i en producció — decisió
  presa per simplicitat donat que només hi ha 2 usuaris; evita haver
  d'instal·lar/mantenir Postgres o Docker). Schema a
  `apps/backend/prisma/schema.prisma`.
- Auth de l'app (NO la d'AimHarder): sessió pròpia per cookie +
  taula `Session` (token aleatori, no l'`id` de Prisma). Sense registre
  públic — els usuaris es creen amb
  `npx tsx src/scripts/create-user.ts --name="..." --email="..." --password="..."`.
  Contrasenyes de l'app hashejades amb `scrypt` (Node core, sense
  dependències natives per evitar problemes de compilació).
- Credencials d'AimHarder: xifrades (AES-256-GCM) amb `MASTER_KEY`
  (variable d'entorn, mai a la BD ni al frontend). Codi a
  `apps/backend/src/shared/crypto.ts`.
- Notificacions: email (a implementar, Fase 5).
- Frontend: **de moment una SPA senzilla en HTML+CSS+JS pur (sense
  framework), servida directament pel backend Fastify via `@fastify/static`**
  des de `apps/backend/public/` (`index.html` + `app.js`). Es va triar
  aquesta opció en lloc de Next.js per anar més ràpid en aquesta fase
  ("l'usuari vol una interfície gràfica avui, no comandes de terminal").
  Es podria migrar a Next.js més endavant (Fase 6 original) si cal, però
  de moment funciona bé i és mobile-first / compatible amb qualsevol
  navegador (iPhone i Android inclosos, és una web normal).
- Desplegament final: Docker Compose al VPS d'Hetzner (a fer quan calgui,
  la persona que gestiona el servidor ho executarà).

## Estat actual (última sessió de treball: 2026-09-09)

**Fase 0 — Viabilitat**: ✅ Completa i validada amb dades reals.

**Fase 1 — Base (backend + auth + BD)**: ✅ Completa.
- Backend Fastify a `apps/backend`, BD SQLite creada i migrada.
- Mòduls `auth` complets: login, logout, `/me`, i **canvi de contrasenya
  obligatori al primer login** (`User.mustChangePassword`). No hi ha
  registre públic.
- Dos usuaris de l'app creats:
  - Lluís (lcabaneslopez@gmail.com) — ja ha canviat la contrasenya temporal.
  - Francesc, el pare (lafamiliaflam@gmail.com) — encara amb contrasenya
    temporal `Xc9J1cRl` (pendent que ell entri i la canviï).
- Scripts de desenvolupament útils a `src/scripts/`: `create-user.ts`,
  `reset-password.ts`, `delete-aimharder-credential.ts` (aquests dos
  últims són utilitats internes, no cal exposar-les mai a l'app).

**Fase 2 — Mòdul AimHarder**: ✅ Completa (avançada respecte al pla
original perquè calia per a la Fase 3).
- `src/modules/aimharder-client/client.ts`: port net a TypeScript de la
  lògica validada a la Fase 0 (login, `getClassesForDay`, `bookClass`,
  `cancelBooking`), amb el fix de l'id de reserva ja incorporat.
- `src/modules/aimharder-client/routes.ts`: `GET/POST /api/aimharder/credentials`
  (desa xifrat, i en desar fa un login real contra AimHarder per validar
  i descobrir `boxSubdomain`/`boxId` automàticament — l'usuari no els ha
  de saber), `GET /api/aimharder/classes?weekday=N` (retorna les classes
  reals del proper dia amb aquest weekday).
- La UI de calendari (tira de dies + pantalla de detall) mostra ara
  també l'ocupació real de cada classe (`3/14`, en vermell si està
  plena), com a l'app oficial d'AimHarder.

**Fase 3 — Planificació**: ✅ Completa (versió millorada respecte al pla
original: en lloc de triar només una hora genèrica, l'usuari tria d'un
desplegable amb les classes REALS d'AimHarder d'aquell dia de la setmana,
per nom i hora — important perquè hi ha diverses classes que poden
coincidir en hora, ex. WOD i OPEN BOX totes dues a les 19:30).
- `src/modules/schedule/routes.ts`: `GET /api/schedule/week`,
  `PUT /api/schedule/week/:weekday` (body `{ time, className }`, si
  `time` és `null` s'esborra el dia).

**Interfície gràfica**: ✅ Primera versió completa i amb disseny cuidat
(`apps/backend/public/index.html` + `app.js`): login → canvi de
contrasenya (primer cop) → connectar compte d'AimHarder → graella
setmanal amb desplegables de classes reals. Colors/tipografia amb mode
fosc automàtic (`prefers-color-scheme`).

**Fase 4 — Scheduler (el cor de l'app)**: ✅ Completa i validada amb una
reserva real (booking + cancel·lació confirmats, veure més avall).
- `src/shared/dates.ts`: utilitats de dates compartides (`nextOccurrence`,
  `calendarDateForWeekday`, `combineDateAndTime`, `toISODate`,
  `toAimharderDay`).
- `src/modules/scheduler/engine.ts`: per cada `ScheduleSlot` actiu calcula
  `openAt = data_classe - 24h`, crea/actualitza el `BookingAttempt`
  corresponent, i arma un `setTimeout` de precisió (no cron) que a
  `openAt` crida `bookClass()` amb una ràfega de reintents (20s, cada
  300ms). Si la classe surt plena (`bookState=-1`) canvia automàticament
  a `insist=1` per entrar a la llista d'espera (decisió ja presa: sí,
  per defecte). Envia un recordatori 3h abans d'obrir (`REMINDER_LEAD_MS`)
  i un resultat final, tots dos via `notifications/sender.ts` (de moment
  només log + `NotificationLog`, real per email és la Fase 5). Es
  re-sincronitza tot sol cada 30 min i a l'arrencada (`startScheduler()`,
  cridat des de `server.ts`), per si el servidor s'ha reiniciat.
- `ScheduleSlot` ara té `@@unique([userId, weekday])` i
  `schedule/routes.ts` fa `upsert` (abans esborrava i recreava, cosa que
  trencava la relació amb `BookingAttempt`). Desactivar un dia ara posa
  `active=false` en lloc d'esborrar la fila.
- **Provat de punta a punta** amb `src/scripts/test-booking-engine.ts`
  (crea un `BookingAttempt` fals amb `openAt` al passat immediat i crida
  `runBookingProcess()` directament, sense esperar 24h): reserva real
  confirmada a AimHarder, i cancel·lada després amb
  `src/scripts/test-cancel.ts` (verificant l'estat real, no només la
  resposta de l'API). Aquests dos scripts són eines de desenvolupament
  útils per tornar a provar el motor sense esperar un dia sencer.

⚠️ **Bug greu ja detectat i corregit (2026-09-09, prova real amb l'usuari)**:
en marcar un dia real a la graella que casualment obria la reserva
d'immediat (24h abans = ara mateix), el motor va entrar en **bucle
infinit re-disparant `runBookingProcess()` cada ~20s** per a la mateixa
classe, ja reservada. Causa: `materializeAttemptForSlot` calculava sempre
"la propera ocurrència d'aquest weekday", i com que la classe d'aquesta
setmana encara no havia passat (era demà), en encadenar la setmana
següent al final de `runBookingProcess` tornava a trobar la MATEIXA data
ja resolta i en creava un intent nou immediatament vençut → es tornava a
disparar tot seguit, i així indefinidament fins que es va matar el
procés manualment. Va arribar a fer 4 intents seguits (1 RESERVADA real +
3 ERROR de reintentar reservar una classe que ja tenia reservada).
**Fix**: `materializeAttemptForSlot` ara avança de 7 en 7 dies mentre la
data candidata ja tingui un `BookingAttempt` amb estat RESOLT (no
`PROGRAMADA`) per aquell `scheduleSlotId` — així sempre salta a la
setmana realment següent en lloc de repetir la mateixa. Verificat que
ara, en re-sincronitzar, crea correctament l'intent per la setmana
vinent (`PROGRAMADA`, `openAt` uns dies al futur) i no dispara res.
**Lliçó important**: durant aquesta mateixa incidència també hi havia
processos `node` vells (`npm run dev` d'una sessió anterior) que no
s'havien tancat bé — abans de qualsevol prova real del scheduler, cal
comprovar `Get-Process node` i matar qualsevol procés sobrant
(`Stop-Process -Id <id> -Force`) perquè només n'hi hagi un.

⚠️ **Segon bug greu, relacionat, detectat el mateix dia (reserva REAL de
l'usuari, WOD dijous 18:30)**: el primer fix de `materializeAttemptForSlot`
("avança de 7 en 7 dies mentre la data candidata ja tingui un intent
RESOLT per aquest slot") era fràgil: com que `ScheduleSlot` reutilitza el
mateix `id` per a un (userId, weekday) encara que l'usuari canviï de
classe (upsert), l'historial de proves d'aquell mateix dia de la setmana
(fetes hores abans amb una altra classe) feia "avançar" per error la data
real moltes setmanes — l'usuari va marcar "demà, WOD 18:30" volent-hi
anar de veritat i el sistema li va programar per **d'aquí dues setmanes**.
**Fix definitiu**: `materializeAttemptForSlot` ja NO escaneja l'historial
per decidir si avançar de setmana. Ara rep un paràmetre opcional
`skipDate` que NOMÉS es passa explícitament des de la cadena "acabo de
resoldre aquest intent, programa el següent" (a `runBookingProcess`, amb
la data exacta que s'acaba de resoldre). Quan l'usuari edita el pla
(`onScheduleSlotChanged`), es crida SEMPRE sense `skipDate`, així que
sempre calcula la pròxima ocurrència real a partir d'ara, ignorant
qualsevol historial antic. Verificat amb una reserva real de l'usuari:
WOD de demà (10/09) reservada correctament (🟢 RESERVADA) i la setmana
següent (17/09) encadenada bé com a `PROGRAMADA`.

**✅ Provat amb una reserva 100% real de l'usuari** (no simulada): WOD de
dijous 18:30 reservat correctament pel motor, i la setmana següent
encadenada bé. El sistema es considera fiable per a ús real ara mateix
(amb notificacions encara sense email real, veure Fase 5 més avall).

## Regles de notificacions (decisions preses, sessió 2026-09-09 vespre)

AimHarder ja envia els seus propis emails de reserva confirmada,
cancel·lada, i "has entrat des de la llista d'espera" (quan algú
cancel·la i tu ets el següent) — **no s'han de duplicar**. Per tant:

- `RESERVADA` → **cap email nostre** (ja el rep d'AimHarder).
- `LLISTA_ESPERA` (la classe estava plena en el moment d'obrir) → **sí,
  email nostre** (és l'únic moment que ho sabem nosaltres i AimHarder no
  ho explica igual).
- `ERROR` (per exemple sense tarifa, o no s'ha pogut confirmar) → **sí,
  email nostre** (AimHarder no en sap res perquè la reserva mai s'ha
  arribat a fer).
- **Recordatori previ, 6h abans que obri la reserva** (`REMINDER_LEAD_MS`,
  canviat de 3h a 6h): informatiu, NO bloqueja res — si no fas res, es
  reserva igual. Es mostra de dues maneres:
  - Banner a l'app (`GET /api/booking/upcoming`, mostrat si `openAt` és
    avui) quan l'usuari obre el dashboard.
  - Email de seguretat per si aquell dia no arribes a obrir l'app
    (mateix mecanisme de `sendNotification`, encara sense SMTP real).
- Ja implementat a `engine.ts`/`booking/routes.ts`: falta només connectar
  `notifications/sender.ts` a un SMTP real (següent pas, veure baix).

## Altres millores fetes aquesta sessió (vespre)

- **Codi de colors per tipus de classe** a la pantalla de detall del dia:
  OPEN BOX neutre, OPEN BOX EXT. gris, WOD vermell fluix, resta de
  classes especials (BOOTY BUILDING, CORE & MOBILITY, METCON, etc.) verd
  fluix. Variables CSS `--class-ext-*`, `--class-wod-*`,
  `--class-special-*` (llum i fosc).
- Títol de la targeta canviat a **"El teu pla setmanal"**.
- **Missatge de confirmació visual** en planificar/desplanificar un dia
  (`#plan-confirm-banner`): deixa clar que la tria es queda per sempre
  fins que es canviï — evita la confusió que vam tenir amb el METCON.
- **Bug de logout arreglat**: el frontend enviava sempre
  `Content-Type: application/json` encara que la petició no tingués cos
  (p.ex. `POST /api/auth/logout`), i Fastify ho rebutjava amb 400. Ara
  `app.js` només posa aquesta capçalera quan `options.body` existeix.
  Verificat al servidor amb login+logout real per cookie.
- **Accés des del mòbil**: el servidor ja escolta a `0.0.0.0`, així que
  des d'un mòbil a la mateixa WiFi es pot entrar a
  `http://192.168.18.9:3000` (IP de la Wi-Fi de l'ordinador de l'usuari,
  pot canviar si canvia de xarxa — comprovar amb `ipconfig`, adaptador
  "LAN inalámbrica Wi-Fi"). Si no hi arriba, cal una regla de Tallafocs
  de Windows (jo no tinc permisos d'administrador per crear-la):
  ```
  netsh advfirewall firewall add rule name="Bookxf dev server" dir=in action=allow protocol=TCP localport=3000 profile=private
  ```
  (executar en PowerShell com a Administrador). Pendent confirmar si
  l'usuari ho ha necessitat.

**Pendent — pròxims passos reals**:
1. **Fase 5 — Email real (EN CURS)**: l'usuari ha decidit crear un Gmail
   nou EXCLUSIU per a l'app (encara no m'ha donat l'adreça ni la
   contrasenya d'aplicació — estava creant el compte i pendent d'activar
   la verificació en 2 passos + generar la contrasenya d'aplicació de 16
   lletres a https://myaccount.google.com/apppasswords). Un cop tingui
   aquestes dues dades, falta:
   - Instal·lar `nodemailer`.
   - Connectar `notifications/sender.ts` a Gmail SMTP real (host
     `smtp.gmail.com`, port 465 SSL o 587 STARTTLS, usuari = email nou,
     contrasenya = la d'aplicació de 16 lletres — guardar-la a `.env`
     com `SMTP_USER` / `SMTP_APP_PASSWORD`, mai al codi ni al xat en
     públic).
   - Enviar-se un email de prova real abans de donar-ho per fet.
2. **Vista d'historial/estat a la interfície** (🟢🟡🔴) — el backend ja té
   `GET /api/booking/history` (fet aquesta sessió), però encara no hi ha
   cap pantalla al frontend que el mostri.

## Decisions de producte confirmades (sessió 2026-09-09, tarda)

- **La planificació és "es manté fins que la canviïs"** (no cal tornar-la
  a marcar cada setmana des de zero) — el `ScheduleSlot` per weekday que
  ja tenim és exactament el model correcte, no cal canviar-lo.
- **Avís previ abans de reservar**: el sistema ha d'enviar una notificació
  unes hores abans que s'obri la reserva (recordatori de què reservarà),
  però **NOMÉS avisa — no cal confirmar-ho activament**. Si l'usuari no
  fa res, es reserva igualment. (Per defecte: 3h abans que obri la
  reserva, és a dir ~27h abans de la classe. Ajustable més endavant.)
- La interfície és la del calendari setmanal (tires de dies amb número +
  pantalla de detall en clicar), no un desplegable — decisió ja presa i
  implementada.

## Intent de migració a un ordinador nou (2026-09-10, pausat)

L'usuari s'ha comprat un ordinador nou i vam intentar moure-hi el
desenvolupament. Resum per si es reprèn:

- **Codi**: mai s'havia fet cap commit fins ara — fet i pujat a GitHub
  aquesta sessió (`git push` via GitHub Desktop, ja que l'eina Bash té
  bloquejat `git push` per el classificador d'auto mode d'aquesta sessió).
- Ordinador nou: Node.js **v26.8.2**, repo clonat amb GitHub Desktop.
- Calia copiar a mà (mai per git) 3 fitxers: `.env.local` (arrel),
  `apps/backend/.env`, `apps/backend/prisma/dev.db` — via pendrive.
- Vam anar trobant i resolent diversos problemes (PowerShell execution
  policy, `.env` mal ubicat, processos `node` vells ocupant el port 3000,
  calia `npx prisma generate` manual)... però **ens hem quedat encallats**
  amb un error persistent i no resolt:
  ```
  Error querying the database: Error code 14: Unable to open the database file
  ```
  El fitxer `dev.db` existeix a la ruta correcta amb la mida exacta
  (90112 bytes, coincident amb l'original), no és de només lectura, no
  està bloquejat (`Unblock-File` no hi ha fet res). Vam provar:
  - Moure tot el projecte fora de `Documents` (per si interferia el
    backup automàtic a OneDrive del Windows nou) — no ha canviat res.
  - Canviar `DATABASE_URL` a una ruta absoluta en lloc de relativa — no
    ha canviat res.
  - Descartat: carpeta `prisma/prisma` doblegada (era un despiste de
    còpia en aquest ordinador, no relacionat amb el problema del nou).
  **Causa encara no identificada.** Possibles pistes per la propera
  vegada: antivirus/Windows Defender bloquejant l'accés al fitxer en
  temps real, permisos NTFS de la carpeta (no del fitxer), o alguna
  diferència de com Prisma 6.19.3 + Node 26 resol l'accés SQLite en
  aquesta màquina en concret. Podria valer la pena provar
  `prisma migrate dev` (per regenerar `dev.db` de zero en lloc de copiar
  el fitxer) i després recrear els usuaris/dades manualment, si copiar
  el fitxer tal qual segueix fallant.
- **Decisió**: de moment es continua desenvolupant en aquest ordinador
  (el de sempre). Es reprendrà la migració un altre dia.

## Detall d'entorn (per no repetir descobriments)

- L'ordinador de l'usuari és Windows. **Node.js instal·lat amb winget**
  aquesta sessió (`winget install --id OpenJS.NodeJS.LTS`).
- ⚠️ El tool de Bash d'aquesta sessió NO troba `node`/`npm` al PATH per
  defecte (el PATH es va capturar abans d'instal·lar Node). Cal prefixar
  les ordres amb:
  ```
  export PATH="/c/Program Files/nodejs:$PATH" && <ordre>
  ```
- El tool de PowerShell va fallar amb `EPERM: operation not permitted,
  uv_spawn` durant una bona part de la sessió — Bash sí que funcionava.
  Val la pena tornar-ho a provar a la propera sessió per si ja no falla.
- L'usuari treballa des de VS Code i li costa una mica moure's pel
  terminal/explorador de fitxers — donar sempre passos molt concrets
  (clic dret aquí, nom exacte del fitxer, etc.) en lloc de donar per fet
  que sap fer-ho.
