import js from '@eslint/js';
import globals from 'globals';

const unused = ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }];

export default [
  { ignores: ['node_modules/**', 'public/**', 'assets/**', '.artifacts/**', '.verification/**', 'vendor/office.js'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'src/**/*.cjs', 'tests/**/*.js', 'tests/**/*.cjs', 'scripts/**/*.cjs', 'harness.cjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: globals.node },
    rules: { 'no-unused-vars': unused, 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    files: ['scripts/**/*.mjs', 'web/**/*.mjs', 'web/**/*.js', 'vendor/office3d.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-unused-vars': unused, 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    // 这些用例把浏览器环境当参数传给 Playwright 或直接模拟 location，需要浏览器全局。
    files: ['tests/browser.cjs', 'tests/plugin-browser.cjs', 'tests/live-source.test.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
  },
  {
    // client.js 是宿主加载的经典脚本，运行环境是 Harness 注入的 window。
    files: ['client.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, __ModuleLoader__: 'readonly' } },
    rules: { 'no-unused-vars': unused },
  },
];
