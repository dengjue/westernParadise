/** 离线生产页真实键鼠验收：持续按键开弹窗、阶道、游览暂停/恢复和声音。 */
export async function verifyLandJourney(page) {
  await page.waitForFunction(() => window.__G?.startup.firstFrameMs > 0);
  const frames = (count = 40) =>
    page.evaluate(async (count) => {
      for (let i = 0; i < count; i++)
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }, count);
  const position = () => page.evaluate(() => window.__G.camera.position.toArray());
  const stationary = async (before, label) => {
    await frames();
    const after = await position();
    if (after.some((v, i) => Math.abs(v - before[i]) > 0.000001))
      throw new Error(`${label} 仍在移动`);
    return after;
  };
  await page.getByRole('button', { name: /^步入此境/ }).click();
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__G.camera.position.z < 82);
  await page.getByRole('button', { name: '造境手记', exact: true }).click();
  const modal = await stationary(await position(), '打开说明');
  await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog').open);
  await stationary(modal, '关闭说明');
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => window.__G.camera.position.z < -44, { timeoutMs: 30000 });
  } finally {
    await page.keyboard.up('w');
  }
  await frames();
  const walk = await position();
  await page.evaluate(() => window.__G.landCamera.selectView(0, true));
  await page.getByRole('button', { name: '自动游览', exact: true }).click();
  await page.waitForFunction(
    () => window.__G.landCamera.traveling && window.__G.landCamera.tourElapsed > 2,
    { timeoutMs: 20000 },
  );
  await page.getByRole('button', { name: '暂停游览', exact: true }).click();
  const paused = await stationary(await position(), '暂停游览');
  await page.getByRole('button', { name: '自动游览', exact: true }).click();
  await frames();
  const resumed = await position();
  if (resumed.every((v, i) => Math.abs(v - paused[i]) < 0.000001))
    throw new Error('恢复游览未继续');
  await page.mouse.move(720, 430);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(750, 440, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction(() => !window.__G.landCamera.touring);
  await page.getByRole('button', { name: '开启环境音', exact: true }).click();
  await page.waitForFunction(() => window.__G.audio.context?.state === 'running');
  const audio = await page.evaluate(() => ({
    started: window.__G.audio.isStarted,
    sources: window.__G.audio.noiseSources.length,
    context: window.__G.audio.context.state,
  }));
  await page.getByRole('button', { name: '关闭环境音', exact: true }).click();
  await page.waitForFunction(() => window.__G.audio.context.state === 'suspended');
  await page.getByRole('button', { name: '隐藏界面', exact: true }).click();
  await page.getByRole('button', { name: '显示界面 · H', exact: true }).click();
  return { modal, walk, paused, resumed, audio, manualTakeover: true };
}
