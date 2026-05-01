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
      JSON.stringify({ works: [], progress: {}, settings: { fontSize: 99, theme: 'neon' } }),
    );
    const lib = new Library(storage);
    expect(lib.settings().fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(lib.settings().theme).toBe('auto');
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
