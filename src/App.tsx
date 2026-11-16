import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowRight, BookOpen, ChevronLeft, ChevronRight, CircleHelp, FileText, Globe2, GraduationCap, Languages, Library, LoaderCircle, MessageSquare, NotebookPen, PanelLeftClose, PanelLeftOpen, PanelRightClose, Plus, Search, Send, Sparkles, Square, Upload, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { askCodex, getConnection } from './api';
import { demoPaper, loadPapers, notesMarkdown, savePaper } from './storage';
import { importPaper, pageText, readPdfLayout } from './pdf';
import { BilingualReader } from './BilingualReader';
import { textLayout, parseAlignedTranslation, translationText } from './layout';
import type { Connection, Paper } from './types';

/** 论文阅读、翻译和学习工作台。 */
export default function App() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [activeId, setActiveId] = useState('');
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [filter, setFilter] = useState('');
  /** 原版对照、段落精读和单独原文。 */
  const [mode, setMode] = useState<'layout' | 'flow' | 'original'>('layout');
  /** 文献库与助手均可收起，把宽度留给论文。 */
  const [libraryOpen, setLibraryOpen] = useState(() => window.innerWidth > 1300);
  /** 提问时自动展开学习助手。 */
  const [studyOpen, setStudyOpen] = useState(false);
  /** 两侧采用同一缩放比例，滚动位置独立。 */
  const [zoom, setZoom] = useState(100);
  /** 旧 PDF 正在补齐原位坐标时避免使用旧文本翻译。 */
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [tab, setTab] = useState<'chat' | 'notes'>('chat');
  const [scope, setScope] = useState<'page' | 'paper'>('page');
  const [question, setQuestion] = useState('');
  const [web, setWeb] = useState(false);
  const [selection, setSelection] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [activity, setActivity] = useState('');
  const [draftAnswer, setDraftAnswer] = useState('');
  const [draftQuestion, setDraftQuestion] = useState('');
  const [toast, setToast] = useState('');
  const [help, setHelp] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const paper = papers.find(item => item.id === activeId);
  const currentText = paper?.pages[(paper?.page || 1) - 1] || '';
  const translation = paper?.translations[String(paper.page)];
  const online = connection?.loggedIn;
  /** 缓存当前结构，避免输入问题时重新绘制整个 PDF。 */
  const layout = useMemo(() => paper?.layouts?.[paper.page] || textLayout(currentText, paper?.page || 1), [paper?.layouts, paper?.page, currentText]);

  useEffect(() => {
    let disposed = false;
    loadPapers().then(async saved => {
      if (!saved.length) { const demo = demoPaper(); await savePaper(demo); saved = [demo]; }
      if (!disposed) { setPapers(saved); setActiveId(saved[0].id); setReady(true); }
    }).catch(() => { if (!disposed) { setToast('无法打开本地数据库，请确认浏览器允许保存站点数据。'); setReady(true); } });
    getConnection().then(setConnection).catch(() => setConnection(null));
    return () => { disposed = true; controller.current?.abort(); };
  }, []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 7000); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [paper?.messages.length, draftAnswer, draftQuestion, tab]);
  useEffect(() => {
    let disposed = false;
    if (!paper?.pdf || paper.layouts?.[paper.page]) { setLayoutLoading(false); return; }
    const target = paper;
    setLayoutLoading(true);
    readPdfLayout(target.pdf!, target.page).then(result => {
      if (!disposed) updatePaper(target.id, current => ({ ...current, layouts: { ...current.layouts, [target.page]: result }, pages: current.pages.map((text, index) => index + 1 === target.page ? pageText(result) : text) }));
    }).catch(() => { if (!disposed) setToast('这页版式暂时无法恢复，仍可使用段落精读；原有学习资料已保留。'); })
      .finally(() => { if (!disposed) setLayoutLoading(false); });
    return () => { disposed = true; };
  }, [paper?.id, paper?.page, paper?.pdf, paper?.layouts]);

  /** 原子更新一篇论文，异步写失败时明确提醒用户。 */
  function updatePaper(id: string, update: (current: Paper) => Paper) {
    setPapers(current => current.map(item => {
      if (item.id !== id) return item;
      const next = update(item);
      void savePaper(next).catch(() => setToast('本地保存失败，可能是空间不足。请及时导出笔记。'));
      return next;
    }));
  }

  /** 选择论文时清理上一份材料的临时输入，避免上下文串联。 */
  function selectPaper(id: string) {
    if (busyRef.current) return;
    setActiveId(id); setSelection(''); setQuestion(''); setNote(''); setDraftAnswer(''); setDraftQuestion('');
  }

  /** 页码仅在合法范围内变更。 */
  function navigate(page: number) {
    if (!paper || page < 1 || page > paper.pages.length) return;
    updatePaper(paper.id, current => ({ ...current, page })); setSelection('');
  }

  /** 导入 PDF 或文本，所有解析都发生在浏览器本机。 */
  async function addFile(file?: File) {
    if (!file || busyRef.current) return;
    busyRef.current = true; setBusy('import'); setActivity('正在打开文档…');
    try {
      const imported = await importPaper(file, setActivity);
      await savePaper(imported);
      setPapers(current => [imported, ...current]); setActiveId(imported.id); setSelection(''); setQuestion(''); setNote(''); setDraftAnswer(''); setDraftQuestion('');
      setMode(imported.pdf && !imported.pages.some(text => text.trim()) ? 'original' : 'layout');
      setToast(imported.pages.some(text => text.trim()) ? '已导入并保存在本机。' : '这是扫描版或图片 PDF。可查看原文；请先 OCR 后再翻译。');
    } catch (error) { setToast(error instanceof Error ? error.message : '导入失败。若文件已加密，请先解密。'); }
    finally { busyRef.current = false; setBusy(''); setActivity(''); if (fileInput.current) fileInput.current.value = ''; }
  }

  /** 翻译指定页或整个文档，完成一页就保存一页，取消后可继续。 */
  async function translate(all = false) {
    if (!paper || busyRef.current || layoutLoading) return;
    const target = paper;
    const pages = all ? target.pages.map((_, index) => index + 1).filter(page => !target.alignedTranslations?.[page] && target.pages[page - 1].trim()) : [target.page];
    if (!pages.length) { setToast('所有可提取文本的页面都已翻译。'); return; }
    if (pages.some(page => target.pages[page - 1].length > 60000)) { setToast('页面文字过长，请拆分文本后翻译。'); return; }
    if (!all && !currentText.trim()) { setToast('此页没有可提取文字，请先进行 OCR。'); return; }
    busyRef.current = true; setBusy('translate'); if (mode === 'original') setMode('layout');
    const abort = new AbortController(); controller.current = abort;
    try {
      for (let index = 0; index < pages.length; index++) {
        if (abort.signal.aborted) break;
        const page = pages[index];
        const label = all ? `全文翻译 ${index + 1}/${pages.length} · 第 ${page} 页` : `正在翻译第 ${page} 页`;
        setActivity(label);
        const structure = target.layouts?.[page] || (target.pdf ? await readPdfLayout(target.pdf, page) : textLayout(target.pages[page - 1], page));
        if (abort.signal.aborted) break;
        const sentences = structure.blocks.flatMap(block => block.sentences.map(sentence => ({ id: sentence.id, text: sentence.text })));
        if (!sentences.length) continue;
        const result = await askCodex({ mode: 'translate', title: target.title, question: '翻译为简体中文', context: '', sentences, history: [], web: false }, abort.signal, event => { if (event.type === 'status') setActivity(label + '…'); });
        const aligned = parseAlignedTranslation(result.text, structure);
        if (!abort.signal.aborted) updatePaper(target.id, current => ({ ...current, pages: current.pages.map((text, index) => index + 1 === page ? pageText(structure) : text), layouts: { ...current.layouts, [page]: structure }, translations: { ...current.translations, [page]: translationText(structure, aligned) }, alignedTranslations: { ...current.alignedTranslations, [page]: aligned } }));
      }
    } catch (error) { if (!abort.signal.aborted) setToast(error instanceof Error ? error.message : '翻译失败，请重试。'); }
    finally { busyRef.current = false; setBusy(''); setActivity(''); controller.current = null; }
  }

  /** 生成带真实页码的上下文，并明确标记截断范围。 */
  function contextFor(target: Paper, fullPaper: boolean): string {
    if (selection) return `[第 ${target.page} 页·用户选段]\n${selection}`;
    const text = fullPaper ? target.pages.map((text, index) => `[第 ${index + 1} 页]\n${text}`).join('\n\n') : `[第 ${target.page} 页]\n${target.pages[target.page - 1]}`;
    return text.length > 60000 ? text.slice(0, 60000) + '\n[上下文已截断，其余内容未提供，回答时须说明范围。]' : text;
  }

  /** 将问题及论文上下文交给 Codex，仅持久化完整成功的对话。 */
  async function ask(prompt = question, fullPaper = scope === 'paper') {
    if (!paper || busyRef.current || !prompt.trim()) return;
    if (!currentText.trim() && !fullPaper && !selection && !web) { setToast('此页没有文字。请切换到有文字的页面，或启用联网查询。'); return; }
    const target = paper;
    busyRef.current = true; setBusy('chat'); setTab('chat'); setStudyOpen(true); setDraftQuestion(prompt); setDraftAnswer(''); setActivity('正在连接 Codex…');
    const abort = new AbortController(); controller.current = abort;
    try {
      const result = await askCodex({ mode: 'chat', title: target.title, question: prompt.trim(), context: contextFor(target, fullPaper), history: target.messages.slice(-8).map(message => ({ role: message.role, content: message.content.slice(0, 12000) })), web }, abort.signal, event => {
        if (event.type === 'status') setActivity(event.text || '正在思考…');
        if (event.type === 'answer') setDraftAnswer(event.text || '');
      });
      if (!abort.signal.aborted) {
        updatePaper(target.id, current => ({ ...current, messages: [...current.messages, { id: crypto.randomUUID(), role: 'user', content: prompt, page: target.page }, { id: crypto.randomUUID(), role: 'assistant', content: result.text, searched: result.searched, page: target.page }] }));
        setQuestion('');
      }
    } catch (error) { if (!abort.signal.aborted) setToast(error instanceof Error ? error.message : '提问失败，请重试。'); }
    finally { busyRef.current = false; setBusy(''); setActivity(''); setDraftAnswer(''); setDraftQuestion(''); controller.current = null; }
  }

  /** 取消当前任务；已经成功保存的翻译保留。 */
  function cancel() { controller.current?.abort(); setActivity('正在停止…'); }

  /** 保存草稿或一段 AI 回答为可导出的页码笔记。 */
  function addNote(text = note, quote = selection, sourcePage = paper?.page) {
    if (!paper || !text.trim()) return;
    updatePaper(paper.id, current => ({ ...current, notes: [{ id: crypto.randomUUID(), page: sourcePage || current.page, text: text.trim(), quote, createdAt: Date.now() }, ...current.notes] }));
    setNote(''); setToast('已保存到学习笔记。');
  }

  /** 以本地 Blob 下载 Markdown 笔记。 */
  function exportNotes() {
    if (!paper) return;
    const url = URL.createObjectURL(new Blob([notesMarkdown(paper)], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = paper.title.replace(/[\\/:*?"<>|]/g, '_') + '-学习笔记.md'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** 渲染 Markdown 并将论文页码引用转成可跳转定位。 */
  function renderMarkdown(text: string) {
    return <Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => href?.startsWith('#page-') ? <button className="page-link" onClick={() => navigate(Number(href.slice(6)))}>{children}</button> : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{text.replace(/\[第\s*(\d+)\s*页\]/g, '[第 $1 页](#page-$1)')}</Markdown>;
  }

  /** 阻止表单刷新并提交学习问题。 */
  function submitQuestion(event: FormEvent) { event.preventDefault(); void ask(); }

  return <div className={`app-shell ${libraryOpen ? 'library-open' : ''} ${studyOpen ? 'study-open' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void addFile(event.dataTransfer.files[0]); }}>
    {!libraryOpen && <nav className="compact-rail" aria-label="阅读工具"><button className="rail-brand" aria-label="展开文献库" onClick={() => setLibraryOpen(true)}><BookOpen size={23} /></button><button aria-label="展开文献库" title="文献库" onClick={() => setLibraryOpen(true)}><Library size={20} /></button><button aria-label="导入论文" title="导入论文" disabled={!!busy} onClick={() => fileInput.current?.click()}><Plus size={21} /></button><button className="rail-help" aria-label="使用与连接设置" onClick={() => setHelp(true)}><CircleHelp size={20} /></button></nav>}
    <input ref={fileInput} className="visually-hidden" type="file" accept=".pdf,.txt,.md" aria-label="选择论文文件" onChange={event => void addFile(event.target.files?.[0])} />
    {libraryOpen && <aside className="library-panel">
      <a className="brand" href="/" aria-label="知页首页"><span className="brand-icon"><BookOpen size={23} strokeWidth={1.7} /></span><span>知页<small>PAPER STUDY</small></span></a>
      <button className="import-button" disabled={!!busy} onClick={() => fileInput.current?.click()}><Plus size={18} />导入论文<span>PDF</span></button>
      <button className="paste-button" disabled={!!busy} onClick={() => setPasteOpen(true)}>或粘贴一段英文开始</button>
      <div className="library-heading"><Library size={15} /><span>我的文献库</span><b>{papers.length}</b></div>
      <label className="library-search"><Search size={15} /><input placeholder="查找论文…" value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <nav className="paper-list" aria-label="论文列表">{papers.filter(item => (item.title + item.filename).toLowerCase().includes(filter.toLowerCase())).map(item => <button key={item.id} className={`paper-card ${item.id === activeId ? 'active' : ''}`} disabled={!!busy} onClick={() => selectPaper(item.id)}>
        <FileText size={17} /><span><strong>{item.title}</strong><small>{item.demo ? '入门示例' : '本机文档'}<i />{item.pages.length} 页</small></span>
      </button>)}{ready && !papers.filter(item => (item.title + item.filename).toLowerCase().includes(filter.toLowerCase())).length && <p className="muted empty-search">没有找到论文</p>}</nav>
      <div className="sidebar-footer"><div className="local-label"><span className="status-dot" />文献与笔记保存在本机</div><button onClick={() => { setHelp(true); void getConnection().then(setConnection).catch(() => setConnection(null)); }}><CircleHelp size={15} />使用与连接设置</button></div>
    </aside>}

    <main className="workspace">
      <header className="workspace-header"><div className="header-title"><button className="icon-button" aria-label={libraryOpen ? '收起文献库' : '展开文献库'} onClick={() => setLibraryOpen(!libraryOpen)}>{libraryOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}</button><span>知页 <i>/</i> 阅读</span></div><div className="header-actions"><div className="connection-badge" title={connection?.version}><span className={`status-dot ${online ? '' : 'offline'}`} />{online ? 'Codex 已连接' : connection ? 'Codex 待登录' : '连接检测中'}</div><button className={`assistant-toggle ${studyOpen ? 'active' : ''}`} aria-expanded={studyOpen} onClick={() => setStudyOpen(!studyOpen)}><Sparkles size={16} />学习助手</button></div></header>
      {!paper ? <div className="loading-workspace"><BookOpen size={40} /><h1>{ready ? '导入你的第一篇论文' : '正在打开你的书桌…'}</h1><p>将 PDF 拖到这里，开始阅读。</p><button className="primary-button" onClick={() => fileInput.current?.click()}>选择论文</button></div> : <>
        <section className="paper-heading"><div><h1 title={paper.title}>{paper.title}</h1><p>{paper.demo ? '教学示例' : paper.filename} <span>·</span> {paper.pages.length} 页 <span>·</span> 已译 {Object.keys(paper.translations).length} 页</p></div><span className="document-label">{paper.pdf ? 'PDF' : 'TEXT'}</span></section>
        <div className="reading-toolbar">
          <div className="view-switch" role="group" aria-label="阅读视图"><button className={mode === 'layout' ? 'selected' : ''} aria-pressed={mode === 'layout'} onClick={() => setMode('layout')}><Languages size={15} />{paper.pdf ? '版式对照' : '双语对照'}</button><button className={mode === 'flow' ? 'selected' : ''} aria-pressed={mode === 'flow'} onClick={() => setMode('flow')}><BookOpen size={15} />段落精读</button><button className={mode === 'original' ? 'selected' : ''} aria-pressed={mode === 'original'} onClick={() => setMode('original')}>仅原文</button></div>
          <div className="reader-controls"><label className="zoom-control"><span>缩放</span><select aria-label="阅读缩放" value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[100, 125, 150, 200].map(value => <option value={value} key={value}>{value}%</option>)}</select></label><div className="page-navigation"><button aria-label="上一页" disabled={paper.page <= 1} onClick={() => navigate(paper.page - 1)}><ChevronLeft size={17} /></button><select aria-label="跳转页码" value={paper.page} onChange={event => navigate(Number(event.target.value))}>{paper.pages.map((_, index) => <option key={index} value={index + 1}>{index + 1} / {paper.pages.length}</option>)}</select><button aria-label="下一页" disabled={paper.page >= paper.pages.length} onClick={() => navigate(paper.page + 1)}><ChevronRight size={17} /></button></div></div>
        </div>
        {layoutLoading ? <div className="layout-loading" role="status"><LoaderCircle className="spin" size={22} /><p>正在恢复这页的原始版式…</p><small>原有译文和学习记录会保留</small></div> : <BilingualReader key={`${paper.id}-${paper.page}`} paper={paper} layout={layout} view={mode} zoom={zoom} busy={!!busy} selection={selection} onSelection={setSelection} onTranslate={() => void translate()} onView={setMode} />}
        <footer className="reading-footer"><div className="footer-hint">{selection ? <><span>已选 {selection.length} 字</span><button disabled={!!busy} onClick={() => void ask('请结合论文上下文，用通俗的例子解释这段选文的核心含义和关键术语。')}><Sparkles size={14} />讲解选句</button><button onClick={() => { setTab('notes'); setStudyOpen(true); setNote(''); }}><NotebookPen size={14} />记笔记</button></> : <span>点击或选中一句话，定位对应原文与译文</span>}</div><div><button disabled={!!busy || layoutLoading || !currentText.trim()} onClick={() => void translate()}><Languages size={14} />{translation ? '重新翻译本页' : '翻译本页'}</button><button disabled={!!busy || layoutLoading} title="逐页生成逐句对照，跳过已有新版译文；可随时停止" onClick={() => void translate(true)}>翻译全文 <ArrowRight size={14} /></button></div></footer>
      </>}
    </main>

    {studyOpen && <aside className="study-panel">
      <div className="study-title"><span className="tutor-symbol"><Sparkles size={19} /></span><div><strong>学习助手</strong><small>与你一起读懂论文</small></div><button className="close-study icon-button" aria-label="收起学习助手" onClick={() => setStudyOpen(false)}><PanelRightClose size={18} /></button></div>
      <div className="study-tabs" role="tablist" aria-label="学习面板"><button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}><MessageSquare size={15} />问 Codex</button><button role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}><NotebookPen size={15} />学习笔记{paper && paper.notes.length > 0 && <span>{paper.notes.length}</span>}</button></div>
      {tab === 'chat' ? <><div className="chat-scroll">
        {!paper?.messages.length && !draftQuestion && <div className="tutor-welcome"><div className="welcome-line">好问题，是读懂的开始。</div><p>我可以帮你拆解论文、解释术语，<br />也可以陪你检验自己是否真的理解。</p><div className="quick-prompts">
          <button disabled={!!busy || !paper} onClick={() => void ask('请根据提供的内容，介绍这篇文档要解决的问题、核心方法和结论。请指出这是正式论文还是教学示例，并说明阅读范围。', true)}><BookOpen size={17} /><span><strong>先读懂大意</strong><small>问题 · 方法 · 结论</small></span><ArrowRight size={15} /></button>
          <button disabled={!!busy || !paper} onClick={() => void ask('请提取当前内容中最重要的 5 个英文术语，提供中文含义、直觉解释和一个简单例子。')}><Languages size={17} /><span><strong>拆解关键术语</strong><small>从陌生单词到清晰概念</small></span><ArrowRight size={15} /></button>
          <button disabled={!!busy || !paper} onClick={() => void ask('根据当前内容提出 3 个循序渐进的理解检查问题，暂时不要给答案。等我回答后再纠正并讲解。')}><GraduationCap size={18} /><span><strong>考考我是否读懂</strong><small>用三个问题检验理解</small></span><ArrowRight size={15} /></button>
        </div><div className="reading-tip"><span>一个小建议</span>读完一段，用自己的话解释一遍。说不清的地方，就是下一次提问的起点。</div></div>}
        {paper?.messages.map(message => <div key={message.id} className={`chat-message ${message.role}`}><div className="message-label">{message.role === 'user' ? '你' : <><Sparkles size={13} />Codex{message.searched && <span className="web-tag"><Globe2 size={11} />已联网</span>}</>}</div><div className="markdown">{renderMarkdown(message.content)}</div>{message.role === 'assistant' && <button className="save-answer" onClick={() => addNote(message.content, '', message.page)}><NotebookPen size={12} />存为笔记</button>}</div>)}
        {draftQuestion && <div className="chat-message user"><div className="message-label">你</div><p>{draftQuestion}</p></div>}
        {busy === 'chat' && <div className="chat-message assistant"><div className="message-label"><Sparkles size={13} />Codex</div>{draftAnswer ? <div className="markdown">{renderMarkdown(draftAnswer)}</div> : <div className="thinking"><span /><span /><span /><small>{activity}</small></div>}</div>}
        <div ref={chatEnd} />
      </div><form className="question-box" onSubmit={submitQuestion}>
        {selection && <div className="context-chip"><span>选段：{selection.slice(0, 52)}{selection.length > 52 ? '…' : ''}</span><button type="button" aria-label="取消选段上下文" onClick={() => setSelection('')}><X size={13} /></button></div>}
        <div className="question-options"><select aria-label="提问上下文范围" value={scope} disabled={!!selection || !!busy} onChange={event => setScope(event.target.value as 'page' | 'paper')}><option value="page">当前页上下文</option><option value="paper">全文上下文（最多 6 万字）</option></select><button type="button" className={`web-toggle ${web ? 'enabled' : ''}`} disabled={!!busy} aria-pressed={web} onClick={() => setWeb(!web)}><Globe2 size={14} />联网{web ? '开' : '关'}</button></div>
        <textarea aria-label="向 Codex 提问" placeholder={web ? '查询相关论文、研究进展或背景知识…' : '这段在说什么？为什么这样设计？'} value={question} maxLength={8000} disabled={!!busy} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void ask(); } }} />
        <div className="question-bottom"><span>⌘ / Ctrl + Enter 发送</span>{busy && busy !== 'import' ? <button type="button" className="send-button stop" aria-label="停止生成" onClick={cancel}><Square size={15} /></button> : <button type="submit" className="send-button" aria-label="发送问题" disabled={!!busy || !question.trim() || !paper}><Send size={17} /></button>}</div>
        <p className="privacy-note">提问时将相关文本发送给 Codex。重要结论请核对原文。</p>
      </form></> : <div className="notes-scroll"><div className="notes-top"><h3>把理解留下来</h3><button aria-label="导出学习笔记" title="导出 Markdown 笔记与对话" onClick={exportNotes} disabled={!paper}><ArrowDownToLine size={17} /></button></div>{selection && <blockquote className="note-quote">{selection}</blockquote>}<textarea className="note-input" placeholder="用自己的话，记下一个想法…" aria-label="笔记内容" value={note} onChange={event => setNote(event.target.value)} maxLength={30000} /><div className="note-actions"><span>关联第 {paper?.page || 1} 页</span><button className="primary-button" disabled={!note.trim() || !paper} onClick={() => addNote()}><Plus size={14} />保存笔记</button></div>{paper?.notes.map(item => <article className="note-card" key={item.id}><button className="note-page" onClick={() => navigate(item.page)}>第 {item.page} 页 <ArrowRight size={12} /></button><time>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</time>{item.quote && <blockquote>{item.quote}</blockquote>}<div className="markdown">{renderMarkdown(item.text)}</div></article>)}{!paper?.notes.length && <div className="notes-empty"><NotebookPen size={32} strokeWidth={1.2} /><p>一个疑问、一段解释、一次顿悟。<br />它们都值得记下来。</p></div>}</div>}
    </aside>}
    {busy && <div className="activity-bar" role="status"><LoaderCircle className="spin" size={15} /><span>{activity || '正在处理…'}</span>{busy !== 'import' && <button onClick={cancel}>停止</button>}</div>}
    {toast && <div className="toast" role="alert"><span>{toast}</span><button aria-label="关闭提示" onClick={() => setToast('')}><X size={15} /></button></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}><button className="modal-close" aria-label="关闭帮助" onClick={() => setHelp(false)}><X size={20} /></button><span className="eyebrow">YOUR LOCAL READING DESK</span><h2 id="help-title">让知页陪你读懂论文</h2><p>导入 PDF，点击「翻译这一页」，或选中一段文字让 Codex 解释。右侧可以连续追问、联网查资料，也可以保存笔记。</p><div className="help-status"><span className={`status-dot ${online ? '' : 'offline'}`} /><strong>{online ? 'Codex 已登录，可以开始' : 'Codex 尚未连接'}</strong><small>{connection?.version}</small></div><p>需要重新登录时，在终端运行：</p><pre>codex login</pre><h3>你的数据在哪里？</h3><p>论文原件、译文、对话和笔记保存在这个浏览器的本机数据库中。请固定使用 <strong>127.0.0.1:4317</strong>；不同浏览器或地址的资料不会共享。清理站点数据会删除资料，可在笔记页导出学习记录。</p><h3>第一版支持范围</h3><p>PDF / TXT / Markdown，单文件最大 30 MB，PDF 最多 300 页。扫描件需先 OCR。版式对照保留 PDF 原图及栏位，译文沿原段落排版；句子可以双向定位。较长译文可展开到段落精读。扫描件、竖排文字和复杂公式仍以原始页面为准。</p><p>翻译和提问使用你的 Codex 账户及其可用额度。全文翻译逐页处理，停止后可继续。AI 只接收所选上下文；全文问答最多发送前 6 万字符。</p><button className="primary-button" onClick={() => { void getConnection().then(value => { setConnection(value); setToast(value.loggedIn ? '已重新连接 Codex。' : '尚未登录，请运行 codex login。'); }).catch(() => setToast('本机服务未启动，请重新运行启动脚本。')); }}>重新检测连接</button></section></div>}
    {pasteOpen && <div className="modal-backdrop" onClick={() => setPasteOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="paste-title" onClick={event => event.stopPropagation()}><button className="modal-close" aria-label="关闭文本导入" onClick={() => setPasteOpen(false)}><X size={20} /></button><span className="eyebrow">START WITH A PARAGRAPH</span><h2 id="paste-title">从一段英文开始</h2><p>粘贴论文摘要、章节或任何想读懂的内容。</p><textarea className="paste-input" aria-label="待导入的英文文本" placeholder="Paste your abstract or paper text here…" value={pasted} maxLength={200000} onChange={event => setPasted(event.target.value)} /><button className="primary-button" disabled={!pasted.trim() || !!busy} onClick={() => { const title = pasted.trim().split('\n')[0].slice(0, 80); void addFile(new File([pasted], title.replace(/[\\/:*?"<>|]/g, '_') + '.txt', { type: 'text/plain' })); setPasteOpen(false); setPasted(''); }}><Upload size={16} />导入并开始阅读</button></section></div>}
  </div>;
}
