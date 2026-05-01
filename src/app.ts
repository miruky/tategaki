// 書架と読書画面。ページ送りは「行送り幅の整数倍」を1ページ幅にする
// ことで、ページ境界で縦の行が裂けないようにしている。

import { parseAozora } from './lib/aozora';
import { decodeAozora } from './lib/encoding';
import type { Library, Settings, Work } from './lib/library';
import { FONT_SIZES, LibraryError, LINE_HEIGHTS } from './lib/library';
import { escapeHtml, renderDoc } from './lib/render';
import { SAMPLE_TEXT } from './lib/sample';

const esc = escapeHtml;

const LOGO = `
<svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
  <rect x="8" y="8" width="48" height="48" rx="6" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M42 16v32M30 16v22M18 16v12" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/>
</svg>`;

const FONT_LABELS: Record<Settings['font'], string> = {
  mincho: '明朝',
  gothic: 'ゴシック',
};

const SIZE_LABELS: Record<number, string> = {
  16: '小',
  18: '中',
  20: '大',
  23: '特大',
};

const LINE_LABELS: Record<number, string> = {
  1.7: 'つめる',
  1.9: '標準',
  2.1: 'ゆったり',
};

const THEME_LABELS: Record<Settings['theme'], string> = {
  auto: '自動',
  light: 'ライト',
  dark: 'ダーク',
  sepia: 'セピア',
};

export function mountApp(root: HTMLElement, lib: Library): void {
  let currentId: string | null = null;
  let page = 0;
  let totalPages = 1;
  let pageWidth = 1;

  root.innerHTML = `
    <div id="shelf" class="shelf">
      <div class="shell">
        <header class="masthead">
          <div class="brand">
            ${LOGO}
            <div>
              <h1>tategaki</h1>
              <p class="tagline">縦書きで読む、青空文庫リーダー</p>
            </div>
          </div>
          <div class="masthead-actions">
            <button type="button" id="open-file" class="primary">ファイルを開く</button>
            <button type="button" id="toggle-paste" class="ghost">貼り付けて追加</button>
            <input type="file" id="file-input" accept=".txt,text/plain" hidden>
          </div>
        </header>
        <div id="paste-panel" class="paste-panel" hidden>
          <textarea id="paste-text" rows="8"
            placeholder="青空文庫形式のテキストを貼り付けてください(1行目が題名、2行目が著者として扱われます)"></textarea>
          <div class="paste-actions">
            <button type="button" id="paste-add" class="primary">書架に追加</button>
            <button type="button" id="paste-cancel" class="ghost">閉じる</button>
          </div>
        </div>
        <ul id="work-list" class="work-list"></ul>
        <div id="shelf-empty" class="shelf-empty" hidden>
          <p>書架は空です。青空文庫のテキストファイル(.txt)を開くか、本文を貼り付けてください。
            まずは収録サンプルで縦書きの組みを確かめられます。</p>
          <button type="button" id="open-sample" class="ghost">サンプル「縦書きのすすめ」を読む</button>
        </div>
      </div>
    </div>

    <div id="reader" class="reader" hidden>
      <header class="reader-bar">
        <button type="button" id="back" class="ghost">書架へ</button>
        <div class="reader-head">
          <span id="reader-title"></span><span id="reader-author" class="reader-author"></span>
        </div>
        <button type="button" id="settings-toggle" class="ghost" aria-expanded="false">表示</button>
      </header>
      <div id="settings-panel" class="settings-panel" hidden></div>
      <div id="viewport" class="reader-viewport">
        <div id="content" class="reader-content" data-font="mincho"></div>
        <button type="button" class="page-zone zone-next" aria-label="次のページ"></button>
        <button type="button" class="page-zone zone-prev" aria-label="前のページ"></button>
      </div>
      <footer class="reader-foot">
        <span id="page-indicator" class="page-indicator"></span>
        <input type="range" id="page-slider" min="0" max="0" value="0" aria-label="ページ位置">
        <span id="percent" class="percent"></span>
      </footer>
    </div>
    <div id="toast" role="status" aria-live="polite"></div>`;

  const $ = <T extends HTMLElement>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (node === null) throw new Error(`要素が見つからない: ${selector}`);
    return node;
  };

  const shelfEl = $('#shelf');
  const readerEl = $('#reader');
  const viewport = $('#viewport');
  const content = $('#content');
  const slider = $<HTMLInputElement>('#page-slider');
  const toastBox = $('#toast');
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function toast(message: string): void {
    toastBox.textContent = message;
    toastBox.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastBox.classList.remove('show'), 3500);
  }

  function applyTheme(): void {
    const theme = lib.settings().theme;
    if (theme === 'auto') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
  }

  function applySettings(): void {
    const s = lib.settings();
    content.dataset.font = s.font;
    content.style.fontSize = `${s.fontSize}px`;
    content.style.lineHeight = String(s.lineHeight);
    applyTheme();
  }

  // 進捗は「最後のページで1」になる割合で保存する。
  function ratio(): number {
    return totalPages <= 1 ? 1 : page / (totalPages - 1);
  }

  function goTo(target: number, save = true): void {
    page = Math.min(totalPages - 1, Math.max(0, target));
    content.style.transform = `translateX(${page * pageWidth}px)`;
    $('#page-indicator').textContent = `${page + 1} / ${totalPages}`;
    $('#percent').textContent = `${Math.round(ratio() * 100)}%`;
    slider.max = String(totalPages - 1);
    slider.value = String(page);
    if (save && currentId !== null) {
      lib.setProgress(currentId, ratio());
    }
  }

  // CSSの .reader-content の右余白40pxと対になる左右マージン。
  const H_MARGIN = 40;

  function paginate(keepRatio: number): void {
    const lineHeight = parseFloat(getComputedStyle(content).lineHeight);
    const advance = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 36;
    const available = Math.max(advance, viewport.clientWidth - H_MARGIN * 2);
    // 1ページ幅を行送りの整数倍にして、ページ境界で行が裂けないようにする。
    pageWidth = Math.max(advance, Math.floor(available / advance) * advance);
    const contentWidth = content.scrollWidth;
    totalPages = Math.max(1, Math.ceil(contentWidth / pageWidth));
    goTo(Math.round(keepRatio * (totalPages - 1)), false);
  }

  function renderSettingsPanel(): void {
    const s = lib.settings();
    const group = (
      label: string,
      name: string,
      options: { value: string; label: string; active: boolean }[],
    ) => `
      <div class="setting-group" role="group" aria-label="${label}">
        <span class="setting-label">${label}</span>
        ${options
          .map(
            (o) =>
              `<button type="button" data-setting="${name}" data-value="${o.value}"
                class="setting-option${o.active ? ' active' : ''}" aria-pressed="${o.active}">${o.label}</button>`,
          )
          .join('')}
      </div>`;
    $('#settings-panel').innerHTML =
      group(
        '書体',
        'font',
        (Object.keys(FONT_LABELS) as Settings['font'][]).map((f) => ({
          value: f,
          label: FONT_LABELS[f],
          active: s.font === f,
        })),
      ) +
      group(
        '文字',
        'fontSize',
        FONT_SIZES.map((n) => ({
          value: String(n),
          label: SIZE_LABELS[n] ?? String(n),
          active: s.fontSize === n,
        })),
      ) +
      group(
        '行間',
        'lineHeight',
        LINE_HEIGHTS.map((n) => ({
          value: String(n),
          label: LINE_LABELS[n] ?? String(n),
          active: s.lineHeight === n,
        })),
      ) +
      group(
        '配色',
        'theme',
        (Object.keys(THEME_LABELS) as Settings['theme'][]).map((t) => ({
          value: t,
          label: THEME_LABELS[t],
          active: s.theme === t,
        })),
      );
  }

  function renderShelf(): void {
    const works = lib.works();
    $('#shelf-empty').hidden = works.length > 0;
    $('#work-list').innerHTML = works
      .map((w, i) => {
        const pct = Math.round(lib.progress(w.id) * 100);
        return `
        <li class="work" style="--i:${Math.min(i, 11)}">
          <button type="button" class="work-open" data-open="${esc(w.id)}">
            <span class="work-title">${esc(w.title)}</span>
            <span class="work-author">${esc(w.author)}</span>
            <span class="work-meta">
              <span class="work-progress"><span class="work-progress-fill" style="width:${pct}%"></span></span>
              ${pct}%
            </span>
          </button>
          <button type="button" class="work-remove" data-remove="${esc(w.id)}">削除</button>
        </li>`;
      })
      .join('');
  }

  function openWork(work: Work): void {
    currentId = work.id;
    $('#reader-title').textContent = work.title;
    $('#reader-author').textContent = work.author === '' ? '' : ` ${work.author}`;
    content.innerHTML = renderDoc(parseAozora(work.text));
    applySettings();
    shelfEl.hidden = true;
    readerEl.hidden = false;
    const saved = lib.progress(work.id);
    // レイアウト確定後に1度だけ採寸する。
    requestAnimationFrame(() => paginate(saved));
  }

  function closeReader(): void {
    currentId = null;
    readerEl.hidden = true;
    shelfEl.hidden = false;
    renderShelf();
  }

  function addText(text: string): void {
    try {
      const work = lib.add(text);
      toast(`「${work.title}」を書架に追加しました`);
      renderShelf();
      openWork(work);
    } catch (e) {
      toast(e instanceof LibraryError ? e.message : '追加に失敗しました');
    }
  }

  $('#open-file').addEventListener('click', () => {
    $<HTMLInputElement>('#file-input').click();
  });

  $<HTMLInputElement>('#file-input').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    void file.arrayBuffer().then((buffer) => {
      addText(decodeAozora(new Uint8Array(buffer)));
    });
  });

  $('#toggle-paste').addEventListener('click', () => {
    const panel = $('#paste-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) $<HTMLTextAreaElement>('#paste-text').focus();
  });

  $('#paste-cancel').addEventListener('click', () => {
    $('#paste-panel').hidden = true;
  });

  $('#paste-add').addEventListener('click', () => {
    const textarea = $<HTMLTextAreaElement>('#paste-text');
    addText(textarea.value);
    textarea.value = '';
    $('#paste-panel').hidden = true;
  });

  $('#open-sample').addEventListener('click', () => {
    const existing = lib.works().find((w) => w.title === '縦書きのすすめ');
    if (existing !== undefined) {
      openWork(existing);
    } else {
      addText(SAMPLE_TEXT);
    }
  });

  $('#work-list').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const open = target.closest<HTMLElement>('[data-open]');
    if (open !== null) {
      const work = lib.get(open.dataset.open ?? '');
      if (work !== null) openWork(work);
      return;
    }
    const remove = target.closest<HTMLElement>('[data-remove]');
    if (remove !== null) {
      if (remove.dataset.armed === undefined) {
        remove.dataset.armed = '1';
        remove.textContent = '本当に削除';
        return;
      }
      lib.remove(remove.dataset.remove ?? '');
      toast('書架から削除しました');
      renderShelf();
    }
  });

  $('#back').addEventListener('click', closeReader);

  $('#settings-toggle').addEventListener('click', () => {
    const panel = $('#settings-panel');
    panel.hidden = !panel.hidden;
    $('#settings-toggle').setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) renderSettingsPanel();
  });

  $('#settings-panel').addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-setting]');
    if (button === null) return;
    const name = button.dataset.setting ?? '';
    const value = button.dataset.value ?? '';
    const keep = ratio();
    if (name === 'font') lib.updateSettings({ font: value as Settings['font'] });
    if (name === 'fontSize') lib.updateSettings({ fontSize: Number(value) });
    if (name === 'lineHeight') lib.updateSettings({ lineHeight: Number(value) });
    if (name === 'theme') lib.updateSettings({ theme: value as Settings['theme'] });
    renderSettingsPanel();
    applySettings();
    requestAnimationFrame(() => paginate(keep));
  });

  root.querySelector('.zone-next')?.addEventListener('click', () => goTo(page + 1));
  root.querySelector('.zone-prev')?.addEventListener('click', () => goTo(page - 1));

  slider.addEventListener('input', () => goTo(Number(slider.value)));

  document.addEventListener('keydown', (e) => {
    if (readerEl.hidden) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.type !== 'range') return;
    if (active instanceof HTMLTextAreaElement) return;
    switch (e.key) {
      case 'ArrowLeft':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        goTo(page + 1);
        break;
      case 'ArrowRight':
      case 'PageUp':
        e.preventDefault();
        goTo(page - 1);
        break;
      case 'Home':
        goTo(0);
        break;
      case 'End':
        goTo(totalPages - 1);
        break;
      case 'Escape':
        closeReader();
        break;
    }
  });

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('resize', () => {
    if (readerEl.hidden) return;
    clearTimeout(resizeTimer);
    const keep = ratio();
    resizeTimer = setTimeout(() => paginate(keep), 150);
  });

  applyTheme();
  renderShelf();
}
