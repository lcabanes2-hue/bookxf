FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# El servidor (Hetzner) no té per què tenir la mateixa zona horària que
# l'ordinador on es va desenvolupar. Els horaris de classe ("18:30") es
# calculen sempre en hora local del procés, així que fixem explícitament
# la zona horària del box (Espanya) perquè el scheduler dispari les
# reserves a l'hora real correcta, sigui quin sigui el servidor.
ENV TZ=Europe/Madrid
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
COPY package.json ./
RUN mkdir -p /app/prisma && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/server.js"]
