#!/bin/sh
set -eu

echo "Waiting for PostgreSQL and running Muhaseb migrations..."

attempt=1
until npm run prisma -- migrate deploy; do
  if [ "$attempt" -ge 30 ]; then
    echo "Migration failed after $attempt attempts."
    exit 1
  fi

  echo "PostgreSQL is not ready yet or migration failed. Retry $attempt/30..."
  attempt=$((attempt + 1))
  sleep 3
done

echo "Seeding Muhaseb baseline data..."
npm run seed

echo "Starting Muhaseb API..."
exec node dist/index.js
