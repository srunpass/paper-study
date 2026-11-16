/** 页面内的矩形，坐标采用 PDF 视口单位，原点在左上角。 */
export interface Rect {
  /** 左坐标。 */ x: number;
  /** 上坐标。 */ y: number;
  /** 宽度。 */ width: number;
  /** 高度。 */ height: number;
}

/** PDF 文本项在页面上的位置，索引与 PDF.js 的文本层一致。 */
export interface TextRun extends Rect {
  /** PDF 文本项索引（不含标记项）。 */ index: number;
  /** 未改写的原始字符。 */ text: string;
  /** 字号。 */ fontSize: number;
  /** 是否使用粗体。 */ bold: boolean;
  /** PDF 基线；用于将上标、数学符号与所属正文行对齐。 */ baseline?: number;
}

/** 一个句子在原始 PDF 文本项内占据的字符范围。 */
export interface SentenceFragment {
  /** PDF 文本项索引。 */ item: number;
  /** 起始字符，包含此位置。 */ start: number;
  /** 结束字符，不包含此位置。 */ end: number;
}

/** 原文和译文共享的稳定锚点。 */
export interface Sentence {
  /** 页码、块号、句号组成的唯一标识。 */ id: string;
  /** 原文句子，不依赖模型重新复述。 */ text: string;
  /** PDF 文本层对应的字符范围。 */ fragments: SentenceFragment[];
}

/** 同一段、标题或独立公式；中文排版沿用此结构。 */
export interface ReadingBlock extends Rect {
  /** 块标识。 */ id: string;
  /** 结构类别；公式保留原始画布，不遮盖数学排版。 */ kind: 'paragraph' | 'heading' | 'formula' | 'caption' | 'keywords' | 'footnote' | 'reference' | 'frontmatter' | 'footer';
  /** 原文字号。 */ fontSize: number;
  /** 原始粗体。 */ bold: boolean;
  /** 构成此块的句子。 */ sentences: Sentence[];
  /** 原文基线间距与字号之比，单行默认 1。 */ lineHeight?: number;
  /** 首行缩进，PDF 视口单位。 */ textIndent?: number;
  /** 脚注、文献的续行缩进，PDF 视口单位。 */ hangingIndent?: number;
  /** 原文对齐方式，标题和作者区可以居中。 */ align?: 'left' | 'center' | 'justify';
}

/** 可持久化的页面结构，旧文档按需补全，不删除旧译文。 */
export interface PageLayout {
  /** 提取算法版本，兼容旧缓存并按页升级。 */ version: 1 | 2;
  /** 页面宽。 */ width: number;
  /** 页面高。 */ height: number;
  /** 是否来源于带位置的 PDF。 */ positioned: boolean;
  /** 按阅读顺序排列的块。 */ blocks: ReadingBlock[];
}

/** 已校验完整的一页逐句翻译。 */
export interface AlignedTranslation {
  /** 与本页结构绑定的完整原文签名，避免错配旧内容。 */ source: string;
  /** 锚点与中文句子的对应关系。 */ segments: Record<string, string>;
}

/** 当前结构版本；几何或分段规则变化时升级旧缓存。 */
export const LAYOUT_VERSION = 2;

/** 返回原文签名，不使用概率哈希，也不将旧整页译文伪装成逐句对应。 */
export function layoutSource(layout: PageLayout): string {
  return JSON.stringify(layout.blocks.map(block => block.sentences.map(sentence => [sentence.id, sentence.text])));
}

/** 按语句边界切分，合并学术缩写后误切开的短语。 */
export function sentenceRanges(text: string): { start: number; end: number }[] {
  const parts = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text.replace(/\n/g, ' '))];
  const ranges: { start: number; end: number }[] = [];
  for (const part of parts) {
    const previous = ranges.at(-1);
    if (previous && /(?:\b(?:Fig|Figs|Eq|Eqs|Dr|Prof|vs|al|e\.g|i\.e)\.)\s*$/i.test(text.slice(previous.start, previous.end))) previous.end = part.index + part.segment.length;
    else ranges.push({ start: part.index, end: part.index + part.segment.length });
  }
  return ranges;
}

/** 从纯文本生成段落与句子，保留空行、标题和独立公式。 */
export function textLayout(text: string, page: number): PageLayout {
  const blocks = text.split(/\n\s*\n/).filter(part => part.trim()).map((raw, index): ReadingBlock => {
    const content = raw.trim();
    const heading = /^#{1,6}\s/.test(content) || (content.length < 100 && /^(?:\d+(?:\.\d+)*\.?\s+[A-Z]|[A-Z][A-Z\s:–-]+$)/.test(content));
    const kind = heading ? 'heading' : isFormula(content) ? 'formula' : 'paragraph';
    const id = `p${page}-b${index}`;
    return { id, kind, x: 0, y: index * 60, width: 500, height: 50, fontSize: heading ? 16 : 12, bold: heading,
      sentences: sentenceRanges(content).map((range, number) => ({ id: `${id}-s${number}`, text: content.slice(range.start, range.end), fragments: [] })) };
  });
  return { version: LAYOUT_VERSION, width: 600, height: 800, positioned: false, blocks };
}

/** 仅把高置信度的独立数学行保留为公式，避免整段英文被误识别。 */
function isFormula(text: string): boolean {
  return text.length < 240 && /[=∑∫√∈≤≥]/.test(text) && text.split(/\s+/).filter(word => /^[A-Za-z]{4,}[,.;]?$/.test(word)).length < 5;
}

/** 内部行结构包含原始文本项，便于回填准确字符范围。 */
interface Line extends Rect {
  /** 本行文本项，按横坐标排序。 */ runs: TextRun[];
  /** 代表字号。 */ fontSize: number;
  /** 行的连续文本。 */ text: string;
  /** 粗体状态。 */ bold: boolean;
  /** 主文字的基线，不使用上标的顶部判断所属行。 */ baseline: number;
  /** 根据内容与留白识别的结构类别。 */ kind?: ReadingBlock['kind'];
}

/** 计算矩形并集，不能用整栏白底覆盖图表空隙。 */
function union(rectangles: Rect[]): Rect {
  const x = Math.min(...rectangles.map(rect => rect.x));
  const y = Math.min(...rectangles.map(rect => rect.y));
  return { x, y, width: Math.max(...rectangles.map(rect => rect.x + rect.width)) - x, height: Math.max(...rectangles.map(rect => rect.y + rect.height)) - y };
}

/** 同一行内按真实空隙补空格，保留 PDF 项与连续文本的索引映射。 */
function joinRuns(runs: TextRun[]): { text: string; offsets: { run: TextRun; start: number; end: number }[] } {
  let text = '';
  const offsets: { run: TextRun; start: number; end: number }[] = [];
  for (const run of runs) {
    const previous = offsets.at(-1)?.run;
    if (previous && !/\s$/.test(text) && !/^\s/.test(run.text) && (run.x - previous.x - previous.width > run.fontSize * .12
      || (/^[*∗†‡\d]+$/.test(previous.text.trim()) && previous.fontSize < run.fontSize * .95 && /^\w/.test(run.text)))) text += ' ';
    const start = text.length;
    text += run.text;
    offsets.push({ run, start, end: text.length });
  }
  return { text, offsets };
}

/** 短标题必须独占行；编号标题还需留白，避免把步骤列表当作章节。 */
function academicHeading(text: string, separated: boolean): boolean {
  return /^(?:Abstract|Introduction|Background|Related work|Methods?|Methodology|Results?(?: and discussion)?|Discussion|Conclusions?|Acknowledg(?:e)?ments?|References|Bibliography|Appendix(?:\s+[A-Z])?)\s*$/i.test(text.trim())
    || (separated && text.length < 120 && !/[.;,]$/.test(text.trim()) && /^(?:\d+(?:\.\d+)*\.?|[IVX]+\.|Appendix\s+[A-Z][.:]?)\s+[A-Z]/.test(text));
}

/** 中位数减少特殊符号和上标对正文度量的影响。 */
function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;
}

/** 基线优先取 PDF 度量，无度量的调用方按标准字面框推导。 */
function runBaseline(run: TextRun): number {
  return run.baseline ?? run.y + run.fontSize * .8;
}

/** 内容角色按高置信度规则判定，不依赖 PDF 内部的匿名字体名称。 */
function lineKind(line: Line, height: number, typical: number, abstract: Line | undefined, separated: boolean): ReadingBlock['kind'] {
  if (line.y > height * .85 && /^(?:PII\s*:|\d{4}-\d{4}\/|©|Copyright)/i.test(line.text)) return 'footer';
  if (/^\[\d+\]\s/.test(line.text)) return 'reference';
  const marker = line.runs[0];
  if (line.y > height * .6 && /^[*∗†‡\d]+\s*$/.test(marker.text) && marker.fontSize < line.fontSize * .95) return 'footnote';
  if (/^(?:Keywords?|Key words|Index terms)\s*:/i.test(line.text)) return 'keywords';
  if (academicHeading(line.text, separated)) return 'heading';
  if (abstract && line.y < abstract.y && line.fontSize <= typical * 1.4) return 'frontmatter';
  if (line.fontSize > typical * 1.4 || (line.bold && line.text.length < 120)) return 'heading';
  if (isFormula(line.text)) return 'formula';
  if (/^(?:Figure|Fig\.|Table)\s*\d/i.test(line.text)) return 'caption';
  return 'paragraph';
}

/** 从几何位置恢复行、分栏和段落，忽略 PDF 绘制顺序对阅读顺序的干扰。 */
export function positionedLayout(runs: TextRun[], width: number, height: number, page: number): PageLayout {
  const sorted = runs.filter(run => run.text.trim() && run.width > 0 && run.height > 0 && [run.x, run.y, run.fontSize].every(Number.isFinite)).sort((a, b) => b.fontSize - a.fontSize || a.y - b.y || a.x - b.x);
  const rows: TextRun[][] = [];
  for (const run of sorted) {
    const baseline = runBaseline(run);
    let row: TextRun[] | undefined;
    let nearest = Infinity;
    for (const candidate of rows) {
      const main = candidate[0];
      const distance = Math.abs(runBaseline(main) - baseline);
      if (distance < nearest && distance < main.fontSize * (run.fontSize < main.fontSize * .95 ? .5 : .25)) { row = candidate; nearest = distance; }
    }
    if (row) row.push(run); else rows.push([run]);
  }
  const lines: Line[] = [];
  for (const row of rows) {
    const chunks: TextRun[][] = [];
    for (const run of row.sort((a, b) => a.x - b.x)) {
      const chunk = chunks.at(-1);
      const last = chunk?.at(-1);
      if (!chunk || (last && run.x - last.x - last.width > Math.max(18, run.fontSize * 2))) chunks.push([run]);
      else chunk.push(run);
    }
    for (const items of chunks) {
      const main = [...items].sort((a, b) => b.fontSize - a.fontSize || b.text.length - a.text.length)[0];
      lines.push({ ...union(items), runs: items, fontSize: main.fontSize, baseline: runBaseline(main), text: joinRuns(items).text, bold: main.bold });
    }
  }
  /** 跨栏标题将页面分为纵向区域，每个区域先读左栏，再读右栏。 */
  const midpoint = width / 2;
  const leftCount = lines.filter(line => line.x + line.width < midpoint + 8 && line.width > width * .22).length;
  const rightCount = lines.filter(line => line.x > midpoint - 8 && line.width > width * .22).length;
  const columns = leftCount >= 3 && rightCount >= 3;
  const spanning = columns ? lines.filter(line => line.x < midpoint - 20 && line.x + line.width > midpoint + 20).sort((a, b) => a.y - b.y) : [];
  const typical = median(sorted.filter(run => run.text.length > 20).map(run => run.fontSize)) || median(sorted.map(run => run.fontSize)) || 12;
  /** 横跨整页的大空白也标记新区域，避免把下方新章节提前插到右栏正文前。 */
  const byY = [...lines].sort((a, b) => a.y - b.y);
  const abstract = byY.find(line => /^Abstract$/i.test(line.text.trim()));
  const bodyLines = lines.filter(line => line.width > width * .55);
  const bodyCenter = bodyLines.length ? (median(bodyLines.map(line => line.x)) + median(bodyLines.map(line => line.x + line.width))) / 2 : midpoint;
  for (const [index, line] of byY.entries()) {
    const before = byY[index - 1];
    const after = byY[index + 1];
    const separated = (!before || line.baseline - before.baseline > line.fontSize * 1.65) && (!after || after.baseline - line.baseline > line.fontSize * 1.65);
    line.kind = lineKind(line, height, typical, abstract, separated);
  }
  const cuts = [-Infinity, ...spanning.flatMap(line => [line.y, line.y + .01]), Infinity];
  let bottom = 0;
  for (const line of byY) {
    if (bottom && line.y - bottom > typical * 2.6) cuts.push((bottom + line.y) / 2);
    bottom = Math.max(bottom, line.y + line.height);
  }
  cuts.sort((a, b) => a - b);
  const ordered: Line[] = [];
  for (let regionIndex = 1; regionIndex < cuts.length; regionIndex++) {
    const region = lines.filter(line => line.y >= cuts[regionIndex - 1] && line.y < cuts[regionIndex]);
    region.sort((a, b) => {
      const columnA = columns && a.x >= midpoint - 8 ? 1 : 0;
      const columnB = columns && b.x >= midpoint - 8 ? 1 : 0;
      return columnA - columnB || a.y - b.y || a.x - b.x;
    });
    ordered.push(...region);
  }
  const groups: Line[][] = [];
  for (const line of ordered) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const first = group?.[0];
    const sameColumn = previous && Math.abs(previous.x - line.x) < Math.max(24, typical * 2.5);
    const centered = Math.abs(line.x + line.width / 2 - bodyCenter) < typical * 2;
    const titleContinuation = first?.kind === 'heading' && line.kind === 'heading' && line.fontSize > typical * 1.4 && centered;
    const frontmatterStart = line.kind === 'frontmatter' && /^[a-z]$/.test(line.runs[0].text.trim()) && line.runs[0].fontSize < line.fontSize;
    const hanging = first?.kind === 'footnote' || first?.kind === 'reference';
    const continuation = previous && (sameColumn || titleContinuation || (first?.kind === 'frontmatter' && centered)) && line.baseline > previous.baseline && line.baseline - previous.baseline < line.fontSize * 1.65
      && Math.abs(line.fontSize - previous.fontSize) < line.fontSize * .15 && line.bold === previous.bold
      && (titleContinuation || (line.kind !== 'heading' && first?.kind !== 'heading'))
      && !['formula', 'keywords', 'footnote', 'reference', 'footer'].includes(line.kind!) && !['formula', 'keywords', 'footer'].includes(first?.kind || '')
      && !frontmatterStart && (line.kind === 'paragraph' || line.kind === first?.kind)
      && (hanging || !(line.x - previous.x > typical * .65 && /[.!?:]$/.test(previous.text.trim())));
    if (continuation) groups.at(-1)!.push(line); else groups.push([line]);
  }
  const blocks = groups.map((group, index): ReadingBlock => {
    const id = `p${page}-b${index}`;
    let text = '';
    const offsets: { run: TextRun; start: number; end: number }[] = [];
    for (const line of group) {
      if (text) text += '\n';
      const joined = joinRuns(line.runs);
      const base = text.length;
      offsets.push(...joined.offsets.map(offset => ({ ...offset, start: offset.start + base, end: offset.end + base })));
      text += joined.text;
    }
    const first = group[0];
    const kind = first.kind!;
    const bounds = union(group);
    /** 脚注使用所属栏的可用行宽，短英文行的墨迹宽度不能限制中文换行。 */
    if (kind === 'footnote') {
      const columnLines = lines.filter(line => line.y < first.y && line.width > width * .25 && line.x <= first.x && first.x - line.x < typical * 2.5);
      const right = median(columnLines.map(line => line.x + line.width));
      bounds.width = Math.max(bounds.width, right - bounds.x);
    }
    const hanging = kind === 'footnote' || kind === 'reference';
    const heading = kind === 'heading';
    const centered = (heading || kind === 'frontmatter') && group.every(line => Math.abs(line.x + line.width / 2 - bodyCenter) < typical * 2);
    const textIndent = kind === 'paragraph' && group.length > 1 ? Math.max(0, first.x - bounds.x) : 0;
    const hangingIndent = hanging ? Math.max(0, group[1]?.x - first.x || first.runs[1]?.x - first.x || 0) : 0;
    return { id, ...bounds, fontSize: first.fontSize, bold: first.bold || (heading && academicHeading(first.text, true)), kind,
      lineHeight: group.length > 1 ? median(group.slice(1).map((line, i) => line.baseline - group[i].baseline)) / first.fontSize : 1,
      textIndent, hangingIndent, align: centered ? 'center' : kind === 'paragraph' ? 'justify' : 'left',
      sentences: (heading ? [{ start: 0, end: text.length }] : sentenceRanges(text)).map((range, number) => ({ id: `${id}-s${number}`, text: text.slice(range.start, range.end).replace(/([a-z])-\n([a-z])/g, '$1$2').replace(/\s+/g, ' ').trim(),
        fragments: offsets.filter(offset => offset.end > range.start && offset.start < range.end).map(offset => ({ item: offset.run.index, start: Math.max(range.start - offset.start, 0), end: Math.min(range.end - offset.start, offset.run.text.length) })) })) };
  });
  return { version: LAYOUT_VERSION, width, height, positioned: true, blocks };
}

/** 只复用文本与 PDF 字符范围均相同的译句；结构拆并后不按位置猜配。 */
export function remapTranslation(previous: PageLayout | undefined, next: PageLayout, saved: AlignedTranslation | undefined): AlignedTranslation | undefined {
  if (!saved || !previous || saved.source !== layoutSource(previous)) return;
  const oldSentences = previous.blocks.flatMap(block => block.sentences);
  const segments: Record<string, string> = {};
  for (const sentence of next.blocks.flatMap(block => block.sentences)) {
    const matches = oldSentences.filter(old => old.text === sentence.text && JSON.stringify(old.fragments) === JSON.stringify(sentence.fragments));
    if (matches.length !== 1 || !saved.segments[matches[0].id]) return;
    segments[sentence.id] = saved.segments[matches[0].id];
  }
  return { source: layoutSource(next), segments };
}

/** 仅接受一一对应的完整翻译，拒绝漏句、重复 ID 和未知 ID。 */
export function parseAlignedTranslation(raw: string, layout: PageLayout): AlignedTranslation {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')); }
  catch { throw new Error('本次翻译没有返回逐句对应格式，旧译文已保留，请重试。'); }
  const expected = layout.blocks.flatMap(block => block.sentences);
  const rows = (parsed as { translations?: unknown } | null)?.translations;
  if (!Array.isArray(rows) || rows.length !== expected.length) throw new Error('翻译未完整覆盖本页句子，旧译文已保留，请重试。');
  const allowed = new Set(expected.map(sentence => sentence.id));
  const segments: Record<string, string> = {};
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !allowed.has(row.id) || Object.hasOwn(segments, row.id) || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 20000) throw new Error('翻译的句子对应关系不完整，旧译文已保留，请重试。');
    segments[row.id] = row.text.trim();
  }
  return { source: layoutSource(layout), segments };
}

/** 为导出和旧版兼容生成按原文段落排列的中文，不改变逐句对应关系。 */
export function translationText(layout: PageLayout, translation: AlignedTranslation): string {
  return layout.blocks.map(block => (block.kind === 'heading' ? '## ' : '') + block.sentences.map(sentence => translation.segments[sentence.id]).join('')).join('\n\n');
}
