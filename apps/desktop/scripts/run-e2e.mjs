import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "vite";

const project = process.argv[2];
if (!["web", "electron"].includes(project)) {
  throw new Error("Expected the Playwright project name: web or electron.");
}

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");
const port = 5173;
const server =
  project === "web"
    ? await createServer({
        server: {
          host: "127.0.0.1",
          port,
          strictPort: true
        }
      })
    : null;

function runPlaywright() {
  return new Promise((resolve, reject) => {
    const childEnvironment = {
      ...process.env,
      PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${port}`,
      PLAYWRIGHT_EXTERNAL_SERVER: "true"
    };
    delete childEnvironment.ELECTRON_RUN_AS_NODE;

    const child = spawn(
      process.execPath,
      [
        playwrightCli,
        "test",
        "--config",
        "playwright.config.ts",
        `--project=${project}`
      ],
      {
        cwd: process.cwd(),
        env: childEnvironment,
        stdio: "inherit"
      }
    );

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Playwright stopped with signal ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

try {
  await server?.listen();
  const exitCode = await runPlaywright();
  process.exitCode = exitCode;
} finally {
  await server?.close();
}
