// 青空文庫の注記記法パーサ。よく使われる注記(ルビ・傍点・見出し・
// 字下げ・改ページ)を構造化し、解釈できない注記は本文から取り除く。
// 仕様: https://www.aozora.gr.jp/annotation/

export interface TextNode {
  type: 'text';
  text: string;
}

export interface RubyNode {
  type: 'ruby';
  base: string;
  ruby: string;
}

export interface EmphasisNode {
  type: 'emphasis';
  text: string;
}

export type Inline = TextNode | RubyNode | EmphasisNode;

export interface HeadingBlock {
  type: 'heading';
  level: 1 | 2 | 3;
  nodes: Inline[];
}

export interface ParaBlock {
  type: 'para';
  nodes: Inline[];
  indent: number;
}

export interface PageBreakBlock {
  type: 'pagebreak';
}

export type Block = HeadingBlock | ParaBlock | PageBreakBlock;

export interface AozoraDoc {
  title: string;
  author: string;
  blocks: Block[];
  colophon: string[];
}

// ルビの親文字に使える文字。漢字のほか、々〆ヶなどの記号を含める。
const KANJI = '\\u3005-\\u3007\\u30F6\\u4E00-\\u9FFF\\uF900-\\uFAFF';

// 注記の全角記号はソース上の取り違えを避けるためエスケープで書く。
// ［=[ ＃=# ］=] ｜=| (いずれも全角)
const OPEN = '\\uFF3B\\uFF03';
const CLOSE = '\\uFF3D';

const INLINE_RE = new RegExp(
  [
    `[\\uFF5C|]([^《\\uFF5C|\\n]+)《([^》]+)》`, // |親文字《ルビ》
    `([${KANJI}]+)《([^》]+)》`, // 漢字《ルビ》
    `${OPEN}「([^」]+)」に傍点${CLOSE}`, // 傍点
    `${OPEN}[^${CLOSE}]*${CLOSE}`, // その他の注記(除去)
  ].join('|'),
  'g',
);

function pushText(nodes: Inline[], text: string): void {
  if (text === '') return;
  const last = nodes[nodes.length - 1];
  if (last !== undefined && last.type === 'text') {
    last.text += text;
  } else {
    nodes.push({ type: 'text', text });
  }
}

// 直前のテキストノード末尾から傍点対象を切り出してemphasisにする。
function applyEmphasis(nodes: Inline[], target: string): void {
  const last = nodes[nodes.length - 1];
  if (last === undefined || last.type !== 'text' || !last.text.endsWith(target)) {
    return;
  }
  last.text = last.text.slice(0, last.text.length - target.length);
  if (last.text === '') nodes.pop();
  nodes.push({ type: 'emphasis', text: target });
}

export function parseInline(line: string): Inline[] {
  const nodes: Inline[] = [];
  let cursor = 0;
  for (const m of line.matchAll(INLINE_RE)) {
    pushText(nodes, line.slice(cursor, m.index));
    cursor = m.index + m[0].length;
    const [, barBase, barRuby, kanjiBase, kanjiRuby, emphasis] = m;
    if (barBase !== undefined && barRuby !== undefined) {
      nodes.push({ type: 'ruby', base: barBase, ruby: barRuby });
    } else if (kanjiBase !== undefined && kanjiRuby !== undefined) {
      nodes.push({ type: 'ruby', base: kanjiBase, ruby: kanjiRuby });
    } else if (emphasis !== undefined) {
      applyEmphasis(nodes, emphasis);
    }
    // どの捕捉にも当たらない場合は未対応の注記なので落とす。
  }
  pushText(nodes, line.slice(cursor));
  return nodes;
}

const DELIMITER_RE = /^-{8,}\s*$/;
const HEADING_RE = /［＃「([^」]+)」は([大中小])見出し］/;
const HEADING_LEVELS: Record<string, 1 | 2 | 3> = { 大: 1, 中: 2, 小: 3 };
const PAGEBREAK_RE = /^［＃改(?:ページ|丁|見開き)］$/;
const INDENT_START_RE = /^［＃ここから([0-9０-９]+)字下げ］$/;
const INDENT_END_RE = /^［＃ここで字下げ終わり］$/;
const INDENT_LINE_RE = /^［＃([0-9０-９]+)字下げ］/;

// 全角数字まじりの注記の数値を読む。
function numValue(s: string): number {
  return Number(s.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)));
}

interface HeaderScan {
  title: string;
  author: string;
  bodyStart: number;
}

// 冒頭の「題名・著者・記号説明ブロック」を読み飛ばす。
function scanHeader(lines: string[]): HeaderScan {
  let i = 0;
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++;
  const title = (lines[i] ?? '').trim();
  i++;
  const author = (lines[i] ?? '').trim();
  i++;
  let bodyStart = i;
  // 数行以内に区切り線があれば、その対(記号の説明)を飛ばす。
  for (let j = i; j < Math.min(i + 8, lines.length); j++) {
    if (DELIMITER_RE.test(lines[j] ?? '')) {
      for (let k = j + 1; k < lines.length; k++) {
        if (DELIMITER_RE.test(lines[k] ?? '')) {
          bodyStart = k + 1;
          break;
        }
      }
      break;
    }
  }
  return { title, author, bodyStart };
}

export function parseAozora(source: string): AozoraDoc {
  const lines = source
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .split('\n');
  const { title, author, bodyStart } = scanHeader(lines);

  // 末尾の「底本:」以降は奥付として本文から分ける。
  let bodyEnd = lines.length;
  for (let i = lines.length - 1; i >= bodyStart; i--) {
    if (/^底本[:：]/.test((lines[i] ?? '').trim())) {
      bodyEnd = i;
      break;
    }
  }
  const colophon = lines
    .slice(bodyEnd)
    .map((l) => l.trim())
    .filter((l) => l !== '');

  const blocks: Block[] = [];
  let indent = 0;
  let leadingBlank = true;
  for (let i = bodyStart; i < bodyEnd; i++) {
    let line = lines[i] ?? '';
    const trimmed = line.trim();
    if (PAGEBREAK_RE.test(trimmed)) {
      blocks.push({ type: 'pagebreak' });
      continue;
    }
    const blockIndent = INDENT_START_RE.exec(trimmed);
    if (blockIndent !== null) {
      indent = numValue(blockIndent[1] ?? '0');
      continue;
    }
    if (INDENT_END_RE.test(trimmed)) {
      indent = 0;
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      const text = heading[1] ?? '';
      blocks.push({
        type: 'heading',
        level: HEADING_LEVELS[heading[2] ?? '中'] ?? 2,
        nodes: parseInline(text),
      });
      continue;
    }
    let lineIndent = indent;
    const perLine = INDENT_LINE_RE.exec(line);
    if (perLine !== null) {
      lineIndent = numValue(perLine[1] ?? '0');
      line = line.slice(perLine[0].length);
    }
    if (line.trim() === '' && leadingBlank) continue;
    leadingBlank = false;
    blocks.push({ type: 'para', nodes: parseInline(line), indent: lineIndent });
  }

  // 末尾の空行を落とす。
  while (blocks.length > 0) {
    const last = blocks[blocks.length - 1];
    if (last?.type === 'para' && last.nodes.length === 0) {
      blocks.pop();
    } else {
      break;
    }
  }

  return { title, author, blocks, colophon };
}
