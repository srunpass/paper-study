import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, ChevronLeft, ChevronRight, Languages, Link2, Maximize2, Sparkles, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PdfPage } from './PdfPage';
import { layoutSource, type PageLayout, type ReadingBlock } from './layout';
import type { Paper } from './types';

/** 阅读区域独立管理双向句子定位，避免滚动整个应用。 */
interface ReaderProps {
  /** 当前论文。 */ paper: Paper;
  /** 当前页结构。 */ layout: PageLayout;
  /** 原始版式或段落精读。 */ view: 'layout' | 'flow' | 'original';
  /** 页面放大比例。 */ zoom: number;
  /** AI 请求进行中。 */ busy: boolean;
  /** 父层的选段，清空时取消高亮。 */ selection: string;
  /** 将选文交给提问和笔记。 */ onSelection: (text: string) => void;
  /** 请求按句重新翻译本页。 */ onTranslate: () => void;
  /** 切换阅读视图。 */ onView: (view: 'layout' | 'flow' | 'original') => void;
}

/** 保留段落、标题和公式类别，句子边界提供双向导航。 */
function FlowBlock({ block, translated, activeIds, segments }: {
  /** 结构化段落。 */ block: ReadingBlock;
  /** 当前是否显示中文。 */ translated: boolean;
  /** 选中句子的 ID。 */ activeIds: string[];
  /** 对应的译文映射。 */ segments?: Record<string, string>;
}) {
  const Tag = block.kind === 'heading' ? 'h2' : 'p';
  return <Tag className={`flow-block block-${block.kind}`}>
    {block.sentences.map(sentence => <span className={`sentence ${activeIds.includes(sentence.id) ? 'is-anchored' : ''}`} data-anchor-id={sentence.id} tabIndex={0} key={sentence.id}>
      {translated ? segments?.[sentence.id] : sentence.text.replace(/^#{1,6}\s/, '')}{!translated && ' '}
    </span>)}
  </Tag>;
}

/** 原版画布、双栏精读以及原文/译文共享的定位卡片。 */
export function BilingualReader({ paper, layout, view, zoom, busy, selection, onSelection, onTranslate, onView }: ReaderProps) {
  /** 当前选中或点击的一个/多个完整句子。 */
  const [activeIds, setActiveIds] = useState<string[]>([]);
  /** 触发定位的一侧，用于只滚动另一侧。 */
  const [side, setSide] = useState<'source' | 'translation'>('source');
  /** 句子定位发生次数，相同句子可重复触发定位。 */
  const [navigation, setNavigation] = useState(0);
  /** 左右独立滚动容器。 */
  const sourcePane = useRef<HTMLElement>(null);
  const translationPane = useRef<HTMLElement>(null);
  /** 视图或缩放变更时两侧一起回到当前锚点，普通选句只移动另一侧。 */
  const previousView = useRef({ view, zoom });
  /** 阅读顺序下全部句子。 */
  const sentences = layout.blocks.flatMap(block => block.sentences);
  /** 只有原文签名完全匹配时才启用对应关系。 */
  const saved = paper.alignedTranslations?.[paper.page];
  const aligned = saved?.source === layoutSource(layout) ? saved : undefined;
  const legacy = paper.translations[paper.page];
  const positioned = !!paper.pdf && layout.positioned && view !== 'flow';
  const selected = sentences.filter(sentence => activeIds.includes(sentence.id));
  useEffect(() => { if (!selection) setActiveIds([]); }, [selection]);
  useEffect(() => {
    const changedView = previousView.current.view !== view || previousView.current.zoom !== zoom;
    previousView.current = { view, zoom };
    if (!activeIds.length) return;
    const panes = changedView ? [sourcePane.current, translationPane.current] : [side === 'source' ? translationPane.current : sourcePane.current];
    const observers: MutationObserver[] = [];
    for (const pane of panes) {
      if (!pane) continue;
      /** 切换视图时 PDF 文字层异步出现，只等待本次目标锚点。 */
      const scrollToAnchor = () => {
        const target = pane.querySelector<HTMLElement>(`[data-anchor-id="${activeIds[0]}"]`);
        if (!target) return false;
        const frame = pane.getBoundingClientRect();
        const bounds = target.getBoundingClientRect();
        const origin = side === 'source' ? sourcePane.current : translationPane.current;
        const originTarget = origin?.querySelector<HTMLElement>(`[data-anchor-id="${activeIds[0]}"]`);
        const offset = !changedView && origin && originTarget ? Math.max(48, Math.min(frame.height - 70, originTarget.getBoundingClientRect().top - origin.getBoundingClientRect().top)) : frame.height * .3;
        pane.scrollTo({ top: Math.max(0, pane.scrollTop + bounds.top - frame.top - offset), left: Math.max(0, pane.scrollLeft + bounds.left - frame.left - frame.width * .25), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        return true;
      };
      scrollToAnchor();
      const observer = new MutationObserver(scrollToAnchor);
      observer.observe(pane, { childList: true, subtree: true });
      observers.push(observer);
    }
    return () => observers.forEach(observer => observer.disconnect());
  }, [navigation, view, zoom, activeIds, side]);

  /** 以原文 ID 定位，原文数据和模型译文从不按字符比例猜配。 */
  function anchor(ids: string[], origin: 'source' | 'translation', text?: string) {
    setActiveIds(ids); setSide(origin); setNavigation(value => value + 1);
    const sourceText = sentences.filter(sentence => ids.includes(sentence.id)).map(sentence => origin === 'translation' && aligned ? aligned.segments[sentence.id] : sentence.text).join(' ');
    onSelection((text || sourceText).slice(0, 8000));
  }

  /** 鼠标拖选、触屏选句及键盘选区共用同一对应关系。 */
  function capture(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, origin: 'source' | 'translation') {
    const native = window.getSelection();
    const container = event.currentTarget;
    if (native && !native.isCollapsed && native.rangeCount && container.contains(native.anchorNode) && container.contains(native.focusNode)) {
      const range = native.getRangeAt(0);
      const ids = [...new Set([...container.querySelectorAll<HTMLElement>('[data-anchor-id]')].filter(element => range.intersectsNode(element)).map(element => element.dataset.anchorId!))];
      if (ids.length) anchor(ids, origin, native.toString().trim());
      else if (native.toString().trim()) { setActiveIds([]); onSelection(native.toString().trim().slice(0, 8000)); }
      return;
    }
    if ('key' in event && !['Enter', ' '].includes(event.key)) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-anchor-id]');
    if (target?.dataset.anchorId) anchor([target.dataset.anchorId], origin);
  }

  /** 内容放不下时切换精读，并在下一帧定位同一段落。 */
  function expand(id: string) {
    onView('flow'); anchor([id], 'source');
  }

  /** 上下句导航沿真实原文顺序移动。 */
  function step(delta: number) {
    const index = sentences.findIndex(sentence => sentence.id === activeIds[0]);
    const next = sentences[index + delta];
    if (next) anchor([next.id], side);
  }

  return <div className="reader-body" style={{ '--reader-zoom': zoom / 100 } as CSSProperties}>
    <div className={`reader-columns ${view === 'original' ? 'original-only' : ''}`}>
      <section className="reader-pane" ref={sourcePane} aria-label="英文原文" onMouseUp={event => capture(event, 'source')} onKeyUp={event => capture(event, 'source')}>
        <div className="column-heading"><span><b>EN</b> 英文原文</span><small>{positioned ? '原始 PDF · 可直接选句' : '保留段落结构'}</small></div>
        <div className={`page-content ${positioned ? 'positioned' : 'flow-content'}`} style={{ width: `${zoom}%` }}>
          {positioned ? <PdfPage blob={paper.pdf!} page={paper.page} layout={layout} activeIds={activeIds} onExpand={expand} /> : <article className="flow-page source-text">{layout.blocks.map(block => <FlowBlock key={block.id} block={block} translated={false} activeIds={activeIds} />)}{!sentences.length && <p className="scan-notice">此页没有可提取文字。扫描件需要先做 OCR。</p>}</article>}
        </div>
      </section>
      {view !== 'original' && <section className="reader-pane" ref={translationPane} aria-label="中文译文" onMouseUp={event => capture(event, 'translation')} onKeyUp={event => capture(event, 'translation')}>
        <div className="column-heading"><span><b>中</b> 中文译文</span><small>{aligned ? <><Check size={12} />逐句对应 · 已保存</> : legacy ? '旧版译文已保留' : '等待翻译'}</small></div>
        {aligned ? <div className={`page-content ${positioned ? 'positioned' : 'flow-content'}`} style={{ width: `${zoom}%` }}>{positioned ? <PdfPage blob={paper.pdf!} page={paper.page} layout={layout} translation={aligned} activeIds={activeIds} onExpand={expand} /> : <article className="flow-page translation">{layout.blocks.map(block => <FlowBlock key={block.id} block={block} translated activeIds={activeIds} segments={aligned.segments} />)}</article>}</div>
          : legacy ? <div className="legacy-translation"><div className="upgrade-translation"><Link2 size={17} /><p>这页是旧版整页翻译。升级后可保留版式、选句双向定位。</p><button disabled={busy} onClick={onTranslate}>升级为逐句对照</button></div><article className="markdown flow-page translation"><Markdown remarkPlugins={[remarkGfm]}>{legacy}</Markdown></article></div>
          : <div className="translation-empty"><div className="translation-mark"><Languages size={30} strokeWidth={1.4} /></div><span className="empty-eyebrow">READ ACROSS LANGUAGES</span><h2>同一篇论文，<br />用熟悉的语言读懂。</h2><p>保留段落与页面结构。选中一句，<br />原文与译文同步定位。</p><button className="primary-button" disabled={busy || !sentences.length} onClick={onTranslate}><Sparkles size={15} />{busy ? '正在处理…' : '翻译这一页'}</button><small>使用你自己的 Codex 账号</small></div>}
      </section>}
    </div>
    {selected.length > 0 && <section className="anchor-dock" aria-label="句子对应" aria-live="polite"><div className="anchor-dock-heading"><span><Link2 size={15} />{aligned ? `已定位 ${selected.length} 句对应内容` : '原文选句 · 翻译后可双向定位'}</span><div><button aria-label="定位上一句" disabled={sentences[0]?.id === activeIds[0]} onClick={() => step(-1)}><ChevronLeft size={15} /></button><button aria-label="定位下一句" disabled={sentences.at(-1)?.id === activeIds[0]} onClick={() => step(1)}><ChevronRight size={15} /></button><button aria-label="清除句子定位" onClick={() => { setActiveIds([]); onSelection(''); window.getSelection()?.removeAllRanges(); }}><X size={15} /></button></div></div><div className="anchor-pair"><p><b>EN</b>{selected.map(sentence => sentence.text).join(' ')}</p><p><b>中</b>{aligned ? selected.map(sentence => aligned.segments[sentence.id]).join('') : '本页生成逐句翻译后，这里会显示对应译文。'}</p></div>{positioned && <button className="dock-expand" onClick={() => expand(activeIds[0])}><Maximize2 size={12} />在段落精读中查看</button>}</section>}
  </div>;
}
