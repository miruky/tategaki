// 読書に付随する計算をまとめた純粋関数。字数・推定読書時間・しおりの
// ラベル抜き出し・本文内検索の素材づくりを、DOMから切り離して扱う。

import type { AozoraDoc, Inline } from './aozora';

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((node) => (node.type === 'ruby' ? node.base : node.text))
    .join('');
}

export interface HeadingEntry {
  index: number;
  level: 1 | 2 | 3;
  text: string;
}

// 目次。block配列の添字を持たせ、本文中の data-h と対応づける。
export function extractHeadings(doc: AozoraDoc): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  doc.blocks.forEach((block, index) => {
    if (block.type === 'heading') {
      out.push({ index, level: block.level, text: inlineText(block.nodes) });
    }
  });
  return out;
}

// 本文を1本の文字列へ均す。ルビは親文字だけ、見出しも本文に含める。
// しおりの抜き出しと検索の対象に使うので、読者が目にする文字列に寄せる。
export function flattenDoc(doc: AozoraDoc): string {
  return doc.blocks
    .map((block) => (block.type === 'pagebreak' ? '' : inlineText(block.nodes)))
    .filter((line) => line !== '')
    .join('\n');
}

// 空白・改行を除いた実質の字数。読書時間の基準にする。
export function countChars(doc: AozoraDoc): number {
  return flattenDoc(doc).replace(/\s+/g, '').length;
}

// 日本語の黙読は概ね毎分400〜600字。中間の500字/分で見積もる。
const CHARS_PER_MINUTE = 500;

export function estimateMinutes(chars: number): number {
  if (chars <= 0) return 0;
  return Math.max(1, Math.round(chars / CHARS_PER_MINUTE));
}

// しおりのラベルに使う、読書位置あたりの一節。改行は詰める。
export function snippetAt(text: string, ratio: number, length = 22): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat === '') return '';
  const clamped = Math.min(1, Math.max(0, ratio));
  const start = Math.min(flat.length - 1, Math.floor(clamped * flat.length));
  const slice = flat.slice(start, start + length);
  return start + length < flat.length ? `${slice}…` : slice;
}

export interface Segment {
  text: string;
  hit: boolean;
}

// 検索語にあたる箇所を hit:true の断片として切り出す。正規表現は使わず
// 字面どおりに照合し、ラテン文字だけ大文字小文字を無視する。
export function splitHighlight(text: string, query: string): Segment[] {
  if (query === '') return [{ text, hit: false }];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const segments: Segment[] = [];
  let cursor = 0;
  for (;;) {
    const at = haystack.indexOf(needle, cursor);
    if (at === -1) break;
    if (at > cursor) segments.push({ text: text.slice(cursor, at), hit: false });
    segments.push({ text: text.slice(at, at + needle.length), hit: true });
    cursor = at + needle.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}

export function countMatches(text: string, query: string): number {
  if (query === '') return 0;
  return splitHighlight(text, query).filter((s) => s.hit).length;
}
