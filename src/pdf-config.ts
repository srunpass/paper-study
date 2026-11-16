/** PDF.js 的字体和图像解码资源全部从本机加载。 */
export const pdfOptions = {
  /** 标准 PDF 字体目录。 */
  standardFontDataUrl: '/pdf-assets/standard_fonts/',
  /** 东亚字符映射目录。 */
  cMapUrl: '/pdf-assets/cmaps/',
  /** 使用 PDF.js 提供的压缩字符映射。 */
  cMapPacked: true,
  /** 图像格式解码模块目录。 */
  wasmUrl: '/pdf-assets/wasm/',
};
