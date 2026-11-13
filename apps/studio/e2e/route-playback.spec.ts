import { expect, test, type Locator, type Page } from "@playwright/test";

async function clickAt(page: Page, canvas: Locator, dx: number, dy: number) {
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

test("route playback can be paused, scrubbed, sped up and stopped", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const canvas = page.locator("canvas.studio-canvas");
  const tools = page.locator(".tool-groups");

  // A floor to stand on, and an L-shaped path across it.
  await tools.getByRole("button", { name: "공간 그리기" }).click();
  await clickAt(page, canvas, -220, -160);
  await clickAt(page, canvas, 220, -160);
  await clickAt(page, canvas, 220, 160);
  await clickAt(page, canvas, -220, 160);
  await page.keyboard.press("Enter");
  await tools.getByRole("button", { name: "경로 그리기" }).click();
  await clickAt(page, canvas, -180, 120);
  await clickAt(page, canvas, 0, 120);
  await clickAt(page, canvas, 0, -120);
  await clickAt(page, canvas, 180, -120);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "경로", exact: true }).click();
  const route = page.locator(".route-panel");
  const start = route.getByRole("combobox", { name: "출발지", exact: true });
  const end = route.getByRole("combobox", { name: "도착지", exact: true });
  await start.selectOption({ index: 1 });
  const endOptions = await end.locator("option").count();
  await end.selectOption({ index: endOptions - 1 });
  await route.getByRole("button", { name: "경로 찾기", exact: true }).click();
  await expect(route.locator(".result.error")).toHaveCount(0);

  await page.getByRole("button", { name: "3D 미리보기" }).click();
  const controls = page.locator(".view-controls");
  await controls.getByRole("combobox", { name: "보기" }).selectOption("overview");
  await controls.getByRole("button", { name: "▶ 경로 재생" }).click();

  const bar = page.getByRole("group", { name: "경로 재생" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "일시정지" }).click();
  await expect(bar.getByRole("button", { name: "계속 재생" })).toBeVisible();

  const scrubber = bar.getByRole("slider", { name: "재생 위치" });
  await scrubber.fill("500");
  await expect(scrubber).toHaveValue("500");
  await page.screenshot({ path: test.info().outputPath("paused-midway.png") });

  await controls.getByRole("combobox", { name: "속도" }).selectOption("4");
  await bar.getByRole("button", { name: "계속 재생" }).click();
  // At 4× a short route finishes on its own and the bar goes away.
  await expect(bar).toHaveCount(0, { timeout: 15000 });

  await controls.getByRole("combobox", { name: "보기" }).selectOption("follow");
  await controls.getByRole("button", { name: "▶ 경로 재생" }).click();
  await expect(bar).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: test.info().outputPath("follow.png") });
  await bar.getByRole("button", { name: "정지", exact: true }).click();
  await expect(bar).toHaveCount(0);

  expect(errors).toEqual([]);
});
