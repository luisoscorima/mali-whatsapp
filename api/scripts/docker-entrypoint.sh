#!/bin/sh
set -e
cd "$(dirname "$0")/.."
npx prisma migrate deploy
npx prisma db seed
exec node dist/main.js
