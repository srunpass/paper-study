#!/usr/bin/env node
/** 测试用 CLI：校验隔离参数，并模拟正常、失败和挂起响应。 */
import assert from 'node:assert/strict';
const args = process.argv.slice(2);
assert.ok(args.includes('--ignore-user-config'));
assert.ok(args.includes('read-only'));
assert.ok(args.includes('shell_tool'));
assert.ok(args.includes('apps'));
assert.ok(args.includes('plugins'));
assert.ok(!process.env.PAPER_TEST_SECRET);
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  const prompt = JSON.parse(raw);
  if (prompt.documentData === 'hang') {
    setInterval(() => {}, 1000);
    return;
  }
  if (prompt.documentData === 'fail') {
    process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: '模型测试错误' } }) + '\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '测试翻译' } }) + '\n');
  process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\n');
});
