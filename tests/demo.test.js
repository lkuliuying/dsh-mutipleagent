'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const state = import('../web/demo-state.mjs');

test('独立 Demo 默认展示一个主 Agent 和三个有分配关系的模拟子任务', async () => {
  const { demoSnapshot } = await state;
  const view = demoSnapshot();
  assert.equal(view.mode, 'demo');
  assert.equal(view.agents.length, 4);
  assert.equal(view.agents.filter(s => s.parentId === 'main').length, 3);
  assert.equal(view.assigned, 3);
  assert.equal(view.received, 0);
  assert.equal(view.active, 4);
  assert.equal(view.progress, 33);
  assert.equal(view.stage, 1);
});

test('执行、汇报和主 Agent 总结沿同一时间轴更新', async () => {
  const { demoSnapshot } = await state;
  const reporting = demoSnapshot(32);
  assert.equal(reporting.stage, 2);
  assert.equal(reporting.received, 2);
  assert.equal(reporting.agents.find(s => s.id === 'test').report, null);
  const done = demoSnapshot(48);
  assert.equal(done.progress, 100);
  assert.equal(done.active, 0);
  assert.equal(done.received, 3);
  assert.ok(done.agents.every(s => s.status === 'done' && s.report.includes('演示')));
  assert.equal(done.events.length, 7);
  assert.equal(new Set(done.events.map(e => e.id)).size, 7);
  assert.equal(done.events.at(-1).sessionId, 'main');
});

test('暂停冻结演示，重新开始清空进度，播放到结束自动停止', async () => {
  const { DemoPlayer } = await state;
  const player = new DemoPlayer();
  player.advance(10);
  assert.equal(player.seconds, 16);
  player.play();
  player.advance(2);
  assert.equal(player.seconds, 18);
  player.play();
  player.advance(2);
  assert.equal(player.seconds, 18);
  player.restart();
  assert.equal(player.seconds, 0);
  assert.equal(player.snapshot.assigned, 0);
  player.advance(100);
  assert.equal(player.seconds, 48);
  assert.equal(player.playing, false);
  player.play();
  assert.equal(player.seconds, 0);
  assert.equal(player.playing, true);
});

test('切换演示任务重置时间和播放状态，未知场景不会覆盖当前任务', async () => {
  const { DemoPlayer } = await state;
  const player = new DemoPlayer();
  player.play();
  player.advance(20);
  player.setScenario('review');
  assert.equal(player.seconds, 16);
  assert.equal(player.playing, false);
  assert.equal(player.snapshot.config.title, '检查接口与回归测试');
  assert.match(player.snapshot.agents[1].task, /只读检查/);
  player.setScenario('missing');
  assert.equal(player.scenario, 'review');
});
