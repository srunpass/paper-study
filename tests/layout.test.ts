import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionedLayout, textLayout, parseAlignedTranslation, layoutSource, sentenceRanges, type TextRun } from '../src/layout.ts';
import { assistSchema } from '../server/ai.ts';

/** 创建坐标可预测的 PDF 文本项，用于验证跨栏及乱序绘制。 */
function run(index: number, text: string, x: number, y: number, width = 210, fontSize = 12): TextRun {
  return { index, text, x, y, width, height: fontSize, fontSize, bold: false };
}

test('双栏 PDF 按先左后右恢复顺序，保留跨栏标题和句子字符位置', () => {
  const layout = positionedLayout([
    run(0, 'Right starts. ', 320, 100), run(1, 'Research title', 50, 30, 480, 20),
    run(2, 'Left starts. ', 50, 100), run(3, 'More left. ', 50, 116), run(4, 'Last left.', 50, 132),
    run(5, 'More right. ', 320, 116), run(6, 'Last right.', 320, 132),
  ], 600, 800, 2);
  assert.equal(layout.blocks[0].kind, 'heading');
  const sentences = layout.blocks.flatMap(block => block.sentences);
  assert.deepEqual(sentences.map(sentence => sentence.text), ['Research title', 'Left starts.', 'More left.', 'Last left.', 'Right starts.', 'More right.', 'Last right.']);
  assert.equal(sentences[1].fragments[0].item, 2);
  assert.equal(sentences[1].id.startsWith('p2-'), true);
});

test('跨 PDF 文本项和断行的句子保存范围，换行连字符正确恢复', () => {
  const layout = positionedLayout([run(0, 'We use atten-', 40, 100, 100), run(1, 'tion to learn. Next idea.', 40, 115, 180)], 600, 800, 1);
  assert.equal(layout.blocks[0].sentences[0].text, 'We use attention to learn.');
  assert.equal(layout.blocks[0].sentences[0].fragments.length, 2);
  assert.equal(layout.blocks[0].sentences[1].text, 'Next idea.');
  assert.ok(layout.blocks[0].sentences[1].fragments[0].start > 0);
});

test('双栏之后的新章节不会提前插到右栏正文前', () => {
  const layout = positionedLayout([
    run(0, 'Left one.', 40, 100), run(1, 'Left two.', 40, 116), run(2, 'Left three.', 40, 132),
    run(3, 'Right one.', 320, 100), run(4, 'Right two.', 320, 116), run(5, 'Right three.', 320, 132),
    run(6, 'Next section', 40, 230, 140, 18),
  ], 600, 800, 1);
  assert.equal(layout.blocks.at(-1)?.sentences[0].text, 'Next section');
});

test('标题、段落和独立公式保持结构，学术缩写不误分', () => {
  const layout = textLayout('## Method\n\nSee Fig. 2 for details. Another sentence.\n\nQ = K + V', 1);
  assert.deepEqual(layout.blocks.map(block => block.kind), ['heading', 'paragraph', 'formula']);
  assert.equal(layout.blocks[1].sentences.length, 2);
  assert.equal(sentenceRanges('Smith et al. describe this. Next.').length, 2);
});

test('翻译按 ID 对应，允许结果乱序，拒绝遗漏、重复和伪造锚点', () => {
  const layout = textLayout('First sentence. Second sentence.', 1);
  const sentences = layout.blocks[0].sentences;
  const translations = sentences.map((sentence, index) => ({ id: sentence.id, text: `译文${index}` }));
  const parsed = parseAlignedTranslation(JSON.stringify({ translations: [...translations].reverse() }), layout);
  assert.equal(parsed.segments[sentences[0].id], '译文0');
  assert.equal(parsed.source, layoutSource(layout));
  for (const rows of [translations.slice(1), [translations[0], translations[0]], [translations[0], { id: '__proto__', text: '错配' }]]) assert.throws(() => parseAlignedTranslation(JSON.stringify({ translations: rows }), layout));
  assert.throws(() => parseAlignedTranslation('普通译文', layout));
  assert.notEqual(layoutSource(textLayout('Changed sentence.', 1)), parsed.source);
});

test('结构化翻译的总文本量和重复 ID 受服务端约束', () => {
  const base = { mode: 'translate', title: 'Test', question: '翻译', context: '', history: [], web: false };
  const sentence = { id: 'p1-b0-s0', text: 'Sentence.' };
  assert.equal(assistSchema.safeParse({ ...base, sentences: [sentence] }).success, true);
  assert.equal(assistSchema.safeParse({ ...base, sentences: [sentence, sentence] }).success, false);
  assert.equal(assistSchema.safeParse({ ...base, mode: 'chat', sentences: [sentence] }).success, false);
  assert.equal(assistSchema.safeParse({ ...base, sentences: [{ ...sentence, text: 'x'.repeat(40000) }, { id: 'p1-b0-s1', text: 'x'.repeat(40000) }] }).success, false);
});
