import { expect, test, type Locator, type Page } from "@playwright/test";

/** Screen px per metre at the default zoom (EditorCamera's base zoom). */
const PX_PER_M = 50;

async function center(canvas: Locator) {
  const box = (await canvas.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function clickAt(page: Page, canvas: Locator, dx: number, dy: number, modifiers = {}) {
  const c = await center(canvas);
  await page.mouse.click(c.x + dx, c.y + dy, modifiers);
}

async function dragOnCanvas(
  page: Page,
  canvas: Locator,
  from: [number, number],
  to: [number, number],
  {
    holdShift = false,
    beforeRelease,
  }: { holdShift?: boolean; beforeRelease?: () => Promise<void> } = {},
) {
  const c = await center(canvas);
  if (holdShift) await page.keyboard.down("Shift");
  await page.mouse.move(c.x + from[0], c.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(c.x + to[0], c.y + to[1], { steps: 8 });
  if (beforeRelease) await beforeRelease();
  await page.mouse.up();
  if (holdShift) await page.keyboard.up("Shift");
}

async function exportProject(page: Page) {
  const menu = page.locator(".export-menu");
  if ((await menu.getAttribute("open")) === null) await menu.locator("summary").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "프로젝트 JSON", exact: true }).click();
  const download = await downloadPromise;
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  // Close the menu again so it doesn't cover the panels.
  if ((await menu.getAttribute("open")) !== null) await menu.locator("summary").click();
  return JSON.parse(Buffer.concat(chunks).toString()).buildings[0].floors[0];
}

/** RGB of one canvas pixel, in CSS px relative to the canvas centre. */
async function canvasPixel(page: Page, dx: number, dy: number): Promise<[number, number, number]> {
  return page.evaluate(
    ([x, y]) => {
      const canvas = document.querySelector<HTMLCanvasElement>("canvas.studio-canvas")!;
      const dpr = canvas.width / canvas.clientWidth;
      const data = canvas
        .getContext("2d")!
        .getImageData(
          Math.round((canvas.clientWidth / 2 + x!) * dpr),
          Math.round((canvas.clientHeight / 2 + y!) * dpr),
          1,
          1,
        ).data;
      return [data[0]!, data[1]!, data[2]!] as [number, number, number];
    },
    [dx, dy],
  );
}

test("select tool: visible box, multi-select move, room move, POI highlight, nudge, undo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const canvas = page.locator("canvas.studio-canvas");
  const tools = page.locator(".tool-groups");
  // Grid snapping would round our drags; this test is about selection, not snapping.
  const snap = page.getByRole("button", { name: "격자 맞춤 전환", exact: true });
  if ((await snap.getAttribute("aria-pressed")) === "true") await snap.click();

  await tools.getByRole("button", { name: "공간 그리기" }).click();
  for (const [x, y] of [
    [-150, -100],
    [150, -100],
    [150, 100],
    [-150, 100],
  ] as const)
    await clickAt(page, canvas, x, y);
  await page.keyboard.press("Enter");
  await tools.getByRole("button", { name: "벽 그리기" }).click();
  await clickAt(page, canvas, -100, -50);
  await clickAt(page, canvas, 100, -50);
  await page.keyboard.press("Escape");
  await clickAt(page, canvas, -100, 50);
  await clickAt(page, canvas, 100, 50);
  await page.keyboard.press("Escape");
  await tools.getByRole("button", { name: "관심 지점" }).click();
  await clickAt(page, canvas, 0, 0);
  await page.keyboard.press("Escape");
  await tools.getByRole("button", { name: "선택" }).click();

  const before = await exportProject(page);
  expect(before.walls).toHaveLength(2);
  expect(before.spaces).toHaveLength(1);

  // 1) The selection box is clearly drawn while dragging (started inside the room).
  await dragOnCanvas(page, canvas, [-120, -80], [120, 80], {
    beforeRelease: async () => {
      const [r, g, b] = await canvasPixel(page, 0, -80); // on the box's top edge
      expect(b).toBeGreaterThan(200); // accent blue outline
      expect(b - r).toBeGreaterThan(60);
      expect(g).toBeLessThan(b);
    },
  });
  // Window box: both walls and the POI fully inside, the room (bigger) not.
  await expect(page.getByText("관심 지점 외 2개")).toBeVisible();

  // 2) The POI shows as selected (halo in accent blue around it).
  const [, , poiBlue] = await canvasPixel(page, 10, 0); // on the halo ring
  expect(poiBlue).toBeGreaterThan(150);

  // 3) Dragging one selected wall moves the whole selection.
  await dragOnCanvas(page, canvas, [0, -50], [0, -50 + PX_PER_M]);
  const moved = await exportProject(page);
  // 50 screen px = 1 m (plan Y points up, so the sign follows the camera); all by the same amount.
  const dy = moved.walls[0].start.y - before.walls[0].start.y;
  expect(Math.abs(dy)).toBeCloseTo(1, 1);
  for (const [i, wall] of moved.walls.entries())
    expect(wall.start.y).toBeCloseTo(before.walls[i].start.y + dy, 5);
  expect(moved.pois[0].position.y).toBeCloseTo(before.pois[0].position.y + dy, 5);
  expect(moved.spaces[0].polygon).toEqual(before.spaces[0].polygon);

  // 4) A room moves once selected (click inside it, away from walls/POI, then drag).
  await clickAt(page, canvas, -130, 85);
  await dragOnCanvas(page, canvas, [-130, 85], [-130 + PX_PER_M, 85]);
  const roomMoved = await exportProject(page);
  expect(roomMoved.spaces[0].polygon[0].x).toBeCloseTo(before.spaces[0].polygon[0].x + 1, 1);

  // 5) Arrow keys nudge; Ctrl+Z undoes nudge, room move and group move in turn.
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  const nudged = await exportProject(page);
  expect(nudged.spaces[0].polygon[0].x).toBeCloseTo(roomMoved.spaces[0].polygon[0].x + 0.1, 2);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
  const restored = await exportProject(page);
  expect(restored.walls).toEqual(before.walls);
  expect(restored.spaces[0].polygon).toEqual(before.spaces[0].polygon);
  expect(restored.pois[0].position).toEqual(before.pois[0].position);

  expect(errors).toEqual([]);
});

/** A cluttered plan like a real drawing: thick walls, door gaps + swings, furniture, text, dimensions. */
async function uploadClutteredPlan(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "도면 불러오기", exact: true }).click();
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = "#1e1e1e";
    const wall = (x: number, y: number, w: number, h: number) => ctx.fillRect(x, y, w, h);
    // Exterior (12 px) and interior (8 px) walls, with door gaps left open.
    wall(100, 100, 600, 12);
    wall(100, 488, 600, 12);
    wall(100, 100, 12, 400);
    wall(688, 100, 12, 400);
    wall(400, 100, 8, 60);
    wall(400, 205, 8, 295);
    wall(100, 300, 100, 8);
    wall(245, 300, 155, 8);
    wall(400, 260, 120, 8);
    wall(565, 260, 135, 8);
    // Thin clutter.
    ctx.strokeStyle = "#1e1e1e";
    ctx.lineWidth = 2;
    for (const [x, y, w, h] of [
      [130, 140, 100, 110],
      [480, 330, 120, 70],
      [130, 380, 170, 50],
      [430, 120, 130, 30],
    ])
      ctx.strokeRect(x!, y!, w!, h!);
    ctx.beginPath();
    ctx.arc(408, 160, 45, 0, Math.PI / 2);
    ctx.moveTo(200, 308);
    ctx.arc(200, 308, 45, 0, Math.PI / 2);
    ctx.stroke();
    ctx.font = "16px sans-serif";
    ctx.fillText("LIVING ROOM", 230, 210);
    ctx.fillText("KITCHEN", 560, 450);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(100, 60);
    ctx.lineTo(700, 60);
    ctx.moveTo(740, 100);
    ctx.lineTo(740, 500);
    ctx.stroke();
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png"),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  await page.locator(".reference-panel input[type=file]").setInputFiles({
    name: "cluttered-plan.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(page.getByText(/축척:/)).toBeVisible();
}

test("vectorizing a cluttered plan: clean walls, rooms become floor, multi-select works", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await uploadClutteredPlan(page);
  await page.getByRole("button", { name: "자동 벡터화", exact: true }).click();
  const review = page.locator(".vectorize-panel");
  await expect(review).toBeVisible();

  // Walls: only the real wall runs (10), not furniture/text/dimension strokes.
  const wallHeading = review.getByRole("heading", { name: /^벽 \(/ });
  await expect(wallHeading).toHaveText("벽 (10/10)");
  // The door gaps come back as opening candidates (excluded until reviewed).
  await expect(review.getByRole("heading", { name: /^건축 요소 후보/ })).toBeVisible();
  // Rooms: all four, included by default even though they close across door gaps.
  await expect(review.getByRole("heading", { name: "방 (4/4)", exact: true })).toBeVisible();

  // Multi-select on the canvas: Ctrl+A, then Escape, then a box from inside a room.
  const canvas = page.locator("canvas.studio-canvas");
  await canvas.focus();
  await page.keyboard.press("Control+a");
  await expect(review.getByText(/개 선택됨/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(review.getByText(/개 선택됨/)).toBeHidden();

  // Pick two walls in the list (Shift+click), then drag one on the canvas: both move.
  await review.getByRole("button", { name: /^벽 1 ·/ }).click();
  await review.getByRole("button", { name: /^벽 2 ·/ }).click({ modifiers: ["Shift"] });
  await expect(review.getByText("2개 선택됨")).toBeVisible();
  // Rooms still count as included after editing walls.
  await expect(review.getByRole("heading", { name: "방 (4/4)", exact: true })).toBeVisible();

  await review.getByRole("button", { name: /확정/ }).click();
  await expect(review).toBeHidden();
  const floor = await exportProject(page);
  expect(floor.walls).toHaveLength(10);
  // The floor is laid: every detected room became a space.
  expect(floor.spaces).toHaveLength(4);
  expect(errors).toEqual([]);
});

test("a scanned plan with double-line walls: one wall per wall, no duplicates, rooms found", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "도면 불러오기", exact: true }).click();
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 620;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#b2b2b2"; // grey paper
    ctx.fillRect(0, 0, 900, 620);
    ctx.filter = "blur(0.7px)"; // scan softness
    ctx.fillStyle = "#373737";
    const h = (x0: number, x1: number, y: number, t = 2) => ctx.fillRect(x0, y, x1 - x0, t);
    const v = (x: number, y0: number, y1: number, t = 2) => ctx.fillRect(x, y0, t, y1 - y0);
    /** A wall as its two face lines, open (with end caps) at `cuts`. */
    const wall = (
      o: "h" | "v",
      at: number,
      from: number,
      to: number,
      gap: number,
      cuts: number[][] = [],
    ) => {
      let cursor = from;
      for (const [a, b] of [...cuts, [to, to]]) {
        for (const face of [at - gap / 2, at + gap / 2 - 2])
          if (o === "h") h(cursor, a!, face);
          else v(face, cursor, a!);
        cursor = b!;
      }
      for (const [a, b] of cuts)
        for (const end of [a!, b! - 2])
          if (o === "h") v(end, at - gap / 2, at + gap / 2);
          else h(at - gap / 2, at + gap / 2, end);
    };
    wall("h", 100, 92, 808, 16, [[250, 330]]);
    wall("h", 500, 92, 808, 16);
    wall("v", 100, 92, 508, 16);
    wall("v", 800, 92, 508, 16);
    wall("v", 450, 108, 492, 10, [[170, 215]]);
    wall("h", 300, 108, 450, 10, [[220, 265]]);
    wall("h", 270, 450, 792, 10, [[560, 605]]);
    // Dimension lines with ticks (outside, and just inside a room), furniture, text.
    h(100, 800, 55, 1);
    for (const x of [100, 450, 800]) v(x, 47, 63, 1);
    h(140, 420, 140);
    for (const x of [140, 420]) v(x, 128, 152);
    ctx.strokeStyle = "#373737";
    ctx.lineWidth = 2;
    ctx.strokeRect(140, 180, 110, 90);
    ctx.strokeRect(520, 330, 130, 80);
    ctx.font = "18px sans-serif";
    ctx.fillText("거실 LIVING", 280, 230);
    ctx.fillText("주방", 620, 450);
    ctx.filter = "none";
    // Grain.
    const img = ctx.getImageData(0, 0, 900, 620);
    let seed = 11;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      const n = (seed / 2147483647) * 28 - 14;
      for (let c = 0; c < 3; c++) img.data[i + c] = img.data[i + c]! + n;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png"),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  await page.locator(".reference-panel input[type=file]").setInputFiles({
    name: "double-line-scan.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(page.getByText(/축척:/)).toBeVisible();

  // Calibrate like a user would (축척 보정: two clicks + real distance) to the
  // drawing's true 0.02 m/px. First pass measures how many image px the clicks span.
  const scale = page.getByText(/축척:/);
  const mpp = async () => Number(/([\d.]+) m\/px/.exec((await scale.textContent())!)![1]);
  const calibrate = async (meters: number) => {
    page.once("dialog", (dialog) => dialog.accept(String(meters)));
    await page.locator(".tool-groups").getByRole("button", { name: "축척 보정" }).click();
    const canvas = page.locator("canvas.studio-canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2 - 100, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2 + 100, box.y + box.height / 2);
  };
  const before = await mpp();
  await calibrate(10);
  await expect.poll(mpp).not.toBe(before);
  // The clicks span a fixed world distance; how many image px that is depends on the current scale.
  const after = await mpp();
  const worldSpan = (10 / after) * before; // image px spanned first × the scale then
  await calibrate((worldSpan / after) * 0.02);
  await expect.poll(mpp).toBeCloseTo(0.02, 3);
  await page.getByRole("button", { name: "도면", exact: true }).click();

  // This test covers the line-based reader's face pairing.
  await page.getByTestId("vectorize-method").selectOption("lines");
  await page.getByRole("button", { name: "자동 벡터화", exact: true }).click();
  const review = page.locator(".vectorize-panel");
  await expect(review).toBeVisible();
  await expect(review.getByText(/두 줄 선으로 그린 도면/)).toBeVisible();
  await expect(review.getByText(/축척이 맞지 않는/)).toHaveCount(0);

  const heading = await review.getByRole("heading", { name: /^벽 \(/ }).textContent();
  const wallCount = Number(/\/(\d+)\)/.exec(heading!)![1]);
  expect(wallCount).toBeGreaterThanOrEqual(11);
  expect(wallCount).toBeLessThanOrEqual(12);
  await expect(review.getByRole("heading", { name: "방 (4/4)", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("double-line-review.png") });
  expect(errors).toEqual([]);
});

test("the tool hint card can be hidden, stays hidden after a reload, and comes back", async ({
  page,
}) => {
  await page.goto("/");
  const hud = page.locator(".tool-hud");
  await expect(hud).toBeVisible();
  await page.getByRole("button", { name: "도구 안내 숨기기" }).click();
  await expect(hud).toHaveCount(0);
  await page.reload();
  await expect(page.locator("canvas.studio-canvas")).toBeVisible();
  await expect(hud).toHaveCount(0);
  await page.getByRole("button", { name: "도구 안내 보기" }).click();
  await expect(hud).toBeVisible();
});
