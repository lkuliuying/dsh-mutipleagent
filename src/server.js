'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { CodexWatcher } = require('./codex');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.ico': 'image/x-icon' };
const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

function createOfficeServer({ watcher = new CodexWatcher(), basePath = '', defaultDocument = 'index.html', authorize } = {}) {
  const clients = new Set();
  const server = http.createServer();
  const handleRequest = async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' blob:; frame-ancestors " + (basePath ? "'self'" : "'none'") + "; base-uri 'none'");
    // 宿主挂载必须沿用其身份检查，不能把会话暴露为未鉴权的本机接口。
    if (authorize) {
      const rejection = authorize(req);
      if (rejection !== undefined) return json(res, rejection, { error: '请从已登录的 Harness 窗口打开办公室' });
    }
    let host;
    try { host = new URL('http://' + req.headers.host); } catch { return json(res, 403, { error: '仅允许本机访问' }); }
    if (!authorize && !['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return json(res, 403, { error: '仅允许本机访问' });
    if (!authorize && req.headers.origin && req.headers.origin !== host.origin) return json(res, 403, { error: '拒绝跨源请求' });
    if (req.method !== 'GET') return json(res, 405, { error: '只读服务仅支持 GET' });
    const url = new URL(req.url, host);
    if (basePath) {
      if (!url.pathname.startsWith(basePath + '/')) return json(res, 404, { error: '未找到资源' });
      url.pathname = url.pathname.slice(basePath.length);
    }
    if (url.pathname === '/api/sessions' || url.pathname === '/events') {
      const rootId = url.searchParams.get('rootId');
      if (rootId && !watcher.select(rootId)) return json(res, 404, { error: '未找到该会话，请重新选择任务' });
      if (url.pathname === '/api/sessions') return json(res, 200, watcher.snapshot(rootId));
      res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
      res.write('retry: 1500\n\n');
      const client = { res, rootId, signature: '', release: watcher.subscribe?.(rootId || watcher.snapshot().rootId) };
      clients.add(client);
      push(client);
      req.on('close', () => { clients.delete(client); client.release?.(); });
      return;
    }
    if (url.pathname === '/api/report') {
      try {
        const report = await watcher.fullText(url.searchParams.get('sessionId'), url.searchParams.get('eventId'));
        return json(res, report ? 200 : 404, report || { error: '未找到该记录' });
      } catch { return json(res, 409, { error: '原始日志已改变或暂时无法读取，请刷新后重试' }); }
    }
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, mode: watcher.snapshot().mode });
    const asset = url.pathname.startsWith('/assets/');
    const base = asset ? path.join(ROOT, 'assets') : path.join(ROOT, 'public');
    let rel;
    try { rel = decodeURIComponent(asset ? url.pathname.slice(8) : url.pathname === '/' ? '/' + defaultDocument : url.pathname).replace(/^[/\\]+/, ''); }
    catch { return json(res, 400, { error: '无效路径' }); }
    const file = path.resolve(base, rel);
    if (!file.startsWith(base + path.sep)) return json(res, 403, { error: '无效路径' });
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type) return json(res, 404, { error: '未找到资源' });
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return json(res, 404, { error: '未找到资源' });
      res.writeHead(200, { 'content-type': type, 'content-length': st.size });
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    });
  };
  server.on('request', (req, res) => {
    handleRequest(req, res).catch(() => {
      if (res.headersSent) res.destroy();
      else json(res, 500, { error: '办公室暂时无法读取数据，请重新连接' });
    });
  });

  function push(c) {
    const data = watcher.snapshot(c.rootId);
    // 时间戳不参与比较，空闲时只发送心跳。
    const signature = JSON.stringify({ ...data, updatedAt: 0 });
    if (signature === c.signature || c.res.destroyed || c.res.writableLength > 1024 * 1024) return;
    c.signature = signature;
    c.res.write('data: ' + JSON.stringify(data) + '\n\n');
  }
  const broadcast = () => { for (const c of clients) push(c); };
  watcher.on('change', broadcast);
  const timer = setInterval(broadcast, 1000);
  const ping = setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 15000);
  timer.unref(); ping.unref();
  server.on('close', () => {
    clearInterval(timer); clearInterval(ping);
    watcher.off('change', broadcast);
    for (const c of clients) { c.release?.(); c.res.end(); }
    clients.clear();
  });
  server.closeOffice = () => { for (const c of clients) c.res.end(); server.close(); watcher.stop(); };
  return server;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const demo = args.includes('--demo');
  const portArg = args.indexOf('--port');
  const port = portArg < 0 ? 4317 : Number(args[portArg + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port 必须是 0 到 65535 的整数');
  const watcher = demo ? new (require('./demo').DemoWatcher)() : new CodexWatcher();
  watcher.start();
  const server = createOfficeServer({ watcher });
  server.on('error', (e) => { console.error('办公室启动失败：' + e.message); watcher.stop(); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + server.address().port;
    console.log('Codex 协作办公室 · ' + (demo ? '演示数据' : '真实日志，只读'));
    console.log(url);
    if (args.includes('--open')) {
      const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const openArgs = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
      const child = spawn(command, openArgs, { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => console.error('无法自动打开浏览器，请手动访问上方地址。'));
      child.unref();
    }
  });
  process.on('SIGINT', () => server.closeOffice());
  process.on('SIGTERM', () => server.closeOffice());
}
module.exports = { createOfficeServer };
