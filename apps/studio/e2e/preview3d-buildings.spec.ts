import { expect, test, type Locator, type Page } from "@playwright/test";

async function clickAt(page: Page, canvas: Locator, dx: number, dy: number) {
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

test("3D preview status follows the building switched to while it is open", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept(dialog.defaultValue()));
  await page.goto("/");
  const canvas = page.locator("canvas.studio-canvas");
  const tools = page.locator(".tool-groups");

  await tools.getByRole("button", { name: "공간 그리기" }).click();
  await clickAt(page, canvas, -150, -50);
  await clickAt(page, canvas, 0, -150);
  await clickAt(page, canvas, 100, 50);
  await page.keyboard.press("Enter");
  await tools.getByRole("button", { name: "선택" }).click();

  await page.getByRole("button", { name: "3D 미리보기" }).click();
  await expect(page.getByText("벽 0개 · 공간 1개 · 가구 0개")).toBeVisible();

  // Adding a building switches to its empty 1F: the status must say so.
  await page.getByTitle("빌딩 추가").click();
  await expect(page.getByText("이 층에 3D로 표시할 요소가 없습니다.")).toBeVisible();
  await expect(page.getByText("벽 0개 · 공간 1개 · 가구 0개")).toHaveCount(0);

  // And back to the first building.
  await page.locator(".building-switcher select").selectOption({ index: 0 });
  await expect(page.getByText("벽 0개 · 공간 1개 · 가구 0개")).toBeVisible();
  await expect(page.getByText("이 층에 3D로 표시할 요소가 없습니다.")).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("3D preview reports a WebGL failure instead of a normal map banner", async ({ page }) => {
  // Simulate hardware acceleration being unavailable: every WebGL context request fails.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...args);
    } as typeof original;
  });
  await page.goto("/");
  const canvas = page.locator("canvas.studio-canvas");
  const tools = page.locator(".tool-groups");
  await tools.getByRole("button", { name: "공간 그리기" }).click();
  await clickAt(page, canvas, -150, -50);
  await clickAt(page, canvas, 0, -150);
  await clickAt(page, canvas, 100, 50);
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "3D 미리보기" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "WebGL" });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await expect(page.getByText("확정된 지도")).toHaveCount(0);
  await expect(page.getByText("벽 0개 · 공간 1개 · 가구 0개")).toHaveCount(0);

  // Retrying while WebGL is still unavailable keeps reporting the failure.
  await alert.getByRole("button", { name: "다시 시도" }).click();
  await expect(alert).toBeVisible();
});
