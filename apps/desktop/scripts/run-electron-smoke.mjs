import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const resultPath = path.join(
  os.tmpdir(),
  `muhaseb-electron-smoke-${randomUUID()}.json`
);
const userDataPath = await mkdtemp(
  path.join(os.tmpdir(), "muhaseb-electron-smoke-profile-")
);
const childEnvironment = {
  ...process.env,
  MUHASEB_E2E_USE_DIST: "true",
  MUHASEB_E2E_RESULT_FILE: resultPath,
  MUHASEB_E2E_USER_DATA_DIR: userDataPath
};
delete childEnvironment.ELECTRON_RUN_AS_NODE;

function waitForResult(timeoutMs = 30_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const raw = await readFile(resultPath, "utf8");
        resolve(JSON.parse(raw));
        return;
      } catch {
        if (child.exitCode !== null) {
          reject(
            new Error(
              `Electron exited with code ${child.exitCode} before renderer load.${stderr ? `\n${stderr}` : ""}`
            )
          );
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          reject(
            new Error(
              `Electron smoke test timed out before renderer load.${stderr ? `\n${stderr}` : ""}`
            )
          );
          return;
        }
      }

      setTimeout(poll, 100);
    };

    void poll();
  });
}

const child = spawn(
  electronPath,
  [
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-software-rasterizer",
    "."
  ],
  {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"]
  }
);
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

function waitForChildExit(timeoutMs = 5_000) {
  if (child.exitCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

try {
  const result = await waitForResult();
  const renderer = result.renderer || {};

  if (
    !result.ok ||
    !renderer.rootHasContent ||
    !renderer.hasElectronApi ||
    !renderer.hasDesktopApp
  ) {
    throw new Error(
      `Electron smoke check failed: ${JSON.stringify(result)}${stderr ? `\n${stderr}` : ""}`
    );
  }

  console.log("Electron main, preload bridge and built renderer smoke check passed.");
} finally {
  await waitForChildExit();
  if (child.exitCode === null) {
    child.kill();
    await waitForChildExit();
  }
  await rm(resultPath, { force: true });
  await rm(userDataPath, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200
  });
}
