import { expect, test } from "@playwright/test";

test("upload, vectorize, edit, exclude, undo, confirm and export", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "도면 불러오기", exact: true }).click();
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 180;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#eeeeee";
    ctx.fillRect(0, 0, 240, 180);
    ctx.strokeStyle = "#444444";
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, 200, 140);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(70, 90);
    ctx.lineTo(120, 90);
    ctx.stroke();
    return canvas.toDataURL("image/png");
  });
  await page.locator(".reference-panel input[type=file]").setInputFiles({
    name: "plan.png",
    mimeType: "image/png",
    buffer: Buffer.from(dataUrl.split(",")[1]!, "base64"),
  });
  await page.getByRole("button", { name: "가구 선 줄이기", exact: true }).click();
  await page.getByRole("button", { name: "자동 벡터화", exact: true }).click();
  const review = page.locator(".vectorize-panel");
  await expect(review).toBeVisible();
  await expect(review.getByRole("heading", { name: "벽 (4/4)", exact: true })).toBeVisible();
  await expect(review.getByRole("heading", { name: "방 (1/1)", exact: true })).toBeVisible();
  await review.getByRole("button", { name: /벽 1 ·/ }).click();
  const x = review.getByRole("spinbutton", { name: "start x", exact: true });
  const oldX = Number(await x.inputValue());
  const canvas = page.locator("canvas.studio-canvas");
  const bounds = (await canvas.boundingBox())!;
  // Focusing a wall centers its midpoint. Drag its body 20 screen pixels.
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 20, bounds.y + bounds.height / 2 + 20, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(x).toHaveValue(String(oldX + 0.4));
  await expect(review.getByRole("heading", { name: "방 (0/1)", exact: true })).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(x).toHaveValue(String(oldX));
  await expect(review.getByRole("heading", { name: "방 (1/1)", exact: true })).toBeVisible();
  await review.getByRole("button", { name: "선택한 벽 제외", exact: true }).click();
  await expect(review.getByRole("heading", { name: "벽 (3/4)", exact: true })).toBeVisible();
  await review.getByRole("button", { name: "수정 취소", exact: true }).click();
  await expect(review.getByRole("heading", { name: "벽 (4/4)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "격자 표시 전환", exact: true }).click();
  await expect(page.getByRole("button", { name: "격자 표시 전환", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.screenshot({ path: testInfo.outputPath("vectorization-review.png") });
  await review.getByRole("button", { name: "확정 (5개 추가)", exact: true }).click();
  await expect(review).toBeHidden();
  const exportProject = async () => {
    const menu = page.locator(".export-menu");
    if ((await menu.getAttribute("open")) === null) await menu.locator("summary").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "프로젝트 JSON", exact: true }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString());
  };
  const project = await exportProject();
  expect(project.buildings[0].floors[0].walls).toHaveLength(4);
  expect(project.buildings[0].floors[0].spaces).toHaveLength(1);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 20, {
    steps: 5,
  });
  await page.mouse.up();
  const moved = await exportProject();
  expect(moved.buildings[0].floors[0].walls[0].start.y).toBeCloseTo(
    project.buildings[0].floors[0].walls[0].start.y - 0.4,
  );
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  const undone = await exportProject();
  expect(undone.buildings[0].floors[0].walls).toHaveLength(0);
  expect(undone.buildings[0].floors[0].spaces).toHaveLength(0);
  expect(errors).toEqual([]);
});
