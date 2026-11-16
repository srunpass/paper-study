import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { getDocument, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import './pdf';
import { pdfOptions } from './pdf-config';
import type { PageLayout, ReadingBlock, AlignedTranslation } from './layout';

/** 页面画布与句子定位的输入。 */
interface PdfPageProps {
  /** 本机 PDF 原件。 */ blob: Blob;
  /** 当前页。 */ page: number;
  /** 已恢复的页面结构。 */ layout: PageLayout;
  /** 中文覆盖层；缺省时显示可选中的英文原图。 */ translation?: AlignedTranslation;
  /** 两侧共享的高亮锚点。 */ activeIds: string[];
  /** 查看完整段落，避免密集译文超出原区域。 */ onExpand: (id: string) => void;
}

/** 百分比坐标随缩放自动调整，不改动 PDF 图表。 */
function blockPosition(block: ReadingBlock, layout: PageLayout): CSSProperties {
  return { left: `${block.x / layout.width * 100}%`, top: `${block.y / layout.height * 100}%`, width: `${block.width / layout.width * 100}%`, height: `${block.height / layout.height * 100}%` };
}

/** 在原段落区域内适配中文；放不下时提供精读入口，不静默丢弃译文。 */
function TranslatedBlock({ block, layout, translation, activeIds, onExpand, background }: {
  /** 原文块。 */ block: ReadingBlock;
  /** 页面尺寸。 */ layout: PageLayout;
  /** 完整翻译。 */ translation: AlignedTranslation;
  /** 联动句子。 */ activeIds: string[];
  /** 打开精读。 */ onExpand: (id: string) => void;
  /** 从原画布文字边缘采样的背景色，保留图示的色块。 */ background?: string;
}) {
  /** 按真实渲染高度缩小字体的段落容器。 */
  const box = useRef<HTMLDivElement>(null);
  /** 是否需要显示完整段落入口。 */
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    /** 最低保留原字号的 72%，不无限压缩字体。 */
    const fit = () => {
      const scale = element.clientWidth / block.width;
      if (!scale) return;
      const maximum = block.fontSize * scale;
      const minimum = maximum * .72;
      let size = maximum;
      element.style.fontSize = `${size}px`;
      while ((element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1) && size > minimum) {
        size = Math.max(minimum, size - .25);
        element.style.fontSize = `${size}px`;
      }
      setOverflow(element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element); fit();
    return () => observer.disconnect();
  }, [block, translation]);
  if (block.kind === 'formula') return <button className={`formula-anchor ${block.sentences.some(sentence => activeIds.includes(sentence.id)) ? 'is-anchored' : ''}`} style={blockPosition(block, layout)} data-anchor-id={block.sentences[0]?.id} aria-label={`公式保持原版：${block.sentences.map(sentence => sentence.text).join(' ')}`} />;
  return <div className={`pdf-translation-block block-${block.kind} ${overflow ? 'overfull' : ''}`} style={{ ...blockPosition(block, layout), background, boxShadow: `0 0 0 1.5px ${background || 'white'}` }}>
    <div ref={box} className="pdf-translated-text" style={{ fontWeight: block.bold || block.kind === 'heading' ? 600 : 400 }}>
      {block.sentences.map(sentence => <span key={sentence.id} data-anchor-id={sentence.id} tabIndex={0} className={`sentence ${activeIds.includes(sentence.id) ? 'is-anchored' : ''}`}>{translation.segments[sentence.id]}</span>)}
    </div>
    {overflow && <button className="expand-block" aria-label="展开完整译文段落" title="此段译文较长，点击在段落精读中完整阅读" onClick={() => onExpand(block.sentences[0].id)}>↗</button>}
  </div>;
}

/** 原 PDF 画布保持完整，文字层提供原位选句；译文沿原栏位和段落覆盖。 */
export function PdfPage({ blob, page, layout, translation, activeIds, onExpand }: PdfPageProps) {
  /** 绘图画布。 */
  const canvas = useRef<HTMLCanvasElement>(null);
  /** PDF.js 透明文字层容器。 */
  const textContainer = useRef<HTMLDivElement>(null);
  /** 响应缩放和窗口变更的页面容器。 */
  const frame = useRef<HTMLDivElement>(null);
  /** 当前 PDF 文档，不跨论文复用。 */
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  /** 用户可读的绘制错误。 */
  const [error, setError] = useState('');
  /** 页面完成绘制前不展示上一页内容。 */
  const [loading, setLoading] = useState(true);
  /** 当前文字层已经渲染的批次。 */
  const [rendered, setRendered] = useState(0);
  /** 原文文字边缘的背景采样，不将图示标签一律涂成白色。 */
  const [backgrounds, setBackgrounds] = useState<Record<string, string>>({});
  useEffect(() => {
    let disposed = false;
    let task: ReturnType<typeof getDocument> | undefined;
    setDocument(null); setError(''); setLoading(true);
    blob.arrayBuffer().then(data => {
      if (disposed) return;
      task = getDocument({ ...pdfOptions, data });
      return task.promise.then(doc => { if (!disposed) setDocument(doc); });
    }).catch(() => { if (!disposed) { setError('此 PDF 暂时无法显示，可切换到段落精读。'); setLoading(false); } });
    return () => { disposed = true; void task?.destroy(); };
  }, [blob]);
  useEffect(() => {
    if (!document || !frame.current) return;
    let disposed = false;
    let revision = 0;
    let queue = Promise.resolve();
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    let layer: TextLayer | undefined;
    /** 串行重绘，先取消旧任务，避免两个 render 同时使用同一画布。 */
    const draw = () => {
      const current = ++revision;
      render?.cancel(); layer?.cancel();
      queue = queue.catch(() => {}).then(async () => {
        if (disposed || current !== revision || !canvas.current || !frame.current) return;
        setLoading(true); setError('');
        const pdfPage = await document.getPage(page);
        if (disposed || current !== revision || !canvas.current || !frame.current) return;
        const scale = frame.current.clientWidth / layout.width;
        if (!scale) return;
        const viewport = pdfPage.getViewport({ scale });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.current.width = Math.ceil(viewport.width * pixelRatio);
        canvas.current.height = Math.ceil(viewport.height * pixelRatio);
        render = pdfPage.render({ canvas: canvas.current, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
        await render.promise;
        if (disposed || current !== revision) return;
        if (translation && canvas.current) {
          const context = canvas.current.getContext('2d');
          const colors: Record<string, string> = {};
          if (context) for (const block of layout.blocks) {
            const samples = [[block.x + 1, block.y], [block.x + block.width - 1, block.y], [block.x, block.y + block.height - 1]].map(([x, y]) => {
              const pixel = context.getImageData(Math.max(0, Math.min(canvas.current!.width - 1, Math.floor(x * scale * pixelRatio))), Math.max(0, Math.min(canvas.current!.height - 1, Math.floor(y * scale * pixelRatio))), 1, 1).data;
              return { color: `rgb(${pixel[0]},${pixel[1]},${pixel[2]})`, brightness: pixel[0] + pixel[1] + pixel[2] };
            });
            colors[block.id] = samples.sort((a, b) => b.brightness - a.brightness)[0].color;
          }
          setBackgrounds(colors);
        }
        if (!translation && textContainer.current) {
          textContainer.current.replaceChildren();
          textContainer.current.style.setProperty('--scale-factor', String(scale));
          textContainer.current.style.setProperty('--total-scale-factor', String(scale));
          const content = await pdfPage.getTextContent();
          if (disposed || current !== revision || !textContainer.current) return;
          layer = new TextLayer({ textContentSource: content, container: textContainer.current, viewport });
          await layer.render();
          if (disposed || current !== revision) return;
          /** 每个透明文字项按句子边界拆分，字体位置仍由 PDF.js 管理。 */
          const pieces = new Map<number, { start: number; end: number; id: string }[]>();
          for (const block of layout.blocks) for (const sentence of block.sentences) for (const fragment of sentence.fragments) {
            const currentPieces = pieces.get(fragment.item) || [];
            currentPieces.push({ ...fragment, id: sentence.id }); pieces.set(fragment.item, currentPieces);
          }
          layer.textDivs.forEach((div, index) => {
            const ranges = pieces.get(index)?.sort((a, b) => a.start - b.start);
            if (!ranges) return;
            const original = div.textContent || '';
            div.replaceChildren();
            let offset = 0;
            for (const range of ranges) {
              if (range.start > offset) div.append(original.slice(offset, range.start));
              const fragment = window.document.createElement('span');
              fragment.dataset.anchorId = range.id;
              fragment.className = 'pdf-anchor-fragment';
              fragment.textContent = original.slice(range.start, range.end);
              div.append(fragment); offset = range.end;
            }
            if (offset < original.length) div.append(original.slice(offset));
          });
          setRendered(value => value + 1);
        }
        if (!disposed && current === revision) setLoading(false);
      }).catch(reason => {
        if (!disposed && current === revision && reason.name !== 'RenderingCancelledException' && reason.name !== 'AbortException') { setError('此页暂时无法渲染，可切换段落精读。'); setLoading(false); }
      });
    };
    const observer = new ResizeObserver(draw);
    observer.observe(frame.current);
    return () => { disposed = true; revision++; observer.disconnect(); render?.cancel(); layer?.cancel(); };
  }, [document, page, layout, translation]);
  useEffect(() => {
    textContainer.current?.querySelectorAll<HTMLElement>('[data-anchor-id]').forEach(element => element.classList.toggle('is-anchored', activeIds.includes(element.dataset.anchorId || '')));
  }, [activeIds, rendered]);
  return <div ref={frame} className="pdf-page" style={{ aspectRatio: `${layout.width} / ${layout.height}` }}>
    <canvas ref={canvas} aria-label={`${translation ? '译文保留图表底图' : '论文原始 PDF'}第 ${page} 页`} style={{ visibility: loading ? 'hidden' : 'visible' }} />
    {!translation && <div className="textLayer" ref={textContainer} />}
    {translation && !loading && !error && <div className="pdf-translation-layer">{layout.blocks.map(block => <TranslatedBlock key={block.id} block={block} layout={layout} translation={translation} activeIds={activeIds} onExpand={onExpand} background={backgrounds[block.id]} />)}</div>}
    {loading && <div className="pdf-loading" role="status">正在绘制页面…</div>}
    {error && <p className="pdf-error" role="alert">{error}</p>}
  </div>;
}
