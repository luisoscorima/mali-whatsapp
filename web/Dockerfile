FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY web/package.json ./web/
COPY api/package.json ./api/
RUN npm ci

COPY web ./web
RUN npm run build -w web

FROM nginx:alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
