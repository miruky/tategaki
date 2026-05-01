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

export type FontFamily = 'mincho' | 'gothic';
export type Theme = 'auto' | 'light' | 'dark' | 'sepia';

export interface Settings {
  font: FontFamily;
  fontSize: number;
  lineHeight: number;
  theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = {
  font: 'mincho',
  fontSize: 18,
  lineHeight: 1.9,
  theme: 'auto',
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
        const s = p.settings as Record<string, unknown>;
        this.data.settings = {
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
          theme:
            s.theme === 'light' || s.theme === 'dark' || s.theme === 'sepia' ? s.theme : 'auto',
        };
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
}
