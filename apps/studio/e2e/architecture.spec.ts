import { expect, test } from '@playwright/test';

test('review an opening as a window and replace stair strokes in the 3D preview', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', {name:'도면 불러오기',exact:true}).click();
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=240;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,320,240);
    ctx.fillStyle='#000';
    ctx.fillRect(20,20,280,4);ctx.fillRect(20,20,4,200);ctx.fillRect(296,20,4,200);
    ctx.fillRect(20,216,120,4);ctx.fillRect(160,216,140,4);
    for(let i=0;i<8;i++)ctx.fillRect(210,60+i*6,30,2);
    return canvas.toDataURL('image/png');
  });
  await page.locator('input[type=file]').setInputFiles({name:'architecture.png',mimeType:'image/png',buffer:Buffer.from(dataUrl.split(',')[1]!,'base64')});
  await page.getByRole('button',{name:'자동 벡터화',exact:true}).click();
  const review=page.locator('.vectorize-panel');
  await expect(review.getByRole('heading',{name:'건축 요소 후보 (0/2)',exact:true})).toBeVisible();
  await review.getByRole('button',{name:/통로 \/ 미분류 틈 1/}).click();
  await review.getByRole('combobox',{name:'종류',exact:true}).selectOption('window');
  await review.getByLabel('창문 하단 높이 (m)',{exact:true}).fill('0.8');
  await review.getByLabel('창문 하단 높이 (m)',{exact:true}).press('Tab');
  await review.getByRole('button',{name:'검토한 후보 포함',exact:true}).click();
  await expect(review.getByRole('heading',{name:'건축 요소 후보 (1/2)',exact:true})).toBeVisible();
  await review.getByRole('button',{name:/계단 2/}).click();
  await review.getByLabel('높이 (m · 추정 기본값)',{exact:true}).fill('2.8');
  await review.getByLabel('높이 (m · 추정 기본값)',{exact:true}).press('Tab');
  await review.getByRole('button',{name:'검토한 후보 포함',exact:true}).click();
  await expect(review.getByRole('heading',{name:'건축 요소 후보 (2/2)',exact:true})).toBeVisible();
  await review.getByRole('checkbox',{name:'방 1 포함',exact:true}).check();
  await page.getByRole('button',{name:'3D 미리보기',exact:true}).click();
  await expect(page.locator('.preview-3d canvas:visible')).toBeVisible();
  await expect(page.locator('.hint-banner')).toContainText('검토용 초안 포함');
  await expect.poll(async () => page.locator('.preview-3d canvas:visible').evaluate(element => new Promise<number>(resolve => requestAnimationFrame(() => {
    const gl=(element as HTMLCanvasElement).getContext('webgl2');if(!gl){resolve(0);return;}
    const pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
    gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let count=0;for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]!-pixels[0]!)+Math.abs(pixels[i+1]!-pixels[1]!)+Math.abs(pixels[i+2]!-pixels[2]!)>30)count++;
    resolve(count);
  })))).toBeGreaterThan(1000);
  await page.screenshot({path:testInfo.outputPath('architecture-3d.png')});
  await review.getByRole('button',{name:/^확정 \(/}).click();
  await page.locator('.export-menu summary').click();
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'프로젝트 JSON',exact:true}).click();
  const stream=await (await pending).createReadStream();
  const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const floor=JSON.parse(Buffer.concat(chunks).toString()).buildings[0].floors[0];
  expect(floor.entrances).toHaveLength(2);
  expect(floor.spaces).toHaveLength(1);
  expect(floor.entrances.find((e:{type:string})=>e.type==='window')).toMatchObject({sillHeight:0.8});
  expect(floor.entrances.find((e:{type:string})=>e.type==='stairs')).toMatchObject({height:2.8,stepCount:8});
  expect(floor.walls.length).toBeLessThan(10);
  expect(errors).toEqual([]);
});
