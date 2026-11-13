import { expect, test, type Locator, type Page } from "@playwright/test";

/** Re-reads the canvas box each time: the topbar can wrap and resize the canvas. */
async function clickAt(page: Page, canvas: Locator, dx: number, dy: number) {
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

async function drawSquare(page: Page, canvas: Locator, half: number) {
  const tools = page.locator(".tool-groups");
  await tools.getByRole("button", { name: "공간 그리기" }).click();
  await clickAt(page, canvas, -half, -half);
  await clickAt(page, canvas, half, -half);
  await clickAt(page, canvas, half, half);
  await clickAt(page, canvas, -half, half);
  await page.keyboard.press("Enter");
}

async function exportedProject(page: Page) {
  await page.locator(".export-menu summary").click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "프로젝트 JSON", exact: true }).click();
  const stream = await (await pending).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString());
}

test("draws a hole into a space and removes it again", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const canvas = page.locator("canvas.studio-canvas");
  const tools = page.locator(".tool-groups");
  const properties = page.locator(".property-panel");

  await drawSquare(page, canvas, 120);
  await tools.getByRole("button", { name: "구멍 그리기" }).click();
  // Grid snap is on (1 m = 50 px at 100%): a 2 m × 2 m hole in the 4 m × 4 m room.
  await clickAt(page, canvas, -50, -50);
  await clickAt(page, canvas, 50, -50);
  await clickAt(page, canvas, 50, 50);
  await clickAt(page, canvas, -50, 50);
  await page.keyboard.press("Enter");

  const holes = properties.getByRole("button", { name: "구멍 (기둥·보이드)" });
  if ((await holes.getAttribute("aria-expanded")) !== "true") await holes.click();
  await expect(properties.getByText(/구멍 1 · /)).toBeVisible();
  expect((await exportedProject(page)).buildings[0].floors[0].spaces[0].holes).toHaveLength(1);

  // A hole outside the selected space is refused with a notice.
  await tools.getByRole("button", { name: "구멍 그리기" }).click();
  await page.keyboard.press("Escape");
  await clickAt(page, canvas, 250, 200);
  await clickAt(page, canvas, 350, 200);
  await clickAt(page, canvas, 350, 300);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "추가하지 않았습니다" })).toBeVisible();

  await tools.getByRole("button", { name: "선택" }).click();
  await clickAt(page, canvas, -80, -80);
  if ((await holes.getAttribute("aria-expanded")) !== "true") await holes.click();
  await properties.getByRole("button", { name: "구멍 1 삭제" }).click();
  await expect(properties.getByText(/구멍 1 · /)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("site view: drag a building and link an outdoor path to its entrance", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const canvas = page.locator("canvas.studio-canvas");
  const tools = page.locator(".tool-groups");
  const properties = page.locator(".property-panel");

  await drawSquare(page, canvas, 80);
  // An entrance node just south of the building.
  await tools.getByRole("button", { name: "경로 그리기" }).click();
  await clickAt(page, canvas, 0, 150);
  await tools.getByRole("button", { name: "선택" }).click();
  await clickAt(page, canvas, 0, 150);
  await properties.getByRole("combobox", { name: "타입", exact: true }).selectOption("entrance");

  await page.getByRole("button", { name: "단지", exact: true }).click();
  await expect(tools.getByRole("button", { name: "건물 배치" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tools.getByRole("button", { name: "공간 그리기" })).toBeDisabled();

  // Drag the building 100 px to the right.
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 50, cy, { steps: 4 });
  await page.mouse.move(cx + 100, cy, { steps: 4 });
  await page.mouse.up();

  // Two outdoor nodes south of the building, then link the second to the entrance.
  await tools.getByRole("button", { name: "경로 그리기" }).click();
  await clickAt(page, canvas, -150, 250);
  await clickAt(page, canvas, 100, 250);
  await tools.getByRole("button", { name: "선택" }).click();
  await clickAt(page, canvas, 100, 250);
  await properties
    .getByRole("combobox", { name: "건물 출입구 연결", exact: true })
    .selectOption({ index: 1 });
  await expect(properties.getByRole("button", { name: /연결 해제/ })).toBeVisible();

  const project = await exportedProject(page);
  expect(project.buildings[0].placement.origin.x).toBeGreaterThan(1);
  expect(project.site.navigation.nodes).toHaveLength(2);
  expect(project.site.navigation.edges).toHaveLength(2);

  // Leaving the site view switches back to an indoor tool set.
  await page.getByRole("button", { name: "1F", exact: true }).click();
  await expect(tools.getByRole("button", { name: "공간 그리기" })).toBeEnabled();

  expect(errors).toEqual([]);
});

test("converts a hand-drawn stairs link into a connector", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept(dialog.defaultValue()));
  await page.goto("/");
  const canvas = page.locator("canvas.studio-canvas");
  const tools = page.locator(".tool-groups");
  const properties = page.locator(".property-panel");

  await tools.getByRole("button", { name: "경로 그리기" }).click();
  await clickAt(page, canvas, -150, 0);
  await tools.getByRole("button", { name: "선택" }).click();
  await page.getByTitle("층 추가", { exact: true }).click();
  await tools.getByRole("button", { name: "경로 그리기" }).click();
  await clickAt(page, canvas, 150, 0);
  await tools.getByRole("button", { name: "선택" }).click();
  await page.getByRole("button", { name: "1F", exact: true }).click();
  await clickAt(page, canvas, -150, 0);
  await properties.getByRole("combobox", { name: "타입", exact: true }).selectOption("stairs");
  await properties
    .getByRole("combobox", { name: "다른 층 연결", exact: true })
    .selectOption({ index: 1 });

  await properties.getByRole("button", { name: "수직 이동 설비로 변환" }).click();
  await expect(properties.getByText("정차층 (2)")).toBeVisible();
  await expect(properties.getByRole("combobox", { name: "다른 층 연결", exact: true })).toHaveValue(
    "",
  );

  expect(errors).toEqual([]);
});
