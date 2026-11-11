import { expect, test } from "@playwright/test";

test.describe("small screens", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("explains the supported viewport and doesn't scroll sideways", async ({ page }) => {
    await page.goto("/");
    const notice = page.locator(".small-screen-notice");
    await expect(notice).toContainText("1024px");

    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);

    // The drawing area comes first and fits the screen width.
    const canvas = (await page.locator("canvas.studio-canvas").boundingBox())!;
    expect(canvas.x).toBeGreaterThanOrEqual(0);
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(innerWidth + 1);
    expect(canvas.y).toBeLessThan(844);

    await notice.getByRole("button", { name: "화면 크기 안내 닫기" }).click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".small-screen-notice")).toHaveCount(0);
  });
});

test("desktop viewport shows no small-screen notice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator(".small-screen-notice")).toHaveCount(0);
});
