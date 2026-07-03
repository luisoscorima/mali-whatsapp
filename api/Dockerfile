FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY web/package.json ./web/
RUN npm ci

COPY api ./api
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm run prisma:generate -w api
RUN npm run build -w api

FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json ./api/
RUN npm ci --omit=dev -w api

COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/api/prisma ./api/prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

WORKDIR /app/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
