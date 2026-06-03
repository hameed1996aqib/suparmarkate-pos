FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/*

COPY apps/api/package.json apps/api/package.json

WORKDIR /app/apps/api
RUN npm install

COPY apps/api .
COPY scripts/docker /app/scripts/docker
RUN sed -i 's/\r$//' /app/scripts/docker/api-entrypoint.sh

ENV DATABASE_URL="postgresql://supermarket:supermarket_password@postgres:5432/supermarket_db"

RUN npm run prisma -- generate && npm run build

EXPOSE 4000 4001 4002

ENTRYPOINT ["sh", "/app/scripts/docker/api-entrypoint.sh"]
