# Desplegament al servidor

App Fastify + Prisma/SQLite, dockeritzada. Un únic contenidor, base de dades SQLite persistida com a fitxer al host.

## Requisits previs

- Docker + Docker Compose al servidor.
- Un **reverse proxy amb HTTPS** (Caddy, Nginx, Traefik...) apuntant al port `3000` del contenidor. **Imprescindible**: en producció (`NODE_ENV=production`) la cookie de sessió es marca `secure`, així que el login no funcionarà sense HTTPS.

## Passos

1. Clonar el repositori.
2. Crear `apps/backend/.env` (mai es puja a git) amb:
   ```
   DATABASE_URL="file:./dev.db"
   PORT=3000
   NODE_ENV=production
   MASTER_KEY=...
   SMTP_USER=...
   SMTP_APP_PASSWORD=...
   ```
   `MASTER_KEY`, `SMTP_USER` i `SMTP_APP_PASSWORD` els ha de passar l'usuari directament (mai per xat/email en clar) — són els mateixos valors que ja fa servir en local, per no perdre les credencials d'AimHarder ja xifrades ni els usuaris existents.
3. Copiar el fitxer `apps/backend/prisma/dev.db` actual de l'usuari (mateixa via segura) a `apps/backend/prisma/dev.db` al servidor — així es manté tota la planificació, l'historial i els usuaris ja creats, sense haver de tornar a configurar res.
4. Des de l'arrel del repositori:
   ```
   docker compose up -d --build
   ```
5. Comprovar que respon: `curl http://localhost:3000/api/health` hauria de retornar `{"ok":true}`.
6. Configurar el reverse proxy perquè apunti a `localhost:3000` amb HTTPS.

## Actualitzar una versió nova

```
git pull
docker compose up -d --build
```

El fitxer `dev.db` és un volum muntat directament (no viu dins la imatge), així que sobreviu als reinicis i actualitzacions del contenidor.

## Zona horària (important)

El scheduler calcula els horaris de classe ("18:30") en l'hora local del
**procés de Node**, no en UTC ni en l'hora del box explícitament. El
Dockerfile i el `docker-compose.yml` fixen `TZ=Europe/Madrid` perquè el
contenidor calculi sempre l'hora real d'Espanya, sigui quin sigui el
servidor. Si s'actualitza el codi (`git pull` + `docker compose up -d
--build`) cal assegurar-se que la imatge es reconstrueix de debò (no
`docker compose restart`, que no aplica canvis del Dockerfile), altrament
el contenidor pot seguir corrent en UTC i les reserves es dispararan a
l'hora equivocada (a l'estiu, 2h tard; a l'hivern, 1h tard).
