const { createRequire } = require("node:module");

const poolMax = Number(process.env.DATABASE_POOL_MAX || 10);
if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 50) {
  throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 50");
}

const requireFromAdapter = createRequire(require.resolve("@prisma/adapter-pg"));
const pg = requireFromAdapter("pg");
const OriginalPool = pg.Pool;

pg.Pool = class LoadTestPool extends OriginalPool {
  constructor(options = {}) {
    super({ ...options, max: poolMax });
  }
};

