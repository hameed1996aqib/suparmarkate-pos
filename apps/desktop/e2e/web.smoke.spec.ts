import { expect, test } from "@playwright/test";

test("web shell renders without a fatal runtime error", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("/");

  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator("body")).not.toContainText("Internal server error");
  expect(runtimeErrors).toEqual([]);
});
