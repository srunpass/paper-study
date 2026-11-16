import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionedLayout, textLayout, parseAlignedTranslation, layoutSource, sentenceRanges, remapTranslation, type TextRun } from '../src/layout.ts';
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

test('同字号的摘要与章节标题独立成块，编号和标题保持同一个锚点', () => {
  const layout = positionedLayout([
    run(0, 'Abstract', 79, 373, 34, 9),
    run(1, 'We study a planning problem with', 88, 389, 350, 9),
    run(2, 'uncertain observations. A second sentence.', 79, 400, 359, 9),
    run(3, 'Keywords: Planning; Uncertainty', 79, 430, 230, 8),
    run(4, '1. Introduction', 79, 480, 80, 10),
    run(5, 'The agent observes its environment.', 89, 504, 349, 10),
  ], 543, 743, 1);
  assert.equal(layout.blocks[0].kind, 'heading');
  assert.deepEqual(layout.blocks[0].sentences.map(s => s.text), ['Abstract']);
  assert.equal(layout.blocks[1].textIndent, 9);
  assert.equal(layout.blocks[1].lineHeight, 11 / 9);
  assert.equal(layout.blocks[2].kind, 'keywords');
  assert.deepEqual(layout.blocks[3].sentences.map(s => s.text), ['1. Introduction']);
  assert.equal(layout.blocks[3].kind, 'heading');
});

test('上标脚注各自成段，跨行脚注保留悬挂缩进', () => {
  const layout = positionedLayout([
    run(0, 'A normal body paragraph.', 79, 400, 359, 10),
    { ...run(1, '*', 85, 609, 4, 6.8), baseline: 609 },
    { ...run(2, 'Corresponding author.', 91, 606, 150, 8), baseline: 612 },
    { ...run(3, '1', 85, 615, 4, 6.8), baseline: 620 },
    { ...run(4, 'Supported by a research grant that', 91, 617, 230, 8), baseline: 623 },
    { ...run(5, 'continues on the next line.', 91, 627, 180, 8), baseline: 633 },
    { ...run(6, '2', 85, 635, 4, 6.8), baseline: 640 },
    { ...run(7, 'Supported by another grant.', 91, 637, 220, 8), baseline: 643 },
  ], 543, 743, 1);
  const notes = layout.blocks.filter(block => block.kind === 'footnote');
  assert.equal(notes.length, 3);
  assert.equal(notes[0].sentences[0].text, '* Corresponding author.');
  assert.match(notes[1].sentences[0].text, /^1 Supported.*continues/);
  assert.equal(notes[1].hangingIndent, 6);
  assert.deepEqual(notes[0].sentences[0].fragments.map(f => f.item), [1, 2]);
});

test('参考文献逐条保留，正文中的引用和编号列表不误判为章节标题', () => {
  const layout = positionedLayout([
    run(0, 'References', 79, 110, 70, 10),
    run(1, '[1] A. Author, An academic paper, Journal,', 79, 134, 359, 8),
    run(2, '10 (2024) 1–10.', 92, 144, 180, 8),
    run(3, '[2] B. Author, Another paper.', 79, 154, 300, 8),
    run(4, '1. Choose an action.', 79, 210, 200, 10),
    run(5, '2. Observe the result.', 79, 222, 200, 10),
  ], 543, 743, 34);
  assert.equal(layout.blocks.filter(b => b.kind === 'reference').length, 2);
  assert.equal(layout.blocks[1].hangingIndent, 13);
  assert.equal(layout.blocks.at(-1)?.kind, 'paragraph');
});

test('排版升级仅复用原文及字符范围一致的译句，拆段与重复内容不会误配', () => {
  const previous = positionedLayout([run(0, 'First sentence.', 50, 100), run(1, 'Second sentence.', 50, 116)], 600, 800, 1);
  previous.version = 1;
  const saved = parseAlignedTranslation(JSON.stringify({ translations: previous.blocks.flatMap(b => b.sentences).map((s, i) => ({ id: s.id, text: `译句${i}` })) }), previous);
  const next = structuredClone(previous);
  next.version = 2;
  next.blocks[0].sentences.forEach((s, i) => { s.id = `p1-b2-s${i}`; });
  const migrated = remapTranslation(previous, next, saved);
  assert.equal(migrated?.source, layoutSource(next));
  assert.equal(migrated?.segments['p1-b2-s1'], '译句1');
  assert.equal(saved.segments['p1-b0-s1'], '译句1');
  next.blocks[0].sentences[0].text = 'Different sentence.';
  assert.equal(remapTranslation(previous, next, saved), undefined);
  assert.equal(remapTranslation(undefined, next, saved), undefined);
  assert.equal(remapTranslation(previous, next, { ...saved, source: 'stale' }), undefined);
});

test('重复句子按原 PDF 位置复用，签名相同时也校验字符范围', () => {
  const previous = positionedLayout([run(0, 'Repeated sentence.', 50, 100), run(1, 'Repeated sentence.', 50, 116)], 600, 800, 1);
  const saved = parseAlignedTranslation(JSON.stringify({ translations: previous.blocks[0].sentences.map((s, i) => ({ id: s.id, text: `译句${i}` })) }), previous);
  const next = structuredClone(previous);
  [next.blocks[0].sentences[0].fragments, next.blocks[0].sentences[1].fragments] = [next.blocks[0].sentences[1].fragments, next.blocks[0].sentences[0].fragments];
  assert.equal(layoutSource(previous), layoutSource(next));
  assert.equal(remapTranslation(previous, next, saved)?.segments['p1-b0-s0'], '译句1');
  previous.blocks[0].sentences[1].fragments = previous.blocks[0].sentences[0].fragments;
  assert.equal(remapTranslation(previous, previous, saved), undefined);
});
