import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runCodex, type AiEvent, type AssistInput } from '../server/ai.ts';

/** 构建可重复的进程测试输入，不调用付费模型。 */
function input(context: string): AssistInput {
  return { mode: 'translate', title: '测试', question: '翻译', context, history: [], web: false };
}

test('真实子进程的成功、失败与取消均正确结束', async () => {
  const original = process.env.PAPER_CODEX_BIN;
  process.env.PAPER_CODEX_BIN = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));
  process.env.PAPER_TEST_SECRET = 'must-not-leak';
  try {
    const events: AiEvent[] = [];
    await runCodex(input('normal'), event => events.push(event), new AbortController().signal);
    assert.equal(events.at(-1)?.type, 'done');
    assert.equal(events.find(event => event.type === 'answer')?.text, '测试翻译');
    const failed: AiEvent[] = [];
    await runCodex(input('fail'), event => failed.push(event), new AbortController().signal);
    assert.equal(failed.at(-1)?.type, 'error');
    assert.equal(failed.at(-1)?.text, '模型测试错误');
    const abort = new AbortController();
    const cancelled: AiEvent[] = [];
    const start = Date.now();
    const task = runCodex(input('hang'), event => { cancelled.push(event); if (event.type === 'status') setTimeout(() => abort.abort(), 200); }, abort.signal);
    await task;
    assert.ok(Date.now() - start < 5000, '取消应及时结束，而不是等待 3 分钟超时');
    assert.equal(cancelled.some(event => event.type === 'done' || event.type === 'error'), false);
  } finally {
    if (original === undefined) delete process.env.PAPER_CODEX_BIN; else process.env.PAPER_CODEX_BIN = original;
    delete process.env.PAPER_TEST_SECRET;
  }
});
