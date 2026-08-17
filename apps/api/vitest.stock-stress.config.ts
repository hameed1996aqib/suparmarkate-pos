import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.stock-stress.test.ts"],
    globals: false,
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    fileParallelism: false,
    testTimeout: 20 * 60_000,
    hookTimeout: 2 * 60_000
  }
});
