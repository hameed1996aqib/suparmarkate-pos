FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/mobile-scanner/package.json apps/mobile-scanner/package.json
COPY packages packages
RUN npm ci --workspace @supermarket/api --include-workspace-root

COPY apps/api apps/api
COPY scripts/docker scripts/docker

RUN npm run prisma:generate && npm run build:api

WORKDIR /app/apps/api

EXPOSE 4000 4001 4002

ENTRYPOINT ["sh", "../../scripts/docker/api-entrypoint.sh"]
