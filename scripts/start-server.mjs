/** 在独立进程组中启动本机服务，关闭启动终端后仍可继续阅读。 */
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(join(root, '.runtime'), { recursive: true });
const log = openSync(join(root, '.runtime/server.log'), 'a');
try {
  const child = spawn(process.execPath, ['--import', 'tsx', join(root, 'server/index.ts')], { cwd: root, detached: true, stdio: ['ignore', log, log] });
  await once(child, 'spawn');
  writeFileSync(join(root, '.runtime/server.pid'), String(child.pid));
  child.unref();
} finally { closeSync(log); }
