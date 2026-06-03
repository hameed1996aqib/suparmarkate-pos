FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY apps/api/package.json apps/api/package.json

WORKDIR /app/apps/api
RUN npm install

COPY apps/api .
COPY scripts/docker /app/scripts/docker

ENV DATABASE_URL="postgresql://supermarket:supermarket_password@postgres:5432/supermarket_db"

RUN npm run prisma -- generate && npm run build

EXPOSE 4000 4001 4002

ENTRYPOINT ["sh", "/app/scripts/docker/api-entrypoint.sh"]
