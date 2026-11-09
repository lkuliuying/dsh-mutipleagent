'use strict';
// i18n 的默认语言与切换：默认必须是中文，不能跟着 Node 进程的 navigator.language 走，
// 否则同一份代码在 CI 的 Linux 机器上会默认成英文，中文断言全部失败。
const test = require('node:test');
const assert = require('node:assert/strict');

let i18n;

test.before(async () => {
  i18n = await import('../web/i18n.mjs');
});

test('没有 window 时默认中文，即使 navigator.language 是英文', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(i18n.getLang(), 'zh');
});

test('切换语言后同一个 key 返回对应语言，并能取回参数插值', () => {
  const zhClose = i18n.t('common.close');
  assert.equal(i18n.setLang('en'), 'en');
  assert.equal(i18n.getLang(), 'en');
  assert.equal(i18n.t('common.close'), 'Close');
  assert.equal(i18n.t('demo.ariaSelectAgent', { name: 'API agent' }), 'Select API agent');
  i18n.setLang('zh');
  assert.equal(i18n.t('common.close'), zhClose);
});

test('缺失的 key 回退成 key 本身，不抛错', () => {
  assert.equal(i18n.t('definitely.missing.key'), 'definitely.missing.key');
});

test('监听者只在语言真的变化时收到通知', () => {
  const seen = [];
  const off = i18n.onLangChange(lang => seen.push(lang));
  i18n.setLang('zh'); // 已经是中文，不应通知
  i18n.setLang('en');
  off();
  i18n.setLang('zh');
  assert.deepEqual(seen, ['en']);
});
