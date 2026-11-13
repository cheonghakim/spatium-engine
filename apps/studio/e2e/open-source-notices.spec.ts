import { expect, test } from "@playwright/test";

test("status bar opens the open-source license notices", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");

  const statusbar = page.locator("footer.statusbar");
  await statusbar.getByRole("button", { name: "오픈소스 라이선스" }).click();

  const dialog = page.getByRole("dialog", { name: "오픈소스 라이선스" });
  await expect(dialog).toBeVisible();
  // Every component bundled into Studio must be listed, with its license text.
  const rows = dialog.locator(".component-table tbody tr");
  await expect(rows).toHaveCount(4);
  for (const name of ["earcut", "three.js", "Vue", "@mdi/js"]) {
    await expect(rows.filter({ hasText: name })).toHaveCount(1);
  }
  const earcutLicense = dialog.locator("details", {
    has: page.locator("summary", { hasText: "earcut" }),
  });
  await expect(earcutLicense.getByText("ISC License")).toBeHidden();
  await earcutLicense.locator("summary").click();
  await expect(earcutLicense.getByText("ISC License")).toBeVisible();
  await expect(dialog.locator("summary", { hasText: "Apache License 2.0" })).toBeVisible();
  // The MDI license contains "# ..." lines of its own; it must not be cut short there.
  await expect(
    dialog.locator("details", { has: page.locator("summary", { hasText: "@mdi/js" }) }),
  ).toContainText("The MIT license applies to all non-font and non-icon files.");

  // Tool shortcuts must not reach the canvas behind the modal.
  const selectTool = page.locator(".tool-groups").getByRole("button", { name: "선택" });
  await expect(selectTool).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("w");
  await expect(selectTool).toHaveAttribute("aria-pressed", "true");
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await statusbar.getByRole("button", { name: "오픈소스 라이선스" }).click();
  await dialog.getByRole("button", { name: "닫기" }).click();
  await expect(dialog).toBeHidden();

  expect(errors).toEqual([]);
});
