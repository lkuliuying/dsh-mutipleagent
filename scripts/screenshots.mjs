'use strict';
// 生成 README / 插件市场用的截图（中英各一套）。需要本地已安装 Playwright Chromium。
// 用法：npm run screenshots
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'assets', 'screenshots');
const port = 4329;
const base = `http://127.0.0.1:${port}`;
const viewport = { width: 1600, height: 1000 };

fs.mkdirSync(outDir, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      /* 服务还没起来 */
    }
    await sleep(250);
  }
  throw new Error('办公室服务在 20 秒内没有就绪');
}

const server = spawn(process.execPath, ['src/server.js', '--demo', '--port', String(port)], { cwd: root, stdio: 'ignore', windowsHide: true });
const cleanup = () => {
  try {
    server.kill();
  } catch {
    /* 已退出 */
  }
};
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(0));

let browser;
try {
  await waitForHealth();
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: 'light', locale: 'zh-CN' });
  const page = await context.newPage();
  const shot = async (name, options = {}) => {
    const file = path.join(outDir, `${name}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 82, ...options });
    const size = fs.statSync(file).size;
    console.log(`- ${path.relative(root, file)}  ${(size / 1024).toFixed(0)} KB`);
  };
  const settle = async (ms = 2500) => {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(ms);
  };
  const setLang = async lang => {
    const current = await page.evaluate(() => (document.documentElement.lang || '').slice(0, 2));
    if (current === lang) return;
    await page.locator(`[data-lang-switch] [data-lang="${lang}"]`).click({ timeout: 5000 });
    await page.waitForFunction(target => document.documentElement.lang.startsWith(target), lang, { timeout: 8000 });
    await page.waitForTimeout(500);
  };
  const closeDetails = page.locator('#close-details');
  const closeIfOpen = async () => {
    if (await closeDetails.isVisible().catch(() => false)) {
      await closeDetails.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  };

  // 一套截图：同一个语言下依次拍演示全景、任务详情、通知中心、实时主界面。
  const captureAll = async lang => {
    const suffix = lang === 'en' ? '-en' : '';

    await page.goto(`${base}/demo.html`, { waitUntil: 'domcontentloaded' });
    await setLang(lang);
    await settle(5000);
    await closeIfOpen();
    await shot(`demo-office${suffix}`);

    const card = page.locator('#scene-pins .scene-pin').first();
    if (await card.count()) {
      await card.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);
      await shot(`demo-task-detail${suffix}`);
    } else {
      console.warn('! 没找到 Agent 卡片，跳过详情截图');
    }

    await closeIfOpen();
    const bell = page.locator('#notifications-button');
    if (await bell.count()) {
      await bell.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
      await shot(`demo-notifications${suffix}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else {
      console.warn('! 没找到通知按钮，跳过通知截图');
    }

    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await setLang(lang);
    await settle(5000);
    await shot(`live-office${suffix}`);
  };

  await captureAll('zh');
  await captureAll('en');
} finally {
  await browser?.close().catch(() => {});
  cleanup();
}

// 市场只读中文那套；英文图只给 README.en.md 用，避免同一份清单里混语言。
// 顺序即市场里的展示顺序，第一张是封面，所以办公室全景要排在最前。
const ORDER = ['demo-office.jpg', 'demo-task-detail.jpg', 'demo-notifications.jpg', 'live-office.jpg'];
const rank = name => {
  const index = ORDER.indexOf(name);
  return index === -1 ? ORDER.length : index;
};
const manifest = fs
  .readdirSync(outDir)
  .filter(name => name.endsWith('.jpg') && !name.endsWith('-en.jpg'))
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  .map(name => `assets/screenshots/${name}`);
fs.writeFileSync(path.join(root, 'screenshots.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`screenshots.json 已写入（${manifest.length} 张）`);
