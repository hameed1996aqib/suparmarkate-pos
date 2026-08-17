import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const adapter = new PrismaPg({
  connectionString
});

export const prisma = new PrismaClient({
  adapter,
  transactionOptions: {
    maxWait: Math.max(5_000, Number(process.env.PRISMA_TRANSACTION_MAX_WAIT_MS || 15_000)),
    timeout: Math.max(10_000, Number(process.env.PRISMA_TRANSACTION_TIMEOUT_MS || 30_000))
  }
});
