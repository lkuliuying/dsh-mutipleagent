'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodexWatcher } = require('../src/codex');
const IDS = {
  main: '11111111-1111-4111-8111-111111111111',
  child: '22222222-2222-4222-8222-222222222222',
  second: '33333333-3333-4333-8333-333333333333',
  nested: '44444444-4444-4444-8444-444444444444',
};
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-office-test-'));
  const watcher = new CodexWatcher({ codexHome: home, scanInterval: 1 });
  const files = new Map();
  let clock = Date.now() - 60000;
  function line(id, type, payload) {
    return JSON.stringify({ timestamp: new Date((clock += 100)).toISOString(), type, payload }) + '\n';
  }
  function write(id, type, payload) {
    fs.appendFileSync(files.get(id), line(id, type, payload));
  }
  function create(id, parent = null, day = '2026/11/09') {
    const dir = path.join(home, 'sessions', day);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'rollout-test-' + id + '.jsonl');
    files.set(id, file);
    fs.writeFileSync(
      file,
      line(id, 'session_meta', {
        id,
        cwd: '/sample',
        thread_source: parent ? 'subagent' : 'user',
        source: parent ? { subagent: { thread_spawn: { parent_thread_id: parent, agent_nickname: '检查员', depth: 1 } } } : 'vscode',
      }),
    );
    return file;
  }
  t.after(() => {
    watcher.stop();
    const resolved = path.resolve(home),
      prefix = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(prefix) || !path.basename(resolved).startsWith('codex-office-test-')) throw new Error('无效夹具路径');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const tick = () => {
    watcher.lastScan = 0;
    watcher.tick();
  };
  return { home, watcher, files, create, write, line, tick };
}
module.exports = { fixture, IDS };
