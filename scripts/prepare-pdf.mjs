/** 将 PDF 字体、字符映射和图像解码文件放到本机静态目录。 */
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/pdf-assets/', root), { recursive: true });
for (const directory of ['standard_fonts', 'cmaps', 'wasm']) {
  await cp(fileURLToPath(new URL(`node_modules/pdfjs-dist/${directory}`, root)), fileURLToPath(new URL(`public/pdf-assets/${directory}`, root)), { recursive: true });
}
