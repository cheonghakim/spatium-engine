import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Clicks a point offset from the canvas's current center. Always re-reads the
 * canvas's bounding box rather than a cached one: the topbar wraps to a
 * second line once enough buttons are present (e.g. after a floor is added),
 * which resizes the canvas and shifts the screen<->world mapping, so a stale
 * bounding box would click the wrong world position.
 */
async function clickCanvasOffset(
  page: Page,
  canvas: Locator,
  dx: number,
  dy: number,
): Promise<void> {
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

test("autosaves edits to localStorage and restores them after a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");

  // Tool buttons render a trailing <kbd> shortcut hint (e.g. "공간 그리기 R"),
  // so match by substring and scope to the toolbar to avoid also matching the
  // unrelated "＋ 공간 그리기" shortcut button in the empty-canvas welcome card.
  const tools = page.locator(".tools");
  const canvas = page.locator("canvas.studio-canvas");
  await tools.getByRole("button", { name: "공간 그리기" }).click();
  await clickCanvasOffset(page, canvas, -80, -80);
  await clickCanvasOffset(page, canvas, 80, -80);
  await clickCanvasOffset(page, canvas, 80, 80);
  await clickCanvasOffset(page, canvas, -80, 80);
  await page.keyboard.press("Enter");

  // Autosave is debounced — poll rather than assuming a fixed delay.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("spatium-studio:autosave")))
    .not.toBeNull();

  async function exportedSpaceCount(): Promise<number> {
    await page.locator(".export-menu summary").click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "프로젝트 JSON", exact: true }).click();
    const stream = await (await pending).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const parsed = JSON.parse(Buffer.concat(chunks).toString());
    return parsed.buildings[0].floors[0].spaces.length;
  }

  expect(await exportedSpaceCount()).toBe(1);

  await page.reload();
  await expect(page.getByText("이전 작업이 복원되었습니다")).toBeVisible();
  expect(await exportedSpaceCount()).toBe(1);

  expect(errors).toEqual([]);
});

test("links stairs nodes across floors from the property panel and routes between them", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // dialog.accept() with no argument submits an *empty* prompt value (not the
  // dialog's own default text), which would make FloorSwitcher's addFloor()
  // bail out via its `if (!name) return;` guard — so accept with the default
  // value explicitly to keep the "새 층 이름" prompt's suggested name.
  page.on("dialog", (dialog) => dialog.accept(dialog.defaultValue()));
  await page.goto("/");

  const canvas = page.locator("canvas.studio-canvas");
  const tools = page.locator(".tools");

  // Place one navigation node on the initial floor (1F).
  await tools.getByRole("button", { name: "경로 그리기" }).click();
  await clickCanvasOffset(page, canvas, -150, 0);
  await tools.getByRole("button", { name: "선택" }).click();

  // Add a second floor (auto-switches the active floor to it) and place a node there too.
  await page.getByTitle("층 추가", { exact: true }).click();
  await expect(page.getByRole("button", { name: "2F", exact: true })).toBeVisible();
  await tools.getByRole("button", { name: "경로 그리기" }).click();
  await clickCanvasOffset(page, canvas, 150, 0);
  await tools.getByRole("button", { name: "선택" }).click();

  // Back on 1F, select the node and mark it as a stairs node.
  await page.getByRole("button", { name: "1F", exact: true }).click();
  await clickCanvasOffset(page, canvas, -150, 0);
  const properties = page.locator(".property-panel");
  await expect(properties.getByRole("combobox", { name: "타입", exact: true })).toBeVisible();
  await properties.getByRole("combobox", { name: "타입", exact: true }).selectOption("stairs");

  // Link it to the only other-floor node available (the one just created on 2F).
  const linkSelect = properties.getByRole("combobox", { name: "다른 층 연결", exact: true });
  await expect(linkSelect).toBeVisible();
  await linkSelect.selectOption({ index: 1 });

  // The route panel should offer both floors' nodes (one per floor, plus the
  // disabled placeholder) and find a path between them.
  await page.getByRole("button", { name: "경로", exact: true }).click();
  const route = page.locator(".route-panel");
  await expect(
    route.getByRole("combobox", { name: "출발 노드", exact: true }).getByRole("option"),
  ).toHaveCount(3);
  await route.getByRole("combobox", { name: "출발 노드", exact: true }).selectOption({ index: 1 });
  await route.getByRole("combobox", { name: "도착 노드", exact: true }).selectOption({ index: 2 });
  await route.getByRole("button", { name: "경로 찾기", exact: true }).click();

  const result = route.locator(".result");
  await expect(result).toBeVisible();
  await expect(result).not.toHaveClass(/error/);
  await expect(result).toContainText("거리");

  expect(errors).toEqual([]);
});
