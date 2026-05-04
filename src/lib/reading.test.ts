import { describe, expect, it } from 'vitest';
import { parseAozora } from './aozora';
import {
  countChars,
  countMatches,
  estimateMinutes,
  flattenDoc,
  snippetAt,
  splitHighlight,
} from './reading';

describe('flattenDoc', () => {
  it('ルビは親文字だけにして本文をつなぐ', () => {
    const doc = parseAozora('題\n著者\n\n青空《あおぞら》を見る。');
    expect(flattenDoc(doc)).toBe('青空を見る。');
  });

  it('改ページは本文に含めない', () => {
    const doc = parseAozora('題\n著者\n\n前。\n［＃改ページ］\n後。');
    expect(flattenDoc(doc)).toBe('前。\n後。');
  });
});

describe('countChars と estimateMinutes', () => {
  it('空白と改行を除いて字数を数える', () => {
    const doc = parseAozora('題\n著者\n\n一 二\n三。');
    expect(countChars(doc)).toBe(4);
  });

  it('字数から分を見積もり、短文でも最低1分にする', () => {
    expect(estimateMinutes(0)).toBe(0);
    expect(estimateMinutes(10)).toBe(1);
    expect(estimateMinutes(5000)).toBe(10);
  });
});

describe('snippetAt', () => {
  it('割合の位置から一節を切り出す', () => {
    const text = 'あいうえおかきくけこ';
    expect(snippetAt(text, 0, 3)).toBe('あいう…');
  });

  it('末尾近くでは省略記号を付けない', () => {
    const text = 'あいうえお';
    expect(snippetAt(text, 1, 5)).toBe('お');
  });

  it('空文字は空のまま返す', () => {
    expect(snippetAt('   ', 0.5)).toBe('');
  });
});

describe('splitHighlight', () => {
  it('一致箇所を hit:true で切り分ける', () => {
    expect(splitHighlight('猫と犬と猫', '猫')).toEqual([
      { text: '猫', hit: true },
      { text: 'と犬と', hit: false },
      { text: '猫', hit: true },
    ]);
  });

  it('ラテン文字は大文字小文字を無視する', () => {
    expect(countMatches('Cat cat CAT', 'cat')).toBe(3);
  });

  it('空の検索語では全体を非一致で返す', () => {
    expect(splitHighlight('本文', '')).toEqual([{ text: '本文', hit: false }]);
    expect(countMatches('本文', '')).toBe(0);
  });
});
