'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { CodexWatcher } = require('../src/codex');
const rootId = process.argv[2];
if (!rootId || !/^[0-9a-f-]{36}$/i.test(rootId)) {
  console.error('用法：node tests/live.cjs 主会话ID');
  process.exitCode = 1;
} else
  (async () => {
    const watcher = new CodexWatcher();
    watcher.tick();
    assert.ok(watcher.select(rootId), '主会话必须存在于已发现的日志中');
    const data = watcher.snapshot(rootId);
    const children = data.agents.filter(s => s.parentId && s.relationship !== 'conflict');
    const assignments = data.events.filter(e => e.type === 'assign');
    let completeReports = 0;
    for (const child of children) {
      if (!child.reportEventId) continue;
      const report = watcher.fullText(child.id, child.reportEventId);
      assert.ok(report?.text.length > 0, '汇报正文必须可完整读取');
      assert.ok(!/^gAAAAA[A-Za-z0-9_-]{90,}/.test(report.text), '加密载荷不算可见汇报');
      completeReports++;
    }
    assert.ok(children.length >= 2, '验收需要至少两个真实子 Agent');
    assert.ok(assignments.length >= 2, '验收需要真实分配事件');
    assert.ok(completeReports >= 2, '验收需要至少两份真实子 Agent 汇报');
    assert.ok(!data.agents.some(s => s._internal), '内部审批不作为协作成员');
    const main = data.agents.find(s => s.id === rootId);
    const { LiveViewAdapter } = await import('../web/live-state.mjs');
    const view = new LiveViewAdapter().update(data);
    assert.ok(view.assigned >= 2, '本轮需要至少两个真实子 Agent');
    assert.ok(view.received >= 2, '本轮需要至少两份有效汇报，不能使用旧轮次结果替代');
    const evidence = {
      checkedAt: new Date().toISOString(),
      mode: data.mode,
      rootId,
      agents: data.agents.length,
      childAgents: children.length,
      assignments: assignments.length,
      completeChildReports: completeReports,
      mainStatus: main?.status,
      currentChildAgents: view.assigned,
      currentChildReports: view.received,
      mainHasRecordedFinalReply: !!main?.reportEventId,
      currentMainTurnComplete: main?.status === 'done',
      warnings: data.warnings,
      result: '真实父子关系、任务分配和完整子 Agent 汇报通过；主任务本轮是否结束以 currentMainTurnComplete 为准',
    };
    const out = path.resolve(__dirname, '../.verification');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'live-result.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  })().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
