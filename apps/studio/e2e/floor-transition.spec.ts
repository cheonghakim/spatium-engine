import { expect, test, type Page } from "@playwright/test";

async function exportProjectJson(page: Page) {
  const menu = page.locator(".export-menu");
  if ((await menu.getAttribute("open")) === null) await menu.locator("summary").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "프로젝트 JSON", exact: true }).click();
  const chunks: Buffer[] = [];
  for await (const chunk of (await (await downloadPromise).createReadStream())!)
    chunks.push(Buffer.from(chunk));
  if ((await menu.getAttribute("open")) !== null) await menu.locator("summary").click();
  return JSON.parse(Buffer.concat(chunks).toString());
}

/** 1F: S → L1 (elevator); 2F: L2 (elevator) → G. Rooms under both so there is a floor to see. */
async function loadTwoFloorPlan(page: Page) {
  await page.goto("/");
  const project = await exportProjectJson(page);
  const building = project.buildings[0];
  const lower = building.floors[0];
  const upper = {
    ...structuredClone(lower),
    id: "floor-2",
    name: "2F",
    level: lower.level + 1,
    elevation: lower.elevation + 4,
  };
  building.floors.push(upper);
  const room = (floorId: string) => ({
    id: `room-${floorId}`,
    floorId,
    polygon: [
      { x: -2, y: -2 },
      { x: 14, y: -2 },
      { x: 14, y: 10 },
      { x: -2, y: 10 },
    ],
    type: "corridor",
    properties: {},
    height: 3,
  });
  lower.spaces.push(room(lower.id));
  upper.spaces.push(room(upper.id));
  const node = (id: string, floorId: string, x: number, y: number, type = "normal") => ({
    id,
    floorId,
    position: { x, y },
    type,
    name: id,
  });
  lower.navigation.nodes.push(node("S", lower.id, 12, 0), node("L1", lower.id, 0, 0, "elevator"));
  upper.navigation.nodes.push(node("L2", upper.id, 0, 0, "elevator"), node("G", upper.id, 0, 8));
  const edge = (from: string, to: string, distance: number) => ({
    id: `${from}-${to}`,
    from,
    to,
    type: "walk",
    distance,
    accessible: true,
  });
  lower.navigation.edges.push(edge("S", "L1", 12));
  upper.navigation.edges.push(edge("L2", "G", 8));
  building.connectors = [
    {
      id: "lift",
      type: "elevator",
      stops: [
        { floorId: lower.id, nodeId: "L1" },
        { floorId: upper.id, nodeId: "L2" },
      ],
      accessible: true,
    },
  ];
  await page.locator("input[type=file][accept*=json]").setInputFiles({
    name: "two-floors.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByRole("button", { name: "경로", exact: true }).click();
  await expect(
    page.locator(".route-panel select[aria-label='출발지'] option[value='S']"),
  ).toHaveCount(1);
}

test("playback rides the elevator: a floor-change transition between 1F and 2F", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await loadTwoFloorPlan(page);
  const route = page.locator(".route-panel");
  await route.getByRole("combobox", { name: "출발지", exact: true }).selectOption({ value: "S" });
  await route.getByRole("combobox", { name: "도착지", exact: true }).selectOption({ value: "G" });
  await route.getByRole("button", { name: "경로 찾기", exact: true }).click();
  await expect(route.locator(".result")).toContainText("거리:");

  await page.getByRole("button", { name: "3D 미리보기" }).click();
  const controls = page.locator(".view-controls");
  await controls.getByRole("button", { name: "▶ 경로 재생" }).click();
  const bar = page.getByRole("group", { name: "경로 재생" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "일시정지" }).click();

  // Timeline: 12 m walk + elevator transition (4 s × 1.3 = 5.2 m) + 8 m walk = 25.2.
  const scrubber = bar.getByRole("slider", { name: "재생 위치" });
  const seekTo = (metres: number) => scrubber.fill(String(Math.round((metres / 25.2) * 1000)));

  await seekTo(12 + 5.2 * 0.3); // rising out of 1F
  const label = page.locator(".floor-transition");
  await expect(label).toHaveText("엘리베이터로 2F 이동 중 ↑");
  await expect(bar).toContainText("1F");
  await page.screenshot({ path: test.info().outputPath("leaving-1f.png") });

  await seekTo(12 + 5.2 * 0.7); // arriving on 2F
  await expect(label).toHaveText("엘리베이터로 2F 이동 중 ↑");
  await expect(bar).toContainText("2F");
  // Walked distance doesn't count the ride.
  await expect(bar).toContainText("12 / 20 m");

  await seekTo(22); // walking on 2F: the label is gone
  await expect(label).toHaveCount(0);
  await expect(bar).toContainText("2F (2/2)");

  // Played through at 4×, it finishes on its own.
  await controls.getByRole("combobox", { name: "속도" }).selectOption("4");
  await seekTo(0);
  await bar.getByRole("button", { name: "계속 재생" }).click();
  await expect(bar).toHaveCount(0, { timeout: 20000 });
  expect(errors).toEqual([]);
});
