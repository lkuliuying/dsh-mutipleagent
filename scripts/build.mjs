'use strict';
// 打包入口：web/app.js 与 web/demo.js 共享 three.js 与 3D 办公室代码，
// 先清掉旧的 chunks 再构建，保证仓库里不残留上一版哈希文件。
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const publicDir = path.join(root, 'public');
fs.rmSync(path.join(publicDir, 'chunks'), { recursive: true, force: true });

await build({
  entryPoints: [path.join(root, 'web/app.js'), path.join(root, 'web/demo.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  splitting: true,
  target: 'es2020',
  chunkNames: 'chunks/[name]-[hash]',
  outdir: publicDir,
  legalComments: 'eof',
  logLevel: 'info',
});
