import { describe, expect, it } from 'vitest';
import type { StorageLike } from './library';
import { DEFAULT_SETTINGS, Library, LibraryError } from './library';
import { SAMPLE_TEXT } from './sample';

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const TEXT = '吾輩は猫であるもどき\n名無しの作者\n\n 本文の一行目。';

describe('作品の登録', () => {
  it('本文から題名と著者を拾う', () => {
    const lib = new Library(memoryStorage());
    const work = lib.add(TEXT);
    expect(work.title).toBe('吾輩は猫であるもどき');
    expect(work.author).toBe('名無しの作者');
  });

  it('空の本文を拒否する', () => {
    const lib = new Library(memoryStorage());
    expect(() => lib.add('  \n ')).toThrow(LibraryError);
  });

  it('同じ本文の二重登録を拒否する', () => {
    const lib = new Library(memoryStorage());
    lib.add(TEXT);
    expect(() => lib.add(TEXT)).toThrow('すでに書架');
  });

  it('改行コードを正規化して保存する', () => {
    const lib = new Library(memoryStorage());
    const work = lib.add('題\r\n著者\r\n\r\n本文。');
    expect(work.text).not.toContain('\r');
  });

  it('削除すると進捗も消える', () => {
    const lib = new Library(memoryStorage());
    const work = lib.add(TEXT);
    lib.setProgress(work.id, 0.5);
    lib.remove(work.id);
    expect(lib.works()).toEqual([]);
    expect(lib.progress(work.id)).toBe(0);
  });

  it('存在しない作品の削除はLibraryErrorになる', () => {
    const lib = new Library(memoryStorage());
    expect(() => lib.remove('none')).toThrow(LibraryError);
  });
});

describe('進捗と設定', () => {
  it('進捗は0〜1へ丸めて保存する', () => {
    const lib = new Library(memoryStorage());
    const work = lib.add(TEXT);
    lib.setProgress(work.id, 1.4);
    expect(lib.progress(work.id)).toBe(1);
    lib.setProgress(work.id, -0.2);
    expect(lib.progress(work.id)).toBe(0);
  });

  it('設定の部分更新ができる', () => {
    const lib = new Library(memoryStorage());
    lib.updateSettings({ font: 'gothic', fontSize: 20 });
    expect(lib.settings()).toEqual({
      ...DEFAULT_SETTINGS,
      font: 'gothic',
      fontSize: 20,
    });
  });

  it('ふりがな表示は既定で有効、切り替えて保存できる', () => {
    const storage = memoryStorage();
    const lib = new Library(storage);
    expect(lib.settings().ruby).toBe(true);
    lib.updateSettings({ ruby: false });
    expect(new Library(storage).settings().ruby).toBe(false);
  });
});

describe('永続化', () => {
  it('同じストレージから作り直すと書架・進捗・設定が戻る', () => {
    const storage = memoryStorage();
    const first = new Library(storage);
    const work = first.add(TEXT);
    first.setProgress(work.id, 0.25);
    first.updateSettings({ theme: 'sepia' });

    const second = new Library(storage);
    expect(second.works()).toHaveLength(1);
    expect(second.progress(work.id)).toBe(0.25);
    expect(second.settings().theme).toBe('sepia');
  });

  it('壊れた保存データは既定値に戻す', () => {
    const storage = memoryStorage();
    storage.setItem('tategaki:v1', '{bad json');
    const lib = new Library(storage);
    expect(lib.works()).toEqual([]);
    expect(lib.settings()).toEqual(DEFAULT_SETTINGS);
  });

  it('保存データ内の不正な設定値は既定値へ寄せる', () => {
    const storage = memoryStorage();
    storage.setItem(
      'tategaki:v1',
      JSON.stringify({
        works: [],
        progress: {},
        settings: { fontSize: 99, theme: 'neon', ruby: 'yes' },
      }),
    );
    const lib = new Library(storage);
    expect(lib.settings().fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(lib.settings().theme).toBe('auto');
    expect(lib.settings().ruby).toBe(DEFAULT_SETTINGS.ruby);
  });
});

describe('収録サンプル', () => {
  it('サンプルは題名つきで登録できる', () => {
    const lib = new Library(memoryStorage());
    const work = lib.add(SAMPLE_TEXT);
    expect(work.title).toBe('縦書きのすすめ');
    expect(work.author).toBe('tategaki文庫');
  });
});

describe('しおり', () => {
  it('割合の昇順で並べて返す', () => {
    const lib = new Library(memoryStorage());
    const work = lib.add(TEXT);
    lib.addBookmark(work.id, 0.6, '後半');
    lib.addBookmark(work.id, 0.2, '前半');
    expect(lib.bookmarks(work.id).map((b) => b.label)).toEqual(['前半', '後半']);
  });

  it('しおりは削除できる', () => {
    const lib = new Library(memoryStorage());
    const work = lib.add(TEXT);
    const bm = lib.addBookmark(work.id, 0.5, 'しるし');
    lib.removeBookmark(work.id, bm.id);
    expect(lib.bookmarks(work.id)).toEqual([]);
  });

  it('作品を消すとしおりも消える', () => {
    const storage = memoryStorage();
    const lib = new Library(storage);
    const work = lib.add(TEXT);
    lib.addBookmark(work.id, 0.5, 'しるし');
    lib.remove(work.id);
    expect(new Library(storage).bookmarks(work.id)).toEqual([]);
  });

  it('存在しない作品へのしおり追加はLibraryErrorになる', () => {
    const lib = new Library(memoryStorage());
    expect(() => lib.addBookmark('none', 0.5, 'x')).toThrow(LibraryError);
  });
});

describe('続きから', () => {
  it('最後に開いた作品を覚え、削除で忘れる', () => {
    const storage = memoryStorage();
    const lib = new Library(storage);
    const work = lib.add(TEXT);
    lib.setLastRead(work.id);
    expect(new Library(storage).lastRead()?.id).toBe(work.id);
    lib.remove(work.id);
    expect(lib.lastRead()).toBeNull();
  });

  it('存在しない作品は続きからに記録しない', () => {
    const lib = new Library(memoryStorage());
    lib.setLastRead('none');
    expect(lib.lastRead()).toBeNull();
  });
});

describe('書き出しと読み込み', () => {
  it('書き出したJSONを別の書架へmergeで取り込む', () => {
    const source = new Library(memoryStorage());
    const work = source.add(TEXT);
    source.setProgress(work.id, 0.4);
    source.addBookmark(work.id, 0.3, 'しるし');
    const json = source.exportJSON();

    const target = new Library(memoryStorage());
    const result = target.importJSON(json, 'merge');
    expect(result.added).toBe(1);
    expect(target.works()).toHaveLength(1);
    expect(target.progress(work.id)).toBe(0.4);
    expect(target.bookmarks(work.id)).toHaveLength(1);
  });

  it('mergeは同じ本文を二重に取り込まない', () => {
    const lib = new Library(memoryStorage());
    lib.add(TEXT);
    const json = lib.exportJSON();
    const result = lib.importJSON(json, 'merge');
    expect(result.added).toBe(0);
    expect(lib.works()).toHaveLength(1);
  });

  it('replaceは書架を入れ替える', () => {
    const source = new Library(memoryStorage());
    source.add(TEXT);
    const json = source.exportJSON();

    const target = new Library(memoryStorage());
    target.add('別の題\n別の著者\n\n別の本文。');
    target.importJSON(json, 'replace');
    expect(target.works()).toHaveLength(1);
    expect(target.works()[0]?.title).toBe('吾輩は猫であるもどき');
  });

  it('JSONとして壊れた入力はLibraryErrorになる', () => {
    const lib = new Library(memoryStorage());
    expect(() => lib.importJSON('{壊れた')).toThrow(LibraryError);
  });
});
