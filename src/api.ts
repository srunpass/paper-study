import type { AiEvent, AssistInput } from '../server/ai';
import type { Connection } from './types';

/** 检查登录并取得当前服务的请求令牌。 */
export async function getConnection(): Promise<Connection> {
  const response = await fetch('/api/status');
  if (!response.ok) throw new Error('无法连接本机服务。');
  return response.json();
}

/** 读取增量 JSON 行；仅在明确收到 done 时认定成功。 */
export async function consumeEvents(stream: ReadableStream<Uint8Array>, onEvent: (event: AiEvent) => void): Promise<{ text: string; searched: boolean }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let searched = false;
  let done = false;
  /** 解析完整事件，错误不会被误存成成功的翻译。 */
  const accept = (line: string) => {
    if (!line.trim()) return;
    const event: AiEvent = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.text || '请求失败。');
    if (event.type === 'answer') text = event.text || '';
    if (event.searched) searched = true;
    if (event.type === 'done') done = true;
    onEvent(event);
  };
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() || ''; lines.forEach(accept);
    }
    buffer += decoder.decode();
    accept(buffer);
    if (!done || !text.trim()) throw new Error('回答传输中断，请重试。');
    return { text, searched };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** 使用短生命周期的本机令牌发送请求，支持用户立即取消。 */
export async function askCodex(input: AssistInput, signal: AbortSignal, onEvent: (event: AiEvent) => void): Promise<{ text: string; searched: boolean }> {
  const connection = await getConnection();
  if (!connection.installed) throw new Error('未安装 Codex CLI。请先安装并运行 codex login。');
  if (!connection.loggedIn) throw new Error('请先在终端运行 codex login 完成登录。');
  const response = await fetch('/api/assist', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Paper-Token': connection.token }, body: JSON.stringify(input), signal,
  });
  if (!response.ok) { const result = await response.json(); throw new Error(result.error || '本机服务暂时不可用。'); }
  if (!response.body) throw new Error('浏览器不支持流式响应。');
  return consumeEvents(response.body, onEvent);
}
