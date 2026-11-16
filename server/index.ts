import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assistSchema, runCodex } from './ai.ts';

/** 服务器只对本机开放，开发时由 Vite 同源代理。 */
const port = process.argv.includes('--dev') ? 4318 : 4317;
/** 每次服务启动生成的请求令牌，浏览器以自定义请求头发送。 */
const token = randomBytes(32).toString('hex');
/** 唯一工作槽，防止重复点击或多个标签页创建无界任务。 */
let active = false;
/** 当前 Codex 任务，服务退出时主动取消。 */
let activeController: AbortController | null = null;
/** 缓存登录状态，避免反复启动状态检查进程。 */
let statusCache = { checked: 0, installed: false, loggedIn: false, version: '' };
/** 本机 HTTP 应用。 */
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const allowedHosts = ['127.0.0.1:4317', 'localhost:4317', '127.0.0.1:4318', 'localhost:4318'];
  if (!allowedHosts.includes(req.headers.host || '') || (req.headers.origin && !['http://127.0.0.1:4317', 'http://localhost:4317'].includes(req.headers.origin))) {
    res.status(403).json({ error: '仅接受本机页面请求。' }); return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use('/api', express.json({ limit: '512kb' }));
app.get('/api/status', async (_req, res) => {
  if (Date.now() - statusCache.checked > 15_000) {
    const exec = promisify(execFile);
    try {
      const bin = process.env.PAPER_CODEX_BIN || 'codex';
      const version = await exec(bin, ['--version'], { timeout: 5000 });
      let loggedIn = false;
      try { const login = await exec(bin, ['login', 'status'], { timeout: 5000 }); loggedIn = /Logged in/i.test(login.stdout + login.stderr); } catch { /* UI 展示未登录。 */ }
      statusCache = { checked: Date.now(), installed: true, loggedIn, version: version.stdout.trim() };
    } catch { statusCache = { checked: Date.now(), installed: false, loggedIn: false, version: '' }; }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ app: 'paper-study', ...statusCache, token, busy: active });
});
app.post('/api/assist', async (req, res) => {
  const supplied = req.headers['x-paper-token'];
  if (typeof supplied !== 'string' || !/^[0-9a-f]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
    res.status(403).json({ error: '连接已过期，请刷新页面后重试。' }); return;
  }
  const parsed = assistSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: '问题或论文上下文超过长度限制，请缩小范围。' }); return; }
  if (active) { res.status(429).json({ error: 'Codex 正在处理另一个请求，请稍后重试。' }); return; }
  active = true;
  const controller = new AbortController();
  activeController = controller;
  res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.on('close', () => controller.abort());
  try {
    await runCodex(parsed.data, event => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); }, controller.signal);
  } catch { if (!res.destroyed) res.write(JSON.stringify({ type: 'error', text: '本机服务暂时无法完成请求，请重试。' }) + '\n'); }
  finally { active = false; activeController = null; res.end(); }
});
/** 未匹配的 API 不回退到 HTML。 */
app.use('/api', (_req, res) => { res.status(404).json({ error: '接口不存在。' }); });
/** 将 JSON 解析错误转换为可读错误，避免泄露服务端堆栈。 */
app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error.status === 413 ? 413 : 400).json({ error: '请求格式错误或内容过大。' });
});
if (port === 4317) {
  const dist = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist');
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => { res.sendFile(resolve(dist, 'index.html')); });
}
/** 持有服务器句柄，停止时先取消模型任务再关闭监听。 */
const server = app.listen(port, '127.0.0.1', () => { console.log(`知页已启动：http://127.0.0.1:${port}`); });
/** 关闭本机服务并回收尚在执行的独立进程。 */
function shutdown() {
  activeController?.abort();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
