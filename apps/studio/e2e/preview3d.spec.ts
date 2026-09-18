import { expect, test, type Page } from "@playwright/test";

async function renderedPixels(page: Page): Promise<number> {
  return page.locator(".preview-3d canvas:visible").evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        requestAnimationFrame(() => {
          const canvas = element as HTMLCanvasElement;
          const gl = canvas.getContext("webgl2");
          if (!gl) {
            resolve(0);
            return;
          }
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
          for (let i = 0; i < pixels.length; i += 4) {
            if (
              Math.abs(pixels[i]! - pixels[0]!) +
                Math.abs(pixels[i + 1]! - pixels[1]!) +
                Math.abs(pixels[i + 2]! - pixels[2]!) >
              30
            )
              count++;
          }
          resolve(count);
        });
      }),
  );
}

for (const large of [false, true]) {
  test(`3D renders unconfirmed vectorization and confirmed walls (${large ? "large off-center plan" : "normal plan"})`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.getByRole("button", { name: "도면 불러오기", exact: true }).click();
    const dataUrl = await page.evaluate((large) => {
      const canvas = document.createElement("canvas");
      canvas.width = large ? 2400 : 240;
      canvas.height = large ? 1600 : 180;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 4;
      if (large) ctx.strokeRect(1900, 1000, 300, 300);
      else ctx.strokeRect(20, 20, 200, 140);
      return canvas.toDataURL("image/png");
    }, large);
    await page
      .locator(".reference-panel input[type=file]")
      .setInputFiles({
        name: "plan.png",
        mimeType: "image/png",
        buffer: Buffer.from(dataUrl.split(",")[1]!, "base64"),
      });
    await page.getByRole("button", { name: "자동 벡터화", exact: true }).click();
    const review = page.locator(".vectorize-panel");
    await expect(review.getByRole("heading", { name: "벽 (4/4)", exact: true })).toBeVisible();
    // Wall-only drafts must render too, even if no room was detected/accepted.
    await review.getByRole("checkbox", { name: "방 1 포함", exact: true }).uncheck();
    await page.getByRole("button", { name: "3D 미리보기", exact: true }).click();
    await expect(page.locator(".hint-banner")).toContainText("검토용 초안 포함");
    await expect(page.locator(".hint-banner")).toContainText("벽 4개 · 공간 0개");
    await expect.poll(() => renderedPixels(page)).toBeGreaterThan(1000);
    await page.screenshot({ path: testInfo.outputPath("draft-3d.png") });
    // Updating review selections while 3D is open must redraw without confirmation.
    await review.getByRole("checkbox", { name: "벽 1 포함", exact: true }).uncheck();
    await expect(page.locator(".hint-banner")).toContainText("벽 3개");
    await review.getByRole("checkbox", { name: "벽 1 포함", exact: true }).check();
    await page.getByRole("button", { name: "전체 보기", exact: true }).click();
    await review.getByRole("button", { name: "확정 (4개 추가)", exact: true }).click();
    await expect(page.locator(".hint-banner")).toContainText("확정된 지도");
    await expect.poll(() => renderedPixels(page)).toBeGreaterThan(1000);
    await page.getByRole("button", { name: "2D 편집으로", exact: true }).click();
    await page.getByRole("button", { name: "3D 미리보기", exact: true }).click();
    await expect.poll(() => renderedPixels(page)).toBeGreaterThan(1000);
    expect(errors).toEqual([]);
  });
}
