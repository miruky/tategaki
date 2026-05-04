import { describe, expect, it } from 'vitest';
import { parseAozora } from './aozora';
import {
  countChars,
  countMatches,
  estimateMinutes,
  extractHeadings,
  filterWorks,
  flattenDoc,
  remainingMinutes,
  snippetAt,
  splitHighlight,
} from './reading';
import type { Work } from './library';

const work = (title: string, author: string): Work => ({
  id: title,
  title,
  author,
  text: `${title}\n${author}\n\n本文。`,
  addedAt: '2026-01-01T00:00:00.000Z',
});

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

describe('remainingMinutes', () => {
  it('読書位置から未読分を見積もる', () => {
    expect(remainingMinutes(5000, 0)).toBe(10);
    expect(remainingMinutes(5000, 0.5)).toBe(5);
  });

  it('読了(1以上)では0を返し、範囲外もclampする', () => {
    expect(remainingMinutes(5000, 1)).toBe(0);
    expect(remainingMinutes(5000, 1.5)).toBe(0);
    expect(remainingMinutes(5000, -1)).toBe(10);
  });
});

describe('filterWorks', () => {
  const works = [
    work('吾輩は猫である', '夏目漱石'),
    work('走れメロス', '太宰治'),
    work('注文の多い料理店', '宮沢賢治'),
  ];

  it('空クエリは全件を返す', () => {
    expect(filterWorks(works, '')).toHaveLength(3);
    expect(filterWorks(works, '   ')).toHaveLength(3);
  });

  it('題名でも著者でも部分一致で絞る', () => {
    expect(filterWorks(works, '猫').map((w) => w.title)).toEqual(['吾輩は猫である']);
    expect(filterWorks(works, '太宰').map((w) => w.title)).toEqual(['走れメロス']);
  });

  it('一致しなければ空配列', () => {
    expect(filterWorks(works, '芥川')).toEqual([]);
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

describe('extractHeadings', () => {
  it('見出しを添字つきで拾い、ルビは親文字にする', () => {
    const doc = parseAozora(
      '題\n著者\n\n本文。\n［＃「序《じょ》」は大見出し］\n中身。\n［＃「終」は小見出し］',
    );
    const headings = extractHeadings(doc);
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, '序'],
      [3, '終'],
    ]);
    expect(headings[0]?.index).toBe(1);
  });

  it('見出しがなければ空配列', () => {
    expect(extractHeadings(parseAozora('題\n著者\n\n本文のみ。'))).toEqual([]);
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
