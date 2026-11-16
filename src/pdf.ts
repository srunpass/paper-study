import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Paper } from './types';
import { pdfOptions } from './pdf-config';

/** 使用随应用一起构建的 worker，避免将论文发送到外部解析服务。 */
GlobalWorkerOptions.workerSrc = workerUrl;

/** 解析 PDF/TXT/Markdown，保留 PDF 原件并给出明确的容量边界。 */
export async function importPaper(file: File, progress: (text: string) => void): Promise<Paper> {
  if (file.size > 30 * 1024 * 1024) throw new Error('单个文件最大 30 MB，请压缩后重试。');
  const isPdf = file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf && !/\.(txt|md)$/i.test(file.name)) throw new Error('请选择 PDF、TXT 或 Markdown 文件。');
  let pages: string[] = [];
  let title = file.name.replace(/\.[^.]+$/, '');
  if (isPdf) {
    const task = getDocument({ ...pdfOptions, data: await file.arrayBuffer() });
    try {
      const doc = await task.promise;
      if (doc.numPages > 300) throw new Error('第一版支持最多 300 页，请拆分文档后导入。');
      const metadata = await doc.getMetadata().catch(() => null);
      const pdfTitle = (metadata?.info as { Title?: string } | undefined)?.Title?.trim();
      if (pdfTitle && pdfTitle.length > 5 && !/^(untitled|microsoft|word)/i.test(pdfTitle)) title = pdfTitle;
      for (let number = 1; number <= doc.numPages; number++) {
        progress(`正在解析第 ${number} / ${doc.numPages} 页…`);
        const page = await doc.getPage(number);
        const content = await page.getTextContent();
        let text = '';
        let previousY: number | undefined;
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const y = item.transform[5];
          if (previousY !== undefined && Math.abs(previousY - y) > Math.max(item.height * 1.7, 20)) text += '\n\n';
          text += item.str + (item.hasEOL ? '\n' : ' ');
          if (item.str.trim()) previousY = y;
        }
        pages.push(text.replace(/([a-z])-\n([a-z])/g, '$1$2').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
        page.cleanup();
      }
    } finally { await task.destroy(); }
  } else {
    const text = (await file.text()).trim();
    if (!text) throw new Error('这个文件没有可阅读的文本。');
    if (text.length > 1_500_000) throw new Error('文本过长，请拆分后导入。');
    /** 按段落分组，避免强行切断单词或中文字符。 */
    let page = '';
    for (const paragraph of text.split(/\n\s*\n/)) {
      if (page && page.length + paragraph.length > 5000) { pages.push(page.trim()); page = ''; }
      for (let i = 0; i < paragraph.length; i += 10000) {
        if (i > 0) { pages.push(page.trim()); page = ''; }
        page += paragraph.slice(i, i + 10000) + '\n\n';
      }
    }
    if (page.trim()) pages.push(page.trim());
  }
  return { id: crypto.randomUUID(), title: title.slice(0, 500), filename: file.name, addedAt: Date.now(), pages, pdf: isPdf ? file : undefined, translations: {}, page: 1, notes: [], messages: [] };
}
