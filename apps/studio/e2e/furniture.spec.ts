import { expect, test } from "@playwright/test";

test("places furniture, changes its type, and renders it without any rooms", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator(".tool-groups").getByRole("button", { name: "가구" }).click();
  const bounds = (await page.locator("canvas.studio-canvas").boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page
    .locator(".property-panel")
    .getByRole("combobox", { name: "타입", exact: true })
    .selectOption("sofa");
  await page.getByRole("button", { name: "3D 미리보기", exact: true }).click();
  const canvas = page.locator(".preview-3d canvas:visible");
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate(
        (element) =>
          new Promise<number>((resolve) => {
            requestAnimationFrame(() => {
              const gl = (element as HTMLCanvasElement).getContext("webgl2")!;
              const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
              gl.readPixels(
                0,
                0,
                gl.drawingBufferWidth,
                gl.drawingBufferHeight,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                pixels,
              );
              let count = 0;
              for (let i = 0; i < pixels.length; i += 4)
                if (
                  Math.abs(pixels[i]! - pixels[0]!) +
                    Math.abs(pixels[i + 1]! - pixels[1]!) +
                    Math.abs(pixels[i + 2]! - pixels[2]!) >
                  30
                )
                  count++;
              resolve(count);
            });
          }),
      ),
    )
    .toBeGreaterThan(1000);
  await page.screenshot({ path: testInfo.outputPath("sofa-3d.png") });
  expect(errors).toEqual([]);
});

test("saves a customized furniture preset and reuses it in a new project after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await page.locator(".tool-groups").getByRole("button", { name: "가구", exact: true }).click();
  const library = page.locator(".furniture-library");
  await library.getByRole("button", { name: /^소파/ }).click();
  async function place(dx = 0) {
    const bounds = (await page.locator("canvas.studio-canvas").boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width / 2 + dx, bounds.y + bounds.height / 2);
  }
  await place();
  const properties = page.locator(".property-panel");
  await expect(properties.getByRole("combobox", { name: "타입", exact: true })).toHaveValue("sofa");
  const width = properties.getByRole("spinbutton", { name: "폭", exact: true });
  await width.fill("2.4");
  await width.press("Tab");
  const rotation = properties.getByRole("spinbutton", { name: "회전", exact: true });
  await rotation.fill("45");
  await rotation.press("Tab");
  await library.getByLabel("저장할 가구 이름").fill("라운지 소파");
  await library.getByRole("button", { name: "선택한 가구 저장" }).click();
  await expect(library.getByRole("button", { name: /^라운지 소파 2.4/ })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "새 프로젝트", exact: true }).click();
  await page.locator(".tool-groups").getByRole("button", { name: "가구", exact: true }).click();
  await library.getByRole("button", { name: /^라운지 소파 2.4/ }).click();
  await place();
  await expect(width).toHaveValue("2.4");
  await expect(rotation).toHaveValue("45");
  await place(160);
  await page.keyboard.press("Escape");
  await expect(
    page.locator(".tool-groups").getByRole("button", { name: "선택", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await library.getByRole("button", { name: "라운지 소파 삭제", exact: true }).click();
  await expect(library.getByRole("button", { name: /^라운지 소파 2.4/ })).toHaveCount(0);
  await expect(width).toHaveValue("2.4");
  expect(errors).toEqual([]);
});

test("reports storage failures without claiming a preset was saved", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "spatium-studio:furniture-library:v1")
        throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.goto("/");
  await page.locator(".tool-groups").getByRole("button", { name: "가구", exact: true }).click();
  const bounds = (await page.locator("canvas.studio-canvas").boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const library = page.locator(".furniture-library");
  await library.getByLabel("저장할 가구 이름").fill("저장 실패 가구");
  await library.getByRole("button", { name: "선택한 가구 저장" }).click();
  await expect(library.getByRole("alert")).toContainText("저장하지 못했습니다");
  await expect(library.locator(".saved-row")).toHaveCount(0);
});
