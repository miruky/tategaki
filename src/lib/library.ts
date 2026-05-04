// 書架。取り込んだ作品の本文・読書位置・表示設定を、注入された
// ストレージへまとめて保存する。

import { parseAozora } from './aozora';

export interface Work {
  id: string;
  title: string;
  author: string;
  text: string;
  addedAt: string;
}

export interface Bookmark {
  id: string;
  ratio: number;
  label: string;
  createdAt: string;
}

export type FontFamily = 'mincho' | 'gothic';
export type Theme = 'auto' | 'light' | 'dark' | 'sepia';

export interface Settings {
  font: FontFamily;
  fontSize: number;
  lineHeight: number;
  theme: Theme;
  ruby: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  font: 'mincho',
  fontSize: 18,
  lineHeight: 1.9,
  theme: 'auto',
  ruby: true,
};

export const FONT_SIZES = [16, 18, 20, 23] as const;
export const LINE_HEIGHTS = [1.7, 1.9, 2.1] as const;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class LibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryError';
  }
}

const STORAGE_KEY = 'tategaki:v1';

function makeId(): string {
  const c = globalThis.crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return 'w-' + Math.random().toString(36).slice(2, 12);
}

interface Persisted {
  works: Work[];
  progress: Record<string, number>;
  settings: Settings;
  bookmarks: Record<string, Bookmark[]>;
  lastReadId: string | null;
}

function coerceBookmark(value: unknown): Bookmark | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.ratio !== 'number' || v.ratio < 0 || v.ratio > 1) return null;
  return {
    id: typeof v.id === 'string' && v.id !== '' ? v.id : makeId(),
    ratio: v.ratio,
    label: typeof v.label === 'string' ? v.label : '',
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : new Date(0).toISOString(),
  };
}

function coerceSettings(s: Record<string, unknown>): Settings {
  return {
    font: s.font === 'gothic' ? 'gothic' : 'mincho',
    fontSize:
      typeof s.fontSize === 'number' && (FONT_SIZES as readonly number[]).includes(s.fontSize)
        ? s.fontSize
        : DEFAULT_SETTINGS.fontSize,
    lineHeight:
      typeof s.lineHeight === 'number' &&
      (LINE_HEIGHTS as readonly number[]).includes(s.lineHeight)
        ? s.lineHeight
        : DEFAULT_SETTINGS.lineHeight,
    theme: s.theme === 'light' || s.theme === 'dark' || s.theme === 'sepia' ? s.theme : 'auto',
    ruby: typeof s.ruby === 'boolean' ? s.ruby : DEFAULT_SETTINGS.ruby,
  };
}

function coerceWork(value: unknown): Work | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.text !== 'string' || v.text === '') return null;
  return {
    id: typeof v.id === 'string' && v.id !== '' ? v.id : makeId(),
    title: typeof v.title === 'string' && v.title !== '' ? v.title : '無題',
    author: typeof v.author === 'string' ? v.author : '',
    text: v.text,
    addedAt: typeof v.addedAt === 'string' ? v.addedAt : new Date(0).toISOString(),
  };
}

export class Library {
  private data: Persisted = {
    works: [],
    progress: {},
    settings: { ...DEFAULT_SETTINGS },
    bookmarks: {},
    lastReadId: null,
  };

  constructor(
    private storage: StorageLike,
    private now: () => Date = () => new Date(),
  ) {
    this.load();
  }

  private load(): void {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw === null) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return;
      const p = parsed as Record<string, unknown>;
      if (Array.isArray(p.works)) {
        this.data.works = p.works.map(coerceWork).filter((w): w is Work => w !== null);
      }
      if (typeof p.progress === 'object' && p.progress !== null) {
        for (const [k, v] of Object.entries(p.progress)) {
          if (typeof v === 'number' && v >= 0 && v <= 1) {
            this.data.progress[k] = v;
          }
        }
      }
      if (typeof p.settings === 'object' && p.settings !== null) {
        this.data.settings = coerceSettings(p.settings as Record<string, unknown>);
      }
      if (typeof p.bookmarks === 'object' && p.bookmarks !== null) {
        for (const [k, v] of Object.entries(p.bookmarks)) {
          if (!Array.isArray(v)) continue;
          const list = v.map(coerceBookmark).filter((b): b is Bookmark => b !== null);
          if (list.length > 0) this.data.bookmarks[k] = list;
        }
      }
      if (typeof p.lastReadId === 'string') {
        this.data.lastReadId = p.lastReadId;
      }
    } catch {
      // 壊れた保存データは無視して既定値から始める。
    }
  }

  private save(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  works(): Work[] {
    return [...this.data.works].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  get(id: string): Work | null {
    return this.data.works.find((w) => w.id === id) ?? null;
  }

  // 題名・著者は本文の冒頭から拾う。同じ本文の二重登録は拒否する。
  add(text: string): Work {
    const normalized = text.replace(/\r\n?/g, '\n');
    if (normalized.trim() === '') {
      throw new LibraryError('本文が空です');
    }
    if (this.data.works.some((w) => w.text === normalized)) {
      throw new LibraryError('同じ本文の作品がすでに書架にあります');
    }
    const doc = parseAozora(normalized);
    const work: Work = {
      id: makeId(),
      title: doc.title === '' ? '無題' : doc.title,
      author: doc.author,
      text: normalized,
      addedAt: this.now().toISOString(),
    };
    this.data.works.push(work);
    this.save();
    return work;
  }

  remove(id: string): void {
    const before = this.data.works.length;
    this.data.works = this.data.works.filter((w) => w.id !== id);
    if (this.data.works.length === before) {
      throw new LibraryError('対象の作品が見つかりません');
    }
    delete this.data.progress[id];
    delete this.data.bookmarks[id];
    if (this.data.lastReadId === id) this.data.lastReadId = null;
    this.save();
  }

  progress(id: string): number {
    return this.data.progress[id] ?? 0;
  }

  setProgress(id: string, ratio: number): void {
    this.data.progress[id] = Math.min(1, Math.max(0, ratio));
    this.save();
  }

  settings(): Settings {
    return { ...this.data.settings };
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.settings();
  }

  // 最後に開いた作品。書架の「続きから」に使う。削除済みなら無効。
  lastRead(): Work | null {
    if (this.data.lastReadId === null) return null;
    return this.get(this.data.lastReadId);
  }

  setLastRead(id: string): void {
    if (this.get(id) === null) return;
    this.data.lastReadId = id;
    this.save();
  }

  bookmarks(id: string): Bookmark[] {
    return [...(this.data.bookmarks[id] ?? [])].sort((a, b) => a.ratio - b.ratio);
  }

  addBookmark(id: string, ratio: number, label: string): Bookmark {
    if (this.get(id) === null) {
      throw new LibraryError('対象の作品が見つかりません');
    }
    const bookmark: Bookmark = {
      id: makeId(),
      ratio: Math.min(1, Math.max(0, ratio)),
      label,
      createdAt: this.now().toISOString(),
    };
    const list = this.data.bookmarks[id] ?? [];
    list.push(bookmark);
    this.data.bookmarks[id] = list;
    this.save();
    return bookmark;
  }

  removeBookmark(id: string, bookmarkId: string): void {
    const list = this.data.bookmarks[id];
    if (list === undefined) return;
    this.data.bookmarks[id] = list.filter((b) => b.id !== bookmarkId);
    if (this.data.bookmarks[id].length === 0) delete this.data.bookmarks[id];
    this.save();
  }

  // 書架まるごとをJSONで書き出す。端末固有の最後に開いた作品は含めない。
  exportJSON(): string {
    return JSON.stringify(
      {
        version: 1,
        exportedAt: this.now().toISOString(),
        works: this.data.works,
        progress: this.data.progress,
        bookmarks: this.data.bookmarks,
        settings: this.data.settings,
      },
      null,
      2,
    );
  }

  // 書き出したJSONを取り込む。merge は本文が重複しない作品だけ足し、
  // replace は書架を入れ替える。戻り値は新たに追加した作品数。
  importJSON(raw: string, mode: 'merge' | 'replace' = 'merge'): { added: number } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new LibraryError('読み込めるJSONではありません');
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new LibraryError('読み込めるJSONではありません');
    }
    const p = parsed as Record<string, unknown>;
    if (!Array.isArray(p.works)) {
      throw new LibraryError('作品データが見つかりません');
    }
    const works = p.works.map(coerceWork).filter((w): w is Work => w !== null);
    const progress = readRatioMap(p.progress);
    const bookmarks = readBookmarkMap(p.bookmarks);

    if (mode === 'replace') {
      this.data.works = works;
      this.data.progress = progress;
      this.data.bookmarks = bookmarks;
      if (typeof p.settings === 'object' && p.settings !== null) {
        this.data.settings = coerceSettings(p.settings as Record<string, unknown>);
      }
      this.data.lastReadId = null;
      this.save();
      return { added: works.length };
    }

    let added = 0;
    for (const work of works) {
      if (this.data.works.some((w) => w.text === work.text)) continue;
      const id = this.data.works.some((w) => w.id === work.id) ? makeId() : work.id;
      this.data.works.push({ ...work, id });
      const carriedProgress = progress[work.id];
      if (carriedProgress !== undefined) this.data.progress[id] = carriedProgress;
      const carriedBookmarks = bookmarks[work.id];
      if (carriedBookmarks !== undefined) this.data.bookmarks[id] = carriedBookmarks;
      added++;
    }
    this.save();
    return { added };
  }
}

function readRatioMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'number' && v >= 0 && v <= 1) out[k] = v;
  }
  return out;
}

function readBookmarkMap(value: unknown): Record<string, Bookmark[]> {
  const out: Record<string, Bookmark[]> = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [k, v] of Object.entries(value)) {
    if (!Array.isArray(v)) continue;
    const list = v.map(coerceBookmark).filter((b): b is Bookmark => b !== null);
    if (list.length > 0) out[k] = list;
  }
  return out;
}
