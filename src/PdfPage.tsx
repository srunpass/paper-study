import { useEffect, useRef, useState } from 'react';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import './pdf';
import { pdfOptions } from './pdf-config';

/** 在本地绘制原始论文，保留公式和多栏排版。 */
export function PdfPage({ blob, page }: { /** 原始 PDF。 */ blob: Blob; /** 当前页。 */ page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    let task: ReturnType<typeof getDocument> | undefined;
    setDocument(null); setError(''); setLoading(true);
    blob.arrayBuffer().then(data => {
      if (disposed) return;
      task = getDocument({ ...pdfOptions, data });
      return task.promise.then(doc => { if (!disposed) setDocument(doc); });
    }).catch(() => { if (!disposed) { setError('原始 PDF 无法显示，请使用对照阅读或重新导入。'); setLoading(false); } });
    return () => { disposed = true; void task?.destroy(); };
  }, [blob]);
  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setLoading(true); setError('');
    document.getPage(page).then(pdfPage => {
      if (cancelled || !canvas.current) return;
      const viewport = pdfPage.getViewport({ scale: 1.65 });
      canvas.current.width = viewport.width; canvas.current.height = viewport.height;
      render = pdfPage.render({ canvas: canvas.current, viewport });
      return render.promise;
    }).then(() => { if (!cancelled) setLoading(false); }).catch(error => {
      if (!cancelled && error.name !== 'RenderingCancelledException') { setError('此页暂时无法渲染。'); setLoading(false); }
    });
    return () => { cancelled = true; render?.cancel(); };
  }, [document, page]);
  return <div className="pdf-page">{loading && <div className="pdf-loading">正在绘制原始页面…</div>}{error && <p role="alert">{error}</p>}<canvas ref={canvas} aria-label={`论文原始 PDF 第 ${page} 页`} /></div>;
}
