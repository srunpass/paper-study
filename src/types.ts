/** 一条可定位到页码的学习笔记。 */
export interface StudyNote {
  /** 笔记唯一标识。 */
  id: string;
  /** 对应的论文页码，从 1 开始。 */
  page: number;
  /** 笔记正文。 */
  text: string;
  /** 可选原文摘录。 */
  quote: string;
  /** 保存时间。 */
  createdAt: number;
}

/** 已完成的对话内容，不持久化失败或进行中的回答。 */
export interface ChatMessage {
  /** 消息标识。 */
  id: string;
  /** 发言者。 */
  role: 'user' | 'assistant';
  /** Markdown 正文。 */
  content: string;
  /** 提问发生时的页码，保存笔记时保持原始定位。 */
  page?: number;
  /** 是否实际调用了联网搜索。 */
  searched?: boolean;
}

/** 完整的本地论文学习记录。 */
export interface Paper {
  /** 论文标识。 */
  id: string;
  /** 论文标题。 */
  title: string;
  /** 原始文件名称。 */
  filename: string;
  /** 导入日期。 */
  addedAt: number;
  /** 每一页的提取文本。 */
  pages: string[];
  /** 保存在 IndexedDB 中的原始 PDF。 */
  pdf?: Blob;
  /** 逐页翻译缓存，键为从 1 开始的页码。 */
  translations: Record<string, string>;
  /** 最近阅读页码。 */
  page: number;
  /** 学习笔记。 */
  notes: StudyNote[];
  /** 论文专属对话。 */
  messages: ChatMessage[];
  /** 是否为内置教学示例。 */
  demo?: boolean;
}

/** 本机 Codex 连接状态。 */
export interface Connection {
  /** 是否安装 CLI。 */
  installed: boolean;
  /** 是否已登录。 */
  loggedIn: boolean;
  /** CLI 版本。 */
  version: string;
  /** 本机请求令牌，仅保存在内存。 */
  token: string;
}
