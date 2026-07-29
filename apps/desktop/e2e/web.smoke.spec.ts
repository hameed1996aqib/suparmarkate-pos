import { expect, test } from "@playwright/test";

test("web shell renders without a fatal runtime error", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("/");

  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator("body")).not.toContainText("Internal server error");
  expect(runtimeErrors).toEqual([]);
});

test("live product and inventory searches debounce and load only the active tab", async ({
  page,
}) => {
  const apiBaseUrl = process.env.PLAYWRIGHT_LIVE_API;
  test.skip(!apiBaseUrl, "Set PLAYWRIGHT_LIVE_API to run the isolated live search smoke test.");

  const runtimeErrors: string[] = [];
  const apiRequests: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith(apiBaseUrl!)) apiRequests.push(url);
  });
  await page.addInitScript((url) => {
    window.localStorage.setItem("muhaseb_api_base_url", url);
  }, apiBaseUrl!);

  await page.goto("/");
  const passwordInput = page.getByLabel("رمز عبور", { exact: true });
  expect(await passwordInput.count()).toBe(1);
  await passwordInput.fill(process.env.PLAYWRIGHT_ADMIN_PASSWORD || "admin12345");
  const loginButton = page.getByRole("button", { name: "ورود", exact: true });
  expect(await loginButton.count()).toBe(1);
  await loginButton.click();
  const dashboardLink = page.getByRole("link", {
    name: "داشبورد",
    exact: true,
  });
  await dashboardLink.waitFor({ state: "visible" });
  expect(await dashboardLink.count()).toBe(1);

  await page.goto("/#/products");
  const productSearch = page.getByPlaceholder("جستجوی کالا، بارکود، کتگوری...", {
    exact: true,
  });
  await expect(productSearch).toBeVisible();
  apiRequests.length = 0;
  await productSearch.fill("62");
  await productSearch.fill("626398");
  await productSearch.fill("6263981802863");
  await page.waitForTimeout(700);
  expect(
    apiRequests.filter((url) =>
      url.includes("/api/products?page=1&limit=20&search=6263981802863"),
    ),
  ).toHaveLength(1);

  await page.goto("/#/inventory");
  const stockSearch = page.getByPlaceholder("جستجوی جنس، بارکود یا گدام...", {
    exact: true,
  });
  await expect(stockSearch).toBeVisible();
  await page.waitForTimeout(500);
  apiRequests.length = 0;
  await stockSearch.fill("62");
  await stockSearch.fill("626398");
  await stockSearch.fill("6263981802863");
  await page.waitForTimeout(700);
  expect(
    apiRequests.filter((url) => url.includes("/api/inventory/stock?") && url.includes("6263981802863")),
  ).toHaveLength(1);
  expect(apiRequests.some((url) => url.includes("/api/inventory/movements?"))).toBe(false);

  const increaseTab = page.getByRole("tab", {
    name: "افزایش موجودی",
    exact: true,
  });
  expect(await increaseTab.count()).toBe(1);
  await increaseTab.click();
  const movementSearch = page.getByPlaceholder(
    "جستجوی جنس، گدام، lot یا کاربر...",
    { exact: true },
  );
  await expect(movementSearch).toBeVisible();
  await page.waitForTimeout(500);
  apiRequests.length = 0;
  await movementSearch.fill("62");
  await movementSearch.fill("6263981802863");
  await page.waitForTimeout(700);
  expect(
    apiRequests.filter(
      (url) =>
        url.includes("/api/inventory/movements?") &&
        url.includes("type=ADJUSTMENT_IN") &&
        url.includes("search=6263981802863"),
    ),
  ).toHaveLength(1);
  expect(apiRequests.some((url) => url.includes("/api/inventory/stock?"))).toBe(false);
  expect(runtimeErrors).toEqual([]);
});
