import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("electron shell starts and exposes the hardened bridge", async () => {
  const appRoot = path.resolve(__dirname, "..");
  const userDataPath = await mkdtemp(
    path.join(os.tmpdir(), "muhaseb-playwright-electron-")
  );
  const application = await electron.launch({
    args: ["."],
    cwd: appRoot,
    env: {
      ...process.env,
      MUHASEB_E2E_USE_DIST: "true",
      MUHASEB_E2E_USER_DATA_DIR: userDataPath
    }
  });

  try {
    const window = await application.firstWindow();
    await expect(window.locator("#root")).not.toBeEmpty({ timeout: 30_000 });

    const bridge = await window.evaluate(() => ({
      hasElectronApi: typeof window.electronAPI === "object",
      hasDesktopApp: typeof window.desktopApp === "object"
    }));

    expect(bridge).toEqual({
      hasElectronApi: true,
      hasDesktopApp: true
    });
  } finally {
    await application.close();
    await rm(userDataPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200
    });
  }
});
