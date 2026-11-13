import { expect, test, type Locator, type Page } from "@playwright/test";

/** Re-reads the canvas box each time: the topbar can wrap and resize the canvas. */
async function clickCanvasOffset(page: Page, canvas: Locator, dx: number, dy: number) {
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

test("builds an elevator connector from the property panel and routes through it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept(dialog.defaultValue()));
  await page.goto("/");

  const canvas = page.locator("canvas.studio-canvas");
  const tools = page.locator(".tool-groups");
  const properties = page.locator(".property-panel");

  await tools.getByRole("button", { name: "경로 그리기" }).click();
  await clickCanvasOffset(page, canvas, -150, 0);
  await tools.getByRole("button", { name: "선택" }).click();

  await page.getByTitle("층 추가", { exact: true }).click();
  await expect(page.getByRole("button", { name: "2F", exact: true })).toBeVisible();
  await tools.getByRole("button", { name: "경로 그리기" }).click();
  await clickCanvasOffset(page, canvas, 150, 0);
  await tools.getByRole("button", { name: "선택" }).click();

  await page.getByRole("button", { name: "1F", exact: true }).click();
  await clickCanvasOffset(page, canvas, -150, 0);
  await properties.getByRole("combobox", { name: "타입", exact: true }).selectOption("elevator");

  // No connector yet: create one here, then add the 2F node as a stop.
  await properties
    .getByRole("combobox", { name: "설비 종류", exact: true })
    .selectOption("elevator");
  await properties.getByRole("button", { name: "이 노드에서 설비 만들기" }).click();
  await expect(properties.getByText("정차층 (1)")).toBeVisible();
  await properties
    .getByRole("combobox", { name: "정차층 추가", exact: true })
    .selectOption({ index: 1 });
  await expect(properties.getByText("정차층 (2)")).toBeVisible();

  // Spec values feed the travel-time estimate.
  await properties.getByRole("spinbutton", { name: "평균 대기 (초)" }).fill("12");
  await properties.getByRole("spinbutton", { name: "평균 대기 (초)" }).press("Enter");

  await page.getByRole("button", { name: "경로", exact: true }).click();
  const route = page.locator(".route-panel");
  await route.getByRole("combobox", { name: "출발지", exact: true }).selectOption({ index: 1 });
  await route.getByRole("combobox", { name: "도착지", exact: true }).selectOption({ index: 2 });
  await route.getByRole("button", { name: "경로 찾기", exact: true }).click();
  const result = route.locator(".result");
  await expect(result).not.toHaveClass(/error/);
  await expect(result).toContainText("예상 소요");

  expect(errors).toEqual([]);
});

test("exports IMDF once the site has a geo anchor and address", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");

  const canvas = page.locator("canvas.studio-canvas");
  const tools = page.locator(".tool-groups");
  await tools.getByRole("button", { name: "공간 그리기" }).click();
  await clickCanvasOffset(page, canvas, -80, -80);
  await clickCanvasOffset(page, canvas, 80, -80);
  await clickCanvasOffset(page, canvas, 80, 80);
  await clickCanvasOffset(page, canvas, -80, 80);
  await page.keyboard.press("Enter");
  await tools.getByRole("button", { name: "선택" }).click();

  // Without a site the pre-export check refuses, saying why.
  await page.locator(".export-menu summary").click();
  await page.getByRole("button", { name: "IMDF (Apple 실내 지도)" }).click();
  const check = page.getByRole("dialog", { name: "IMDF 내보내기 점검" });
  await expect(check).toContainText("내보낼 수 없습니다");
  await expect(check).toContainText("위경도");
  await expect(check.getByRole("button", { name: "IMDF 내보내기" })).toBeDisabled();
  await check.getByRole("button", { name: "취소" }).click();
  await page.locator(".export-menu summary").click(); // close the menu

  // Site settings live in the property panel's empty (nothing selected) state.
  // Latitude alone isn't applied — both coordinates go in together.
  await clickCanvasOffset(page, canvas, 300, 300);
  const properties = page.locator(".property-panel");
  await properties.getByRole("button", { name: "단지 · 지리 좌표" }).click();
  await properties.getByRole("button", { name: "단지 설정 만들기" }).click();
  await properties.getByRole("spinbutton", { name: "기준 위도" }).fill("37.5665");
  await properties.getByRole("spinbutton", { name: "기준 위도" }).press("Enter");
  await expect(properties.getByText("위도와 경도를 모두 입력하면 적용됩니다.")).toBeVisible();
  await properties.getByRole("spinbutton", { name: "기준 경도" }).fill("126.978");
  await properties.getByRole("spinbutton", { name: "기준 경도" }).press("Enter");
  for (const [label, value] of [
    ["도로명 주소", "세종대로 110"],
    ["시·군·구", "서울특별시 중구"],
    ["국가 코드", "KR"],
  ] as const) {
    await properties.getByRole("textbox", { name: label }).fill(value);
    await properties.getByRole("textbox", { name: label }).press("Enter");
  }

  await page.locator(".export-menu summary").click();
  await page.getByRole("button", { name: "IMDF (Apple 실내 지도)" }).click();
  // The space has no footprint → an approximation warning, but export is allowed.
  await expect(check).toContainText("근사");
  const pending = page.waitForEvent("download");
  await check.getByRole("button", { name: "IMDF 내보내기" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.imdf\.zip$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const zip = Buffer.concat(chunks);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  expect(zip.toString("latin1")).toContain("unit.geojson");

  expect(errors).toEqual([]);
});
