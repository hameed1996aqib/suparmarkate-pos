import { defineConfig, devices } from "@playwright/test";

const port = 5173;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../test-results/playwright",
  reporter: [["list"], ["html", { outputFolder: "../../playwright-report", open: "never" }]],
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER
    ? undefined
    : {
        command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe"
      },
  projects: [
    {
      name: "web",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.platform === "win32" && !process.env.CI
          ? { channel: "msedge" as const }
          : {})
      },
      testMatch: /web\.smoke\.spec\.ts/
    },
    {
      name: "electron",
      testMatch: /electron\.smoke\.spec\.ts/
    }
  ]
});
