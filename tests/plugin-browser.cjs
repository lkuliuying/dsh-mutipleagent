'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { createOfficeServer } = require('../src/server');
const { DemoWatcher } = require('../src/demo');

// 仅使用内存夹具，验证插件挂载后的真实模式界面，不读取用户会话。
class HarnessFixture extends DemoWatcher {
  snapshot(...args) {
    return { ...super.snapshot(...args), mode: 'live', source: 'harness' };
  }
}

(async () => {
  const mount = '/dsh-mutipleagent/';
  const cookie = 'fixture-owner=1';
  const watcher = new HarnessFixture();
  const fullReport = '接口检查完成。\n' + '逐项核对金额精度、幂等键和库存错误响应。\n'.repeat(120) + '完整报告结束标记';
  watcher.plan[10][2].last_agent_message = fullReport;
  const office = createOfficeServer({ watcher, basePath: mount.slice(0, -1), defaultDocument: 'demo.html',
    authorize: req => req.headers.cookie === cookie ? undefined : 401 });
  // 同源父页面模拟 Harness 主面板；子页面仍经过实际服务的身份与 CSP 检查。
  const server = http.createServer((req, res) => {
    if (req.url.startsWith(mount)) return office.emit('request', req, res);
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8',
      'set-cookie': cookie + '; HttpOnly; SameSite=Strict; Path=/' });
    res.end('<!doctype html><html lang="zh-CN"><head><title>Harness 插件验证</title>' +
      '<style>html,body{height:100%;margin:0}iframe{display:block;border:0;width:100%;height:100%}</style></head><body>' +
      '<iframe id="office-frame" name="office-frame" title="DSH 协作办公室" sandbox="allow-scripts allow-same-origin" ' +
      'src="' + mount + '?mode=live&amp;source=harness"></iframe></body></html>');
  });
  const out = path.resolve(__dirname, '../.verification');
  fs.mkdirSync(out, { recursive: true });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(base + mount + 'api/sessions')).status, 401);
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [], failedResponses = [], glbResponses = new Set();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin !== base) return;
      if (response.status() >= 400) failedResponses.push(url.pathname + ': ' + response.status());
      if (url.pathname.endsWith('.glb') && response.ok()) glbResponses.add(url.pathname);
    });
    await page.goto(base);
    let frame = await (await page.waitForSelector('#office-frame')).contentFrame();
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true');
    await frame.waitForFunction(() => document.getElementById('mode-label').textContent === '真实会话');
    assert.match(await frame.title(), /DSH Office/);
    assert.equal((await frame.locator('.brand').innerText()).replace(/\s/g, ''), 'DSHOffice');
    assert.equal(await frame.locator('#metric-assigned').innerText(), '2');
    assert.equal(await frame.locator('.scene-pin').count(), 3);
    assert.equal(await frame.locator('.office-gl').count(), 1);
    assert.ok(await frame.evaluate(() => {
      const gl = document.querySelector('.office-gl').getContext('webgl2');
      return gl && !gl.isContextLost() && gl.getParameter(gl.VERSION);
    }));
    assert.ok(glbResponses.size > 2, '三维场景应实际读取本地 GLB 模型');
    assert.ok([...glbResponses].every(url => url.startsWith(mount)), '模型请求应保留插件挂载路径');
    assert.equal((await context.cookies(base)).find(value => value.name === 'fixture-owner').httpOnly, true);
    assert.equal(await frame.evaluate(() => document.cookie), '');

    await frame.locator('#task-search').fill('林');
    await frame.locator('#search-results').waitFor({ state: 'visible' });
    assert.equal(await frame.locator('.search-result').count(), 1);
    await frame.locator('.search-result').click();
    assert.equal(await frame.locator('#detail-name').innerText(), '林 · 接口分析');
    while (watcher.step < 12) watcher.advance();
    await frame.waitForFunction(() => document.getElementById('metric-reports').textContent === '2');
    assert.equal(await frame.locator('#metric-progress').innerText(), '—', '子任务完成不能推断主任务完成');
    await frame.locator('#view-report').click();
    await frame.waitForFunction(() => document.getElementById('dialog-content').textContent.endsWith('完整报告结束标记'));
    assert.equal(await frame.locator('#dialog-content').innerText(), fullReport);
    await frame.locator('#close-demo-dialog').click();
    await frame.locator('#clear-search').click();
    await frame.waitForFunction(() => {
      const fill = document.getElementById('detail-progress-fill');
      return Math.abs(fill.getBoundingClientRect().width - fill.parentElement.getBoundingClientRect().width) < 1;
    });
    await page.screenshot({ path: path.join(out, 'plugin-desktop.png'), fullPage: true });

    await Promise.all([frame.waitForURL(url => url.searchParams.get('mode') !== 'live'), frame.locator('#mode-toggle').click()]);
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true');
    assert.equal(new URL(frame.url()).searchParams.get('source'), 'harness');
    assert.equal(await frame.locator('#mode-label').innerText(), '演示数据');
    assert.match(await frame.title(), /DSH Office/);
    await Promise.all([frame.waitForURL(url => url.searchParams.get('mode') === 'live'), frame.locator('#mode-toggle').click()]);
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true');
    await frame.waitForFunction(() => document.getElementById('mode-label').textContent === '真实会话');
    assert.equal(new URL(frame.url()).searchParams.get('source'), 'harness');
    assert.equal(new URL(frame.url()).pathname, mount + 'demo.html');

    await page.setViewportSize({ width: 900, height: 720 });
    await page.reload();
    frame = await (await page.waitForSelector('#office-frame')).contentFrame();
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true');
    await frame.waitForFunction(() => document.getElementById('mode-label').textContent === '真实会话');
    assert.equal(await frame.locator('#agent-details').isHidden(), true);
    assert.equal(await frame.locator('#open-details').isVisible(), true);
    assert.equal(await frame.locator('#team-picker').isVisible(), true);
    assert.ok(await frame.evaluate(() => {
      const within = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
      };
      return document.documentElement.scrollWidth <= innerWidth && within('.nav') && within('.stats') && within('#workflow-dock') && within('.scene-tools');
    }), '紧凑窗口的主要控件应位于视口内');
    await frame.locator('#open-details').click();
    assert.equal(await frame.locator('#agent-details').isVisible(), true);
    await frame.locator('#close-details').click();
    await page.screenshot({ path: path.join(out, 'plugin-compact.png'), fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(failedResponses, []);
    const result = { ok: true, browser: 'Google Chrome', data: 'isolated in-memory fixture', webgl: true,
      checks: ['同源 sandbox iframe', 'HttpOnly 身份校验及未登录 401', 'DSH 品牌', '真实模式团队与 SSE 更新',
        '子路径 GLB 模型', '搜索选择成员', '完整汇报全文', '模拟与真实切换保留来源', '1500x1000 与 900x720 布局'],
      pageErrors: errors, failedResponses, modelCalls: 0, profileWrites: 0 };
    fs.writeFileSync(path.join(out, 'plugin-browser-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
    office.closeOffice();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
