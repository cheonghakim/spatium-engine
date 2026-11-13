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

/**
 * Start from the app's own (empty) project and add: A(0,0) → S(5,0) → B(10,0)
 * straight over a stair room, or A → C(5,6) → B around it. Every edge is a
 * plain "walk" edge, exactly as the path tool draws them.
 */
async function loadStairPlan(page: Page) {
  await page.goto("/");
  const project = await exportProjectJson(page);
  const floor = project.buildings[0].floors[0];
  const node = (id: string, x: number, y: number) => ({
    id,
    floorId: floor.id,
    position: { x, y },
    type: "normal",
    name: id,
  });
  const edge = (from: string, to: string, distance: number) => ({
    id: `${from}-${to}`,
    from,
    to,
    type: "walk",
    distance,
    accessible: true,
  });
  floor.navigation.nodes.push(node("A", 0, 0), node("S", 5, 0), node("B", 10, 0), node("C", 5, 6));
  const side = Math.hypot(5, 6);
  floor.navigation.edges.push(
    edge("A", "S", 5),
    edge("S", "B", 5),
    edge("A", "C", side),
    edge("C", "B", side),
  );
  floor.spaces.push({
    id: "stair-room",
    floorId: floor.id,
    polygon: [
      { x: 4, y: -1 },
      { x: 6, y: -1 },
      { x: 6, y: 1 },
      { x: 4, y: 1 },
    ],
    type: "stairs",
    properties: { name: "계단실" },
    height: 3,
  });
  await page.locator("input[type=file][accept*=json]").setInputFiles({
    name: "stairs.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByRole("button", { name: "경로", exact: true }).click();
  // The loaded path points show up as route endpoints.
  await expect(
    page.locator(".route-panel select[aria-label='출발지'] option[value='A']"),
  ).toHaveCount(1);
}

test("avoid stairs / accessible only reroute around a stair room, live as the box is ticked", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await loadStairPlan(page);
  const route = page.locator(".route-panel");
  await route.getByRole("combobox", { name: "출발지", exact: true }).selectOption({ value: "A" });
  await route.getByRole("combobox", { name: "도착지", exact: true }).selectOption({ value: "B" });
  await route.getByRole("button", { name: "경로 찾기", exact: true }).click();
  const result = route.locator(".result");
  await expect(result).toContainText("거리: 10.0 m"); // straight over the stairs

  // Ticking the option re-routes immediately — no need to press "경로 찾기" again.
  await route.getByLabel("계단 회피").check();
  await expect(result).toContainText("거리: 15.6 m");
  await route.getByLabel("계단 회피").uncheck();
  await expect(result).toContainText("거리: 10.0 m");
  await route.getByLabel("접근 가능 경로만").check();
  await expect(result).toContainText("거리: 15.6 m");

  expect(errors).toEqual([]);
});

test("the route search box is styled like the other fields", async ({ page }) => {
  await loadStairPlan(page);
  const route = page.locator(".route-panel");
  const style = (selector: string) =>
    route
      .locator(selector)
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          background: s.backgroundColor,
          border: s.borderTopColor,
          radius: s.borderTopLeftRadius,
          height: s.height,
        };
      });
  expect(await style("input[type=search]")).toEqual(await style("select"));
});
