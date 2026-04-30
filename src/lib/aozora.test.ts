import { describe, expect, it } from 'vitest';
import { parseAozora, parseInline } from './aozora';

describe('parseInline', () => {
  it('漢字に続く《》をルビとして読む', () => {
    expect(parseInline('縦書《たてが》きの本')).toEqual([
      { type: 'ruby', base: '縦書', ruby: 'たてが' },
      { type: 'text', text: 'きの本' },
    ]);
  });

  it('全角の｜で親文字の範囲を特定できる', () => {
    expect(parseInline('｜青空文庫《あおぞらぶんこ》を読む')).toEqual([
      { type: 'ruby', base: '青空文庫', ruby: 'あおぞらぶんこ' },
      { type: 'text', text: 'を読む' },
    ]);
  });

  it('半角の|も受け付ける', () => {
    expect(parseInline('|ひらがな《るび》')).toEqual([
      { type: 'ruby', base: 'ひらがな', ruby: 'るび' },
    ]);
  });

  it('親文字の漢字連続は直前までで区切る', () => {
    expect(parseInline('東京の朝日《あさひ》')).toEqual([
      { type: 'text', text: '東京の' },
      { type: 'ruby', base: '朝日', ruby: 'あさひ' },
    ]);
  });

  it('傍点注記は直前の文字列を強調に変える', () => {
    expect(parseInline('念のためここ［＃「ここ」に傍点］を見る')).toEqual([
      { type: 'text', text: '念のため' },
      { type: 'emphasis', text: 'ここ' },
      { type: 'text', text: 'を見る' },
    ]);
  });

  it('対象が直前にない傍点注記は黙って捨てる', () => {
    expect(parseInline('文章［＃「別の言葉」に傍点］の続き')).toEqual([
      { type: 'text', text: '文章の続き' },
    ]);
  });

  it('未対応の注記は本文から取り除く', () => {
    expect(parseInline('天気［＃「天気」は底本では「天氣」］の話')).toEqual([
      { type: 'text', text: '天気の話' },
    ]);
  });

  it('外字注記は※を残して説明を落とす', () => {
    expect(parseInline('※［＃「魚+底」、第3水準1-2-3］の字')).toEqual([
      { type: 'text', text: '※の字' },
    ]);
  });

  it('注記のない行はそのまま1ノードになる', () => {
    expect(parseInline('ただの一行')).toEqual([{ type: 'text', text: 'ただの一行' }]);
  });
});

const SOURCE = `題名のテスト
著者のテスト

-------------------------------------------------------
【テキスト中に現れる記号について】

《》:ルビ
-------------------------------------------------------

［＃「一章」は大見出し］

 最初の段落。
［＃ここから2字下げ］
字下げされた行。
［＃ここで字下げ終わり］
［＃改ページ］
 次のページの段落。

底本:「テスト全集」テスト出版
入力:テスト`;

describe('parseAozora', () => {
  const doc = parseAozora(SOURCE);

  it('題名と著者を冒頭から読む', () => {
    expect(doc.title).toBe('題名のテスト');
    expect(doc.author).toBe('著者のテスト');
  });

  it('記号説明ブロックを本文に含めない', () => {
    const text = JSON.stringify(doc.blocks);
    expect(text).not.toContain('記号について');
  });

  it('見出し・字下げ・改ページを構造化する', () => {
    expect(doc.blocks[0]).toEqual({
      type: 'heading',
      level: 1,
      nodes: [{ type: 'text', text: '一章' }],
    });
    const indented = doc.blocks.find((b) => b.type === 'para' && b.indent === 2);
    expect(indented).toBeDefined();
    expect(doc.blocks.some((b) => b.type === 'pagebreak')).toBe(true);
  });

  it('全角数字の字下げも読める', () => {
    const doc2 = parseAozora('題\n著\n\n［＃ここから3字下げ］\n本文。');
    expect(doc2.blocks).toContainEqual({
      type: 'para',
      nodes: [{ type: 'text', text: '本文。' }],
      indent: 3,
    });
  });

  it('底本以降を奥付として分離する', () => {
    expect(doc.colophon).toEqual(['底本:「テスト全集」テスト出版', '入力:テスト']);
    expect(JSON.stringify(doc.blocks)).not.toContain('底本');
  });

  it('区切り線がないテキストも本文として読める', () => {
    const simple = parseAozora('題\n著者\n\n 本文の一行目。');
    expect(simple.title).toBe('題');
    expect(simple.blocks).toContainEqual({
      type: 'para',
      nodes: [{ type: 'text', text: ' 本文の一行目。' }],
      indent: 0,
    });
  });

  it('CRLFと末尾の空行を吸収する', () => {
    const doc2 = parseAozora('題\r\n著者\r\n\r\n本文。\r\n\r\n\r\n');
    const paras = doc2.blocks.filter((b) => b.type === 'para');
    expect(paras).toHaveLength(1);
  });
});
