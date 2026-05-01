import { describe, expect, it } from 'vitest';
import { parseAozora } from './aozora';
import { applyTcy, escapeHtml, renderBlock, renderDoc } from './render';

describe('applyTcy', () => {
  it('1〜3桁の数字を縦中横で包む', () => {
    expect(applyTcy('12月31日')).toBe('<span class="tcy">12</span>月<span class="tcy">31</span>日');
  });

  it('4桁以上は包まない', () => {
    expect(applyTcy('2026年')).toBe('2026年');
  });

  it('!?の対を包む', () => {
    expect(applyTcy('まさか!?')).toBe('まさか<span class="tcy">!?</span>');
  });

  it('単独の!は包まない', () => {
    expect(applyTcy('おお!')).toBe('おお!');
  });
});

describe('renderBlock', () => {
  it('ルビをruby/rt要素にする', () => {
    const html = renderBlock({
      type: 'para',
      indent: 0,
      nodes: [{ type: 'ruby', base: '縦書', ruby: 'たてが' }],
    });
    expect(html).toBe('<p><ruby>縦書<rt>たてが</rt></ruby></p>');
  });

  it('傍点をem.botenにする', () => {
    const html = renderBlock({
      type: 'para',
      indent: 0,
      nodes: [{ type: 'emphasis', text: 'ここ' }],
    });
    expect(html).toContain('<em class="boten">ここ</em>');
  });

  it('字下げをpadding-inline-startにする', () => {
    const html = renderBlock({
      type: 'para',
      indent: 2,
      nodes: [{ type: 'text', text: '引用' }],
    });
    expect(html).toContain('padding-inline-start:2em');
  });

  it('空行は空白段落として残す', () => {
    expect(renderBlock({ type: 'para', indent: 0, nodes: [] })).toBe('<p class="blank"></p>');
  });

  it('見出しレベルをタグへ割り当てる', () => {
    const html = renderBlock({
      type: 'heading',
      level: 1,
      nodes: [{ type: 'text', text: '一章' }],
    });
    expect(html).toBe('<h2 class="hd hd-1">一章</h2>');
  });

  it('本文のマークアップをエスケープする', () => {
    const html = renderBlock({
      type: 'para',
      indent: 0,
      nodes: [{ type: 'text', text: '<b>太字</b>' }],
    });
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

describe('renderDoc', () => {
  it('題名・本文・奥付の順に組む', () => {
    const doc = parseAozora('題名\n著者\n\n本文。\n\n底本:「全集」出版社');
    const html = renderDoc(doc);
    expect(html).toContain('<h1 class="doc-title">題名</h1>');
    expect(html).toContain('<p class="doc-author">著者</p>');
    expect(html).toContain('本文。');
    expect(html.indexOf('colophon')).toBeGreaterThan(html.indexOf('本文。'));
  });
});

describe('escapeHtml', () => {
  it('特殊文字を実体参照にする', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
  });
});
