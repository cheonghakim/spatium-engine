import { expect, test, type Locator, type Page } from "@playwright/test";

async function clickAt(page: Page, canvas: Locator, dx: number, dy: number) {
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

/** Clicks "새 프로젝트" and reports whether a confirm dialog appeared (dismissing it). */
async function newProjectAsks(page: Page): Promise<boolean> {
  let asked = false;
  const onDialog = (dialog: { type(): string; dismiss(): Promise<void> }) => {
    if (dialog.type() === "confirm") asked = true;
    void dialog.dismiss();
  };
  page.on("dialog", onDialog);
  await page.getByRole("button", { name: "새 프로젝트" }).click();
  await page.waitForTimeout(200);
  page.off("dialog", onDialog);
  return asked;
}

test.describe("새 프로젝트 asks before discarding work", () => {
  test("a fresh project starts without asking", async ({ page }) => {
    await page.goto("/");
    expect(await newProjectAsks(page)).toBe(false);
  });

  test("work done only in the site view", async ({ page }) => {
    await page.goto("/");
    const canvas = page.locator("canvas.studio-canvas");
    await page.getByRole("button", { name: "단지", exact: true }).click();
    await page.locator(".tool-groups").getByRole("button", { name: "경로 그리기" }).click();
    await clickAt(page, canvas, -100, 100);
    await clickAt(page, canvas, 100, 100);

    expect(await newProjectAsks(page)).toBe(true);
    // Dismissed: the outdoor path is still there.
    await expect(page.getByRole("button", { name: "단지", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("only a floor plan image uploaded", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "도면", exact: true }).click();
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 80;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 120, 80);
      return c.toDataURL("image/png");
    });
    await page.locator(".reference-panel input[type=file]").setInputFiles({
      name: "plan.png",
      mimeType: "image/png",
      buffer: Buffer.from(dataUrl.split(",")[1]!, "base64"),
    });
    expect(await newProjectAsks(page)).toBe(true);
  });

  test("only a floor added", async ({ page }) => {
    page.on("dialog", (dialog) => {
      if (dialog.type() === "prompt") void dialog.accept(dialog.defaultValue());
    });
    await page.goto("/");
    await page.getByTitle("층 추가", { exact: true }).click();
    await expect(page.getByRole("button", { name: "2F", exact: true })).toBeVisible();
    expect(await newProjectAsks(page)).toBe(true);
  });
});
