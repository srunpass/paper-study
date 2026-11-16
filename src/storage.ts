import { openDB } from 'idb';
import type { Paper } from './types';

/** 使用独立数据库保存论文，不占用容量较小的 localStorage。 */
const database = openDB('paper-study-v1', 1, {
  /** 首次启动时建立论文对象仓库。 */
  upgrade(db) { db.createObjectStore('papers', { keyPath: 'id' }); },
});

/** 按导入时间读取论文库。 */
export async function loadPapers(): Promise<Paper[]> {
  return (await (await database).getAll('papers')).sort((a: Paper, b: Paper) => b.addedAt - a.addedAt);
}

/** 将单篇论文及其学习记录原子保存到浏览器。 */
export async function savePaper(paper: Paper): Promise<void> {
  await (await database).put('papers', paper);
}

/** 生成不冒充真实研究结论的入门示例。 */
export function demoPaper(): Paper {
  return {
    id: 'welcome-attention', title: 'Understanding Attention: A Reading Primer', filename: '内置学习示例 · 非正式论文', addedAt: Date.now(), page: 1, demo: true,
    pages: [
      'Understanding Attention: A Reading Primer\n\nA short learning example · Paper Study\n\nABSTRACT\n\nAttention allows a model to assign different weights to different pieces of information. Instead of treating every input equally, the model can focus on the parts that are most useful for a particular prediction.\n\nFor example, consider the sentence “The animal did not cross the street because it was tired.” To understand the word “it”, a reader connects it to “the animal”. An attention mechanism can learn a similar pattern of relevance between tokens.\n\nThis is a teaching example, not a published research paper. It introduces vocabulary and reading strategies that can help you approach papers about language models.',
      '1. FROM INTUITION TO A MECHANISM\n\nIn scaled dot-product attention, a query is compared with a set of keys. The resulting scores are normalized with a softmax function. These normalized weights are then used to combine the corresponding values.\n\nAttention(Q, K, V) = softmax(QKᵀ / √dₖ)V\n\nThe query represents what we are looking for. The keys represent what each item can be matched against. The values carry the information to be combined. The scaling factor helps control the magnitude of the dot products.\n\nA useful reading habit is to ask three questions: What are the inputs? What operation transforms them? What does the output represent? If you can answer these questions in your own words, you are beginning to understand the method.',
      '2. READ WITH QUESTIONS\n\nStart with the abstract to identify the research problem. Read the introduction to understand why the problem matters. Then inspect the method, experiments, and limitations.\n\nWhen reading experiments, distinguish the authors’ claims from the evidence. Which baselines are used? What metrics are reported? Does the evaluation setting support the conclusion?\n\nTry explaining the core idea without looking at the paper. Write down one remaining question and one possible limitation. Revisit your notes after a day to check what you remember.\n\nSuggested next reading: “Attention Is All You Need” by Vaswani and colleagues (2017). Find and verify the original paper before quoting it.'
    ], translations: {}, notes: [], messages: [],
  };
}

/** 导出可移植的 Markdown 学习笔记及对话记录。 */
export function notesMarkdown(paper: Paper): string {
  const notes = paper.notes.map(note => `## 第 ${note.page} 页 · ${new Date(note.createdAt).toLocaleString('zh-CN')}\n\n${note.quote ? '> ' + note.quote.replace(/\n/g, '\n> ') + '\n\n' : ''}${note.text}`).join('\n\n---\n\n');
  const chats = paper.messages.map(message => `### ${message.role === 'user' ? '我的问题' : 'Codex 回答'}${message.searched ? '（已联网）' : ''}\n\n${message.content}`).join('\n\n');
  return `# ${paper.title}\n\n导出时间：${new Date().toLocaleString('zh-CN')}\n\n${notes || '暂无笔记。'}\n\n# 学习对话\n\n${chats || '暂无对话。'}\n`;
}
