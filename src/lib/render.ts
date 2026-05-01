// 構造化した本文を縦書き用HTMLへ。半角数字の縦中横、ルビ、傍点の
// 装飾をここで確定させる。返すのは文字列で、DOMには触れない。

import type { AozoraDoc, Block, Inline } from './aozora';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 1〜3桁の半角数字と「!?」「!!」「??」を縦中横にする。
// エスケープ後の文字列に適用しても数字と!?は影響を受けない。
export function applyTcy(escaped: string): string {
  return escaped
    .replace(/(?<![0-9])([0-9]{1,3})(?![0-9])/g, '<span class="tcy">$1</span>')
    .replace(/(?<![!?])([!?]{2})(?![!?])/g, '<span class="tcy">$1</span>');
}

function renderInline(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return applyTcy(escapeHtml(node.text));
        case 'ruby':
          return `<ruby>${escapeHtml(node.base)}<rt>${escapeHtml(node.ruby)}</rt></ruby>`;
        case 'emphasis':
          return `<em class="boten">${escapeHtml(node.text)}</em>`;
      }
    })
    .join('');
}

const HEADING_TAGS: Record<1 | 2 | 3, string> = { 1: 'h2', 2: 'h3', 3: 'h4' };

export function renderBlock(block: Block): string {
  switch (block.type) {
    case 'pagebreak':
      return '<div class="pagebreak" aria-hidden="true"></div>';
    case 'heading': {
      const tag = HEADING_TAGS[block.level];
      return `<${tag} class="hd hd-${block.level}">${renderInline(block.nodes)}</${tag}>`;
    }
    case 'para': {
      if (block.nodes.length === 0) return '<p class="blank"></p>';
      const style = block.indent > 0 ? ` style="padding-inline-start:${block.indent}em"` : '';
      return `<p${style}>${renderInline(block.nodes)}</p>`;
    }
  }
}

export function renderDoc(doc: AozoraDoc): string {
  const head =
    `<header class="doc-head">` +
    `<h1 class="doc-title">${applyTcy(escapeHtml(doc.title))}</h1>` +
    (doc.author === '' ? '' : `<p class="doc-author">${applyTcy(escapeHtml(doc.author))}</p>`) +
    `</header>`;
  const body = doc.blocks.map(renderBlock).join('');
  const colophon =
    doc.colophon.length === 0
      ? ''
      : `<footer class="colophon">${doc.colophon
          .map((l) => `<p>${applyTcy(escapeHtml(l))}</p>`)
          .join('')}</footer>`;
  return head + body + colophon;
}
