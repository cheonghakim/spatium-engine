import { expect, test } from "@playwright/test";
import { testGLB } from "../../../packages/runtime/src/render/importedFurniture.fixture";

test("imports a GLB, renders its original material, and restores it from project JSON", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator(".tool-groups").getByRole("button", { name: "가구", exact: true }).click();
  const library = page.locator(".furniture-library");
  const texture = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 2, 2);
    return canvas.toDataURL("image/png");
  });
  await library.getByLabel("GLB 모델 추가", { exact: true }).setInputFiles({
    name: "조형물.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from(testGLB(false, texture)),
  });
  await expect(library.getByRole("button", { name: /^조형물 2/ })).toBeVisible();
  const bounds = (await page.locator("canvas.studio-canvas").boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(
    page.locator(".property-panel").getByRole("spinbutton", { name: "폭", exact: true }),
  ).toHaveValue("2");
  await page.getByRole("button", { name: "3D 미리보기", exact: true }).click();
  async function expectModelPixels() {
    await expect
      .poll(() =>
        page.locator(".preview-3d canvas:visible").evaluate(
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
                  if (pixels[i]! > pixels[i + 1]! * 1.4 && pixels[i + 2]! > pixels[i + 1]! * 1.3)
                    count++;
                resolve(count);
              });
            }),
        ),
      )
      .toBeGreaterThan(1000);
  }
  await expectModelPixels();
  await page.screenshot({ path: testInfo.outputPath("imported-model.png") });
  await page.locator(".export-menu summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "프로젝트 JSON", exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const json = Buffer.concat(chunks);
  const item = JSON.parse(json.toString()).buildings[0].floors[0].furniture[0];
  expect(item.type).toBe("custom");
  expect(item.modelData).toMatch(/^data:model\/gltf-binary;base64,/);
  await page.reload();
  await page
    .locator('input[accept=".json,application/json"]')
    .setInputFiles({ name: "model-project.json", mimeType: "application/json", buffer: json });
  await page.getByRole("button", { name: "3D 미리보기", exact: true }).click();
  await expectModelPixels();
  expect(errors).toEqual([]);
});

test("rejects invalid GLB without adding an unusable library entry", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tool-groups").getByRole("button", { name: "가구", exact: true }).click();
  const library = page.locator(".furniture-library");
  await library.getByLabel("GLB 모델 추가", { exact: true }).setInputFiles({
    name: "bad.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from("invalid"),
  });
  await expect(library.getByRole("alert")).toContainText("모델을 추가하지 못했습니다");
  await expect(library.locator(".saved-row")).toHaveCount(0);
});
