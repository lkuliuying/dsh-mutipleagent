'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const expectedVersion = '0.2.2-rc.1';

async function checkHost() {
  const anchor = path.join(path.dirname(process.execPath), 'resources', 'app.asar', 'dsh', 'package.json');
  const hostRequire = createRequire(anchor);
  const host = name => hostRequire('@deepseek-ai/' + name);
  for (const name of ['dsh-session', 'dsh-session-query', 'dsh-host-webserver', 'dsh-client-connection']) {
    assert.equal(hostRequire('@deepseek-ai/' + name + '/package.json').version, expectedVersion, '该检查仅针对已核对的 DSH ' + expectedVersion);
  }
  const { Context } = host('cordis');
  const { SessionStore } = host('dsh-session');
  const { SessionQueryEngine } = host('dsh-session-query');
  const { WebServer } = host('dsh-host-webserver');
  const { HostConnectionService } = host('dsh-client-connection');
  const ctx = new Context();
  let plugin;
  try {
    new SessionStore(ctx);
    new SessionQueryEngine(ctx);
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 });
    // 使用真实 HostConnectionService 的边界检查，但不读取用户凭据或 profile。
    new HostConnectionService(ctx, [], {
      isAuthenticated: request => request.headers.cookie === 'office-smoke=owner',
      authenticateApi: () => undefined,
    });

    const root = ctx.sessions.create('office-smoke-root', { meta: { cwd: process.cwd() } });
    const child = ctx.sessions.create('office-smoke-child', {
      meta: { cwd: process.cwd(), origin: 'subagent', parentSession: root.id, delegationDepth: 1 },
    });
    const report = '隔离宿主验证的完整子 Agent 汇报。\n'.repeat(300);
    function appendTurn(session, task, output) {
      session.append('turn/start', { turn: 1 });
      session.append(
        'user/message',
        {
          id: session.id + '-user',
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: task }],
        },
        { surfaceOp: 'append' },
      );
      session.append(
        'assistant/message',
        {
          turn: 1,
          step: 1,
          stream: [],
          message: {
            id: session.id + '-assistant',
            role: 'assistant',
            source: { kind: 'model', provider: 'isolated-smoke', model: 'synthetic-no-model-call' },
            content: [{ type: 'text', text: output }],
          },
        },
        { surfaceOp: 'append' },
      );
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
    }
    appendTurn(root, '检查隔离团队', '隔离主 Agent 已汇总结果。');
    appendTurn(child, '检查隔离子任务', report);
    root.append('session/title', { title: '当前会话标题', messageSeqs: [], source: { kind: 'user' } });
    const history = ctx.sessions.create('office-smoke-history', {
      meta: { cwd: path.join(process.cwd(), 'history'), createdAt: root.header.createdAt - 1000 },
    });
    history.append('session/title', { title: '历史会话标题', messageSeqs: [], source: { kind: 'user' } });
    assert.equal((await ctx.sessionQuery.readSession(child.id)).events.length, 4);
    assert.equal((await ctx.sessionQuery.listSessions()).length, 3);

    plugin = await ctx.plugin(require('../harness.cjs'));
    const base = ctx.webServer.getOrigin() + '/dsh-mutipleagent';
    const get = (resource, headers = {}) =>
      fetch(base + resource, {
        headers: { cookie: 'office-smoke=owner', ...headers },
        signal: AbortSignal.timeout(5000),
      });
    assert.equal((await fetch(base + '/api/health', { signal: AbortSignal.timeout(5000) })).status, 401);
    assert.equal((await get('/api/health', { origin: 'https://example.invalid' })).status, 403);
    // Fetch 会重建 Host；使用原始 HTTP 请求核对 DNS 重绑定边界。
    const hostRefusal = await new Promise((resolve, reject) => {
      const request = http.get(
        base + '/api/health',
        {
          headers: { host: 'example.invalid', cookie: 'office-smoke=owner' },
        },
        response => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.setTimeout(5000, () => request.destroy(new Error('隔离 Host 检查超时')));
      request.on('error', reject);
    });
    assert.equal(hostRefusal, 403);
    assert.equal((await get('/api/health')).status, 200);

    const page = await get('/?mode=live&source=harness');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.match(await page.text(), /demo\.js/);
    for (const resource of ['/demo.js', '/demo.css', '/assets/agents/dsh.svg', '/assets/kenney/characters/character-male-a.glb']) {
      const response = await get(resource);
      assert.equal(response.status, 200, resource);
      assert.ok((await response.arrayBuffer()).byteLength > 0, resource);
    }
    assert.equal(
      (await fetch(base + '/api/sessions', { method: 'POST', headers: { cookie: 'office-smoke=owner' }, signal: AbortSignal.timeout(5000) })).status,
      405,
    );

    let snapshot;
    const deadline = Date.now() + 5000;
    do {
      const response = await get('/api/sessions?rootId=' + encodeURIComponent(root.id));
      if (response.ok) snapshot = await response.json();
      if (snapshot?.agents?.length === 2 && snapshot.agents.every(agent => agent.status === 'done')) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.equal(snapshot?.source, 'harness');
    assert.equal(snapshot?.rootId, root.id);
    assert.equal(snapshot?.agents?.length, 2);
    assert.equal(snapshot.agents.find(agent => agent.id === child.id)?.parentId, root.id);
    assert.ok(snapshot.agents.every(agent => agent.status === 'done'));
    assert.deepEqual(snapshot.warnings, []);
    assert.equal(snapshot.roots.find(item => item.id === root.id).title, '当前会话标题');
    assert.equal(snapshot.roots.find(item => item.id === history.id).title, '历史会话标题');
    assert.equal(snapshot.roots.find(item => item.id === history.id).createdAt, history.header.createdAt);
    assert.equal(snapshot.roots.find(item => item.id === history.id).cwd, history.header.cwd);
    const member = snapshot.agents.find(agent => agent.id === child.id);
    assert.ok(member.reportEventId);
    const full = await (await get('/api/report?sessionId=' + encodeURIComponent(child.id) + '&eventId=' + encodeURIComponent(member.reportEventId))).json();
    assert.equal(full.text, report);

    const stream = await get('/events?rootId=' + encodeURIComponent(root.id));
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    const reader = stream.body.getReader();
    let firstEvents = '';
    try {
      while (!firstEvents.includes('data: ')) {
        const item = await reader.read();
        assert.equal(item.done, false);
        firstEvents += new TextDecoder().decode(item.value);
      }
    } finally {
      await reader.cancel();
    }
    assert.ok(firstEvents.includes('"source":"harness"'));

    await plugin.dispose();
    plugin = null;
    assert.equal((await get('/api/health')).status, 404);
    assert.equal(ctx.sessions.list().length, 3);
    return {
      version: expectedVersion,
      host: 'passed',
      syntheticAuth: true,
      checks: [
        'real-cordis-plugin-load',
        'real-session-store-and-query',
        'host-origin-and-authentication',
        'owner-static-assets',
        'readonly-methods',
        'parent-child-snapshot',
        'session-title-and-directory-metadata',
        'full-report',
        'sse',
        'plugin-disposal',
      ],
      sessions: 3,
      agents: snapshot.agents.length,
      reportCharacters: report.length,
      modelCalls: 0,
      profileWrites: 0,
      realUserSessionReads: 0,
    };
  } finally {
    await plugin?.dispose();
    await ctx.fiber.dispose();
  }
}

if (process.argv.includes('--inner')) {
  checkHost()
    .then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
} else {
  const executable = process.env.DSH_DESKTOP_EXE || 'C:/ProgramSoftware/Deepseek/DeepSeek Harness.exe';
  if (!fs.existsSync(executable)) throw new Error('未找到 Desktop，请通过 DSH_DESKTOP_EXE 指定可执行文件');
  const result = spawnSync(executable, ['--expose-internals', __filename, '--inner'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    process.exitCode = result.status || 1;
  } else {
    const evidence = JSON.parse(result.stdout);
    const destination = path.join(__dirname, '..', '.verification', 'host-smoke.json');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(evidence, null, 2) + '\n');
    process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
  }
}
