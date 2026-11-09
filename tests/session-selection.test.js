const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Windows 目录按完整路径合并大小写和分隔符，同名不同路径保持独立', async () => {
  const { directoryKey, directoryGroups, directorySessions } = await import('../web/session-selection.mjs');
  const roots = [{ id: 'one', cwd: 'F:\\Program\\Agent\\' }, { id: 'two', cwd: 'f:/program/agent' },
    { id: 'three', cwd: 'D:/Program/Agent' }, { id: 'four' }];
  const groups = directoryGroups(roots);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0], { key: 'f:/program/agent', path: 'F:\\Program\\Agent\\', count: 2 });
  assert.deepEqual(directorySessions(roots, groups[0].key).map(root => root.id), ['one', 'two']);
  assert.equal(groups[2].path, '未记录工作目录');
  assert.equal(directoryKey('\\\\SERVER\\Work\\'), directoryKey('//server/work'));
  assert.notEqual(directoryKey('/Work/Agent'), directoryKey('/work/agent'));
});

test('重复标题带创建时间与会话标识，缺标题或时间时明确显示', async () => {
  const { sessionLabel } = await import('../web/session-selection.mjs');
  const one = sessionLabel({ id: 'session-11111111', title: '检查接口', createdAt: Date.UTC(2026, 10, 9, 12, 30) });
  const two = sessionLabel({ id: 'session-22222222', title: '检查接口', createdAt: Date.UTC(2026, 10, 9, 12, 30) });
  assert.notEqual(one, two);
  assert.match(one, /检查接口.*2026.*11111111/);
  assert.match(sessionLabel({ id: 'unknown-33333333' }), /未命名会话.*时间未记录.*33333333/);
  assert.match(sessionLabel({ id: 'long', title: '标题'.repeat(50), at: 0 }), /….*1970/);
});
