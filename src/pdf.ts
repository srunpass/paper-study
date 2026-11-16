import { getDocument, GlobalWorkerOptions, Util, type PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Paper } from './types';
import { pdfOptions } from './pdf-config';
import { positionedLayout, type PageLayout, type TextRun } from './layout';

/** 使用随应用一起构建的 worker，避免将论文发送到外部解析服务。 */
GlobalWorkerOptions.workerSrc = workerUrl;

/** 解析文字的真实坐标、字体和句子范围，保留图表所在的原始画布。 */
export async function extractPageLayout(page: PDFPageProxy): Promise<PageLayout> {
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const runs: TextRun[] = [];
  let index = 0;
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const transform = Util.transform(viewport.transform, item.transform);
    const fontSize = Math.hypot(transform[2], transform[3]);
    const style = content.styles[item.fontName];
    const ascent = style?.ascent ?? (style?.descent ? 1 + style.descent : .8);
    /** 旋转/竖排文本仍由原图显示，不创建可能遮盖图表的翻译块。 */
    if (Math.abs(transform[1]) < .1 && !style?.vertical) runs.push({ index, text: item.str, x: transform[4], y: transform[5] - fontSize * ascent,
      width: item.width, height: fontSize, fontSize, bold: /bold|black|heavy/i.test(item.fontName + ' ' + style?.fontFamily) });
    index++;
  }
  return positionedLayout(runs, viewport.width, viewport.height, page.pageNumber);
}

/** 旧文档只补齐所需页的结构，保留全部原有译文、笔记与对话。 */
export async function readPdfLayout(blob: Blob, number: number): Promise<PageLayout> {
  const task = getDocument({ ...pdfOptions, data: await blob.arrayBuffer() });
  try { return await extractPageLayout(await (await task.promise).getPage(number)); }
  finally { await task.destroy(); }
}

/** 恢复可搜索及发送给模型的段落阅读顺序。 */
export function pageText(layout: PageLayout): string {
  return layout.blocks.map(block => block.sentences.map(sentence => sentence.text).join(' ')).join('\n\n');
}

/** 解析 PDF/TXT/Markdown，保留 PDF 原件并给出明确的容量边界。 */
export async function importPaper(file: File, progress: (text: string) => void): Promise<Paper> {
  if (file.size > 30 * 1024 * 1024) throw new Error('单个文件最大 30 MB，请压缩后重试。');
  const isPdf = file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf && !/\.(txt|md)$/i.test(file.name)) throw new Error('请选择 PDF、TXT 或 Markdown 文件。');
  let pages: string[] = [];
  const layouts: Record<string, PageLayout> = {};
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
        const layout = await extractPageLayout(page);
        layouts[number] = layout;
        pages.push(pageText(layout));
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
  return { id: crypto.randomUUID(), title: title.slice(0, 500), filename: file.name, addedAt: Date.now(), pages, layouts, pdf: isPdf ? file : undefined, translations: {}, page: 1, notes: [], messages: [] };
}
