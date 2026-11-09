'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { DemoWatcher } = require('../src/demo');
const { createOfficeServer } = require('../src/server');
const { fixture, IDS } = require('./helpers.cjs');

(async () => {
  const watcher = new DemoWatcher();
  const server = createOfficeServer({ watcher });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const out = path.resolve(__dirname, '../.verification');
  fs.mkdirSync(out, { recursive: true });
  let browser;
  const cleanups = [];
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1, locale: 'zh-CN' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(base);
    await page.waitForSelector('.agent-card');
    await page.waitForFunction(() => document.getElementById('scene-status').hidden, { timeout: 30000 });
    assert.equal(await page.locator('.agent-card').count(), 3);
    assert.match(await page.locator('#mode').innerText(), /演示/);
    assert.equal(await page.locator('.office-gl').count(), 1);
    assert.ok(
      await page.evaluate(() => {
        const c = document.querySelector('.office-gl');
        const gl = c.getContext('webgl2');
        return gl && !gl.isContextLost() && gl.getParameter(gl.VERSION);
      }),
    );
    await page.screenshot({ path: path.join(out, 'office-desktop.png'), fullPage: true });
    await page.locator('.agent-card').filter({ hasText: '林 · 接口分析' }).click();
    await page.locator('#open-task').click();
    await page.waitForFunction(() => document.getElementById('dialog-body').textContent.includes('只读检查结算接口'));
    await page.locator('#close-dialog').click();
    while (watcher.step < 12) watcher.advance();
    await page.waitForFunction(() => document.getElementById('done-count').textContent === '2');
    await page.locator('#report-tab').click();
    await page.waitForFunction(() => document.getElementById('report-content').textContent.includes('接口检查完成'));
    await page.locator('.report-open').click();
    assert.match(await page.locator('#dialog-body').innerText(), /库存不足/);
    await page.locator('#close-dialog').click();
    const before = await page.locator('.event-card').count();
    await page.reload();
    await page.waitForFunction(() => document.getElementById('scene-status').hidden);
    assert.equal(await page.locator('.event-card').count(), before);
    await page.locator('#reduced-motion').check();
    await page.reload();
    await page.waitForSelector('.agent-card');
    assert.equal(await page.locator('#reduced-motion').isChecked(), true);
    watcher.advance();
    watcher.advance();
    watcher.advance();
    await page.waitForFunction(() => document.getElementById('done-count').textContent === '3');
    await page.getByRole('button', { name: /^主 Agent，/ }).click();
    await page.locator('#report-tab').click();
    await page.waitForFunction(() => document.getElementById('report-content').textContent.includes('协作检查已完成'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, 'office-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1100, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(out, 'office-1100.png'), fullPage: true });
    const fallback = await browser.newContext({ viewport: { width: 1100, height: 800 }, locale: 'zh-CN' });
    await fallback.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (String(type).startsWith('webgl')) return null;
        return original.call(this, type, ...args);
      };
    });
    const noGL = await fallback.newPage();
    await noGL.goto(base);
    await noGL.waitForFunction(() => document.getElementById('scene-status').textContent.includes('3D 暂不可用'));
    assert.equal(await noGL.locator('.agent-card').count(), 3);
    await noGL.locator('#report-tab').click();
    await noGL.waitForFunction(() => document.getElementById('report-content').textContent.includes('协作检查已完成'));
    assert.equal(await noGL.locator('.office-canvas').count(), 1);
    watcher.emit('change');
    watcher.emit('change');
    await noGL.waitForTimeout(100);
    assert.equal(await noGL.locator('.office-canvas').count(), 1);
    await fallback.close();
    // 用文件日志验证切换团队，避免仅在单团队演示上验证选择器。
    const f = fixture({ after: fn => cleanups.push(fn) });
    f.create(IDS.main);
    f.create(IDS.child, IDS.main);
    f.create(IDS.second);
    f.write(IDS.main, 'event_msg', { type: 'user_message', message: '第一组任务' });
    f.write(IDS.second, 'event_msg', { type: 'user_message', message: '第二组任务' });
    f.write(IDS.second, 'event_msg', { type: 'agent_message', message: '第二组进展 A' });
    f.write(IDS.second, 'event_msg', { type: 'agent_message', message: '第二组进展 B' });
    f.tick();
    f.watcher.select(IDS.main);
    f.watcher.select(IDS.second);
    const multi = createOfficeServer({ watcher: f.watcher });
    await new Promise(resolve => multi.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => multi.closeOffice());
    const multiBase = 'http://127.0.0.1:' + multi.address().port;
    const switchPage = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'zh-CN' });
    await switchPage.goto(multiBase);
    await switchPage.waitForSelector('.agent-card');
    await switchPage.locator('#task-select').selectOption(IDS.main);
    await switchPage.waitForFunction(() => document.querySelectorAll('.agent-card').length === 2);
    await switchPage.locator('#task-select').selectOption(IDS.second);
    await switchPage.waitForFunction(
      () => document.querySelectorAll('.agent-card').length === 1 && document.getElementById('agent-task').textContent === '第二组任务',
    );
    // A 记录延迟失败不能覆盖用户随后打开的 B 记录。
    const progress = f.watcher.snapshot(IDS.second).events.filter(e => e.type === 'progress');
    let heldRoute;
    await switchPage.route('**/api/report?**', async route => {
      const id = new URL(route.request().url()).searchParams.get('eventId');
      if (id === progress[0].id) heldRoute = route;
      else await route.continue();
    });
    await switchPage.locator('.activity-item').filter({ hasText: '第二组进展 A' }).getByRole('button').click();
    await switchPage.waitForTimeout(80);
    assert.ok(heldRoute);
    await switchPage.locator('#close-dialog').click();
    await switchPage.locator('.activity-item').filter({ hasText: '第二组进展 B' }).getByRole('button').click();
    await switchPage.waitForFunction(() => document.getElementById('dialog-body').textContent === '第二组进展 B');
    await heldRoute.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'A 的过期失败' }) });
    await switchPage.waitForTimeout(80);
    assert.equal(await switchPage.locator('#dialog-body').innerText(), '第二组进展 B');
    await switchPage.close();
    assert.deepEqual(errors, []);
    const result = {
      ok: true,
      browser: 'Google Chrome',
      webgl: true,
      agents: 3,
      checks: [
        '真实 WebGL 场景',
        'Agent 点选',
        '任务原文',
        '汇报全文',
        '刷新重建',
        '减少动画偏好',
        '主 Agent 总结',
        '390/1100/1500px 布局',
        '无 WebGL 降级',
        '主任务切换',
        '过期报告请求隔离',
      ],
      consoleErrors: errors,
    };
    fs.writeFileSync(path.join(out, 'browser-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
    for (const cleanup of cleanups.reverse()) cleanup();
    server.closeOffice();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
