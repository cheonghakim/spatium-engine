import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

const LEGACY_FIXTURE = fileURLToPath(
  new URL(
    "../../../packages/core/src/serialization/__fixtures__/project-1.0.0.json",
    import.meta.url,
  ),
);

async function clickAt(page: Page, canvas: Locator, dx: number, dy: number) {
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

test("work replaced by opening a file can still be recovered after a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const canvas = page.locator("canvas.studio-canvas");
  const tools = page.locator(".tool-groups");
  await tools.getByRole("button", { name: "공간 그리기" }).click();
  await clickAt(page, canvas, -80, -80);
  await clickAt(page, canvas, 80, -80);
  await clickAt(page, canvas, 80, 80);
  await page.keyboard.press("Enter");

  await page.locator("input[type=file][accept*=json]").setInputFiles(LEGACY_FIXTURE);
  await expect(page.locator(".project-name")).not.toHaveText("spatium-engine");
  const opened = await page.locator(".project-name").textContent();
  // Let the opened project autosave, then reload: the autosave now holds B.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("spatium-studio:previous") !== null))
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        (name) =>
          (localStorage.getItem("spatium-studio:autosave") ?? "").includes(`"name": "${name}"`),
        opened!,
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.locator(".project-name")).toHaveText(opened!);

  await expect(page.getByText("교체되기 전 작업이 남아 있습니다")).toBeVisible();
  await page.getByRole("button", { name: "이전 작업 되돌리기" }).click();
  await expect(page.locator(".project-name")).toHaveText("spatium-engine");
  // Restoring keeps the work being left, so it can be swapped back.
  await page.getByRole("button", { name: "방금 작업으로 돌아가기" }).click();
  await expect(page.locator(".project-name")).toHaveText(opened!);

  expect(errors).toEqual([]);
});

test("a corrupt previous-work snapshot is ignored at startup", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("spatium-studio:previous", "{not json");
      sessionStorage.setItem("seeded", "1");
    }
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("canvas.studio-canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "이전 작업 되돌리기" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("spatium-studio:previous"))).toBeNull();
  expect(errors).toEqual([]);
});

test("opening a file can be undone with '이전 작업 되돌리기'", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const canvas = page.locator("canvas.studio-canvas");
  const tools = page.locator(".tool-groups");

  await tools.getByRole("button", { name: "공간 그리기" }).click();
  await clickAt(page, canvas, -80, -80);
  await clickAt(page, canvas, 80, -80);
  await clickAt(page, canvas, 80, 80);
  await page.keyboard.press("Enter");
  await expect(page.locator(".project-name")).toHaveText("spatium-engine");

  await page.locator("input[type=file][accept*=json]").setInputFiles(LEGACY_FIXTURE);
  await expect(page.getByText("project-1.0.0.json 파일을 열었습니다")).toBeVisible();
  await expect(page.locator(".project-name")).not.toHaveText("spatium-engine");

  await page.getByRole("button", { name: "이전 작업 되돌리기" }).click();
  await expect(page.locator(".project-name")).toHaveText("spatium-engine");
  await expect(page.locator(".summary-card").first()).toContainText("1");

  expect(errors).toEqual([]);
});

test("route panel explains a missing route and swaps endpoints", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const canvas = page.locator("canvas.studio-canvas");
  const tools = page.locator(".tool-groups");

  // Two path points that aren't connected (Esc ends the chain).
  await tools.getByRole("button", { name: "경로 그리기" }).click();
  await clickAt(page, canvas, -150, 0);
  await page.keyboard.press("Escape");
  await clickAt(page, canvas, 150, 0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "경로", exact: true }).click();
  const route = page.locator(".route-panel");
  const start = route.getByRole("combobox", { name: "출발지", exact: true });
  const end = route.getByRole("combobox", { name: "도착지", exact: true });
  await start.selectOption({ index: 1 });
  await end.selectOption({ index: 2 });
  const [startValue, endValue] = [await start.inputValue(), await end.inputValue()];

  await route.getByRole("button", { name: "경로 찾기", exact: true }).click();
  await expect(route.locator(".result.error")).toContainText("이어져 있지 않습니다");

  await route.getByRole("button", { name: /바꾸기/ }).click();
  await expect(start).toHaveValue(endValue);
  await expect(end).toHaveValue(startValue);

  expect(errors).toEqual([]);
});
