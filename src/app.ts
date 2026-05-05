// 書架と読書画面。ページ送りは「行送り幅の整数倍」を1ページ幅にする
// ことで、ページ境界で縦の行が裂けないようにしている。

import type { AozoraDoc } from './lib/aozora';
import { parseAozora } from './lib/aozora';
import { decodeAozora } from './lib/encoding';
import type { Bookmark, Library, Settings, Work } from './lib/library';
import { FONT_SIZES, LibraryError, LINE_HEIGHTS } from './lib/library';
import {
  contextSnippet,
  countChars,
  extractHeadings,
  filterWorks,
  flattenDoc,
  remainingMinutes,
  snippetAt,
  splitHighlight,
} from './lib/reading';
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

const THEME_ORDER: Settings['theme'][] = ['auto', 'light', 'sepia', 'dark'];

type Panel = 'settings' | 'search' | 'bookmarks' | 'toc' | null;

export function mountApp(root: HTMLElement, lib: Library): void {
  let currentId: string | null = null;
  let currentDoc: AozoraDoc | null = null;
  let currentChars = 0;
  let docText = '';
  let shelfQuery = '';
  let page = 0;
  let totalPages = 1;
  let pageWidth = 1;
  let openPanel: Panel = null;
  let marks: HTMLElement[] = [];
  let matchSnippets: string[] = [];
  let matchIndex = -1;

  root.innerHTML = `
    <div id="shelf" class="shelf">
      <div class="shell">
        <header class="masthead">
          <div class="brand">
            ${LOGO}
            <div>
              <p class="kicker">青空文庫リーダー</p>
              <h1>tategaki</h1>
              <p class="tagline">縦書きで読む、青空文庫リーダー</p>
            </div>
          </div>
          <div class="masthead-actions">
            <button type="button" id="resume" class="resume" hidden></button>
            <button type="button" id="open-file" class="primary">ファイルを開く</button>
            <button type="button" id="toggle-paste" class="ghost">貼り付け</button>
            <details class="lib-menu">
              <summary class="ghost" aria-label="書架メニュー">…</summary>
              <div class="lib-menu-pop" role="menu">
                <button type="button" id="export-lib" role="menuitem">書架を書き出す</button>
                <button type="button" id="import-lib" role="menuitem">書架を読み込む</button>
                <button type="button" id="show-help" role="menuitem">キーボード操作</button>
              </div>
            </details>
            <input type="file" id="file-input" accept=".txt,text/plain" hidden multiple>
            <input type="file" id="import-input" accept="application/json,.json" hidden>
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
        <div id="shelf-search" class="shelf-search" hidden>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <input type="search" id="shelf-filter" autocomplete="off" placeholder="題名・著者で絞り込む" aria-label="書架を絞り込む">
        </div>
        <ul id="work-list" class="work-list"></ul>
        <div id="shelf-empty" class="shelf-empty" hidden>
          <p>書架は空です。青空文庫のテキストファイル(.txt)を開くか画面へ放り込むか、本文を貼り付けてください。
            まずは収録サンプルで縦書きの組みを確かめられます。</p>
          <button type="button" id="open-sample" class="ghost">サンプル「縦書きのすすめ」を読む</button>
        </div>
        <div id="drop-hint" class="drop-hint" aria-hidden="true">ここに .txt を放す</div>
      </div>
    </div>

    <div id="reader" class="reader" hidden>
      <header class="reader-bar">
        <button type="button" id="back" class="ghost">書架へ</button>
        <div class="reader-head">
          <span id="reader-title"></span><span id="reader-author" class="reader-author"></span>
        </div>
        <div class="reader-tools">
          <button type="button" id="toc-toggle" class="ghost" aria-expanded="false">目次</button>
          <button type="button" id="search-toggle" class="ghost" aria-expanded="false">検索</button>
          <button type="button" id="bookmark-toggle" class="ghost" aria-expanded="false">しおり</button>
          <button type="button" id="settings-toggle" class="ghost" aria-expanded="false">表示</button>
        </div>
      </header>
      <div id="toc-panel" class="panel toc-panel" hidden></div>
      <div id="settings-panel" class="panel settings-panel" hidden></div>
      <div id="search-panel" class="panel search-panel" hidden>
        <div class="search-bar">
          <input type="search" id="search-input" placeholder="本文を検索" aria-label="本文を検索">
          <span id="search-count" class="search-count" aria-live="polite"></span>
          <button type="button" id="search-prev" class="ghost" aria-label="前の一致">前</button>
          <button type="button" id="search-next" class="ghost" aria-label="次の一致">次</button>
        </div>
        <ol id="search-results" class="search-results"></ol>
      </div>
      <div id="bookmark-panel" class="panel bookmark-panel" hidden></div>
      <div id="viewport" class="reader-viewport">
        <div id="content" class="reader-content" data-font="mincho"></div>
        <button type="button" class="page-zone zone-next" aria-label="次のページ"></button>
        <button type="button" class="page-zone zone-prev" aria-label="前のページ"></button>
      </div>
      <footer class="reader-foot">
        <span id="page-indicator" class="page-indicator"></span>
        <input type="range" id="page-slider" min="0" max="0" value="0" aria-label="ページ位置">
        <span id="reading-meta" class="reading-meta"></span>
        <span id="percent" class="percent"></span>
      </footer>
    </div>

    <dialog id="help" class="help">
      <h2>キーボード操作</h2>
      <dl class="help-keys">
        <dt>← / Space</dt><dd>次のページ</dd>
        <dt>→</dt><dd>前のページ</dd>
        <dt>Home / End</dt><dd>最初 / 最後のページ</dd>
        <dt>+ / -</dt><dd>文字を大きく / 小さく</dd>
        <dt>t</dt><dd>配色を切り替え</dd>
        <dt>b</dt><dd>この位置にしおりを挟む</dd>
        <dt>m</dt><dd>目次を開く</dd>
        <dt>/</dt><dd>本文を検索</dd>
        <dt>?</dt><dd>この一覧</dd>
        <dt>Esc</dt><dd>パネルを閉じる / 書架へ</dd>
      </dl>
      <form method="dialog"><button class="ghost">閉じる</button></form>
    </dialog>
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
  const helpDialog = $<HTMLDialogElement>('#help');
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
    content.classList.toggle('no-ruby', !s.ruby);
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
    updateReadingMeta();
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
      ) +
      group('ふりがな', 'ruby', [
        { value: 'on', label: '表示', active: s.ruby },
        { value: 'off', label: '隠す', active: !s.ruby },
      ]);
  }

  function renderResume(): void {
    const last = lib.lastRead();
    const button = $<HTMLButtonElement>('#resume');
    if (last === null) {
      button.hidden = true;
      return;
    }
    button.hidden = false;
    button.innerHTML = `<span class="resume-label">続きから</span><span class="resume-title">${esc(last.title)}</span>`;
    button.dataset.id = last.id;
  }

  function renderShelf(): void {
    const all = lib.works();
    $('#shelf-empty').hidden = all.length > 0;
    // 書架が育ったときだけ絞り込み欄を出す(数冊のうちは不要)。
    $('#shelf-search').hidden = all.length < 5;
    const works = filterWorks(all, shelfQuery);
    if (works.length === 0 && all.length > 0) {
      $('#work-list').innerHTML =
        `<li class="work-empty">「${esc(shelfQuery.trim())}」に一致する作品はありません。</li>`;
      renderResume();
      return;
    }
    $('#work-list').innerHTML = works
      .map((w, i) => {
        const pct = Math.round(lib.progress(w.id) * 100);
        const markCount = lib.bookmarks(w.id).length;
        const markBadge = markCount > 0 ? `<span class="work-marks">しおり${markCount}</span>` : '';
        return `
        <li class="work" style="--i:${Math.min(i, 11)}">
          <button type="button" class="work-open" data-open="${esc(w.id)}">
            <span class="work-title">${esc(w.title)}</span>
            <span class="work-author">${esc(w.author)}</span>
            <span class="work-meta">
              ${markBadge}
              <span class="work-progress"><span class="work-progress-fill" style="width:${pct}%"></span></span>
              ${pct}%
            </span>
          </button>
          <button type="button" class="work-remove" data-remove="${esc(w.id)}">削除</button>
        </li>`;
      })
      .join('');
    renderResume();
  }

  function renderContent(): void {
    if (currentDoc === null) return;
    content.innerHTML = renderDoc(currentDoc);
  }

  function renderBookmarks(): void {
    if (currentId === null) return;
    const list = lib.bookmarks(currentId);
    const items =
      list.length === 0
        ? `<p class="bookmark-empty">しおりはまだありません。「しおりを挟む」で今のページを記録できます。</p>`
        : `<ul class="bookmark-list">${list
            .map(
              (b) => `
            <li class="bookmark">
              <button type="button" class="bookmark-jump" data-jump="${esc(b.id)}">
                <span class="bookmark-pct">${Math.round(b.ratio * 100)}%</span>
                <span class="bookmark-label">${esc(b.label === '' ? '(無題のしおり)' : b.label)}</span>
              </button>
              <button type="button" class="bookmark-del" data-del="${esc(b.id)}" aria-label="このしおりを削除">削除</button>
            </li>`,
            )
            .join('')}</ul>`;
    $('#bookmark-panel').innerHTML =
      `<button type="button" id="drop-bookmark" class="primary bookmark-add">しおりを挟む</button>${items}`;
  }

  function renderToc(): void {
    if (currentDoc === null) return;
    const headings = extractHeadings(currentDoc);
    $('#toc-panel').innerHTML =
      headings.length === 0
        ? `<p class="toc-empty">この作品には見出しがありません。</p>`
        : `<ul class="toc-list">${headings
            .map(
              (h) =>
                `<li class="toc-item toc-l${h.level}"><button type="button" class="toc-jump" data-toc="${h.index}">${esc(h.text)}</button></li>`,
            )
            .join('')}</ul>`;
  }

  function setPanel(next: Panel): void {
    openPanel = openPanel === next ? null : next;
    $('#toc-panel').hidden = openPanel !== 'toc';
    $('#settings-panel').hidden = openPanel !== 'settings';
    $('#search-panel').hidden = openPanel !== 'search';
    $('#bookmark-panel').hidden = openPanel !== 'bookmarks';
    $('#toc-toggle').setAttribute('aria-expanded', String(openPanel === 'toc'));
    $('#settings-toggle').setAttribute('aria-expanded', String(openPanel === 'settings'));
    $('#search-toggle').setAttribute('aria-expanded', String(openPanel === 'search'));
    $('#bookmark-toggle').setAttribute('aria-expanded', String(openPanel === 'bookmarks'));
    if (openPanel === 'toc') renderToc();
    if (openPanel === 'settings') renderSettingsPanel();
    if (openPanel === 'bookmarks') renderBookmarks();
    if (openPanel === 'search') {
      $<HTMLInputElement>('#search-input').focus();
    } else if (marks.length > 0) {
      clearSearch();
    }
  }

  function updateReadingMeta(): void {
    if (currentDoc === null) {
      $('#reading-meta').textContent = '';
      return;
    }
    const remain = remainingMinutes(currentChars, ratio());
    const tail = remain === 0 ? '読了' : `残り約${remain}分`;
    $('#reading-meta').textContent = `${currentChars.toLocaleString('ja-JP')}字 · ${tail}`;
  }

  function dropBookmark(): void {
    if (currentId === null) return;
    const label = snippetAt(docText, ratio());
    lib.addBookmark(currentId, ratio(), label);
    toast('しおりを挟みました');
    if (openPanel === 'bookmarks') renderBookmarks();
  }

  // 検索: いったん素の本文へ戻してから一致箇所を <mark> で包む。
  // ルビの読み(rt)は対象から外し、本文と親文字だけを探す。
  function runSearch(query: string): void {
    renderContent();
    marks = [];
    matchSnippets = [];
    matchIndex = -1;
    if (query !== '') {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          (node.parentElement?.closest('rt') ?? null) === null
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT,
      });
      const needle = query.toLowerCase();
      const targets: Text[] = [];
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        if ((n.textContent ?? '').toLowerCase().includes(needle)) {
          targets.push(n as Text);
        }
      }
      for (const node of targets) {
        const text = node.textContent ?? '';
        const segments = splitHighlight(text, query);
        const frag = document.createDocumentFragment();
        let offset = 0;
        for (const seg of segments) {
          if (seg.hit) {
            const mark = document.createElement('mark');
            mark.className = 'hit';
            mark.textContent = seg.text;
            marks.push(mark);
            const ctx = contextSnippet(text, offset, seg.text.length);
            matchSnippets.push(`${esc(ctx.before)}<mark>${esc(ctx.hit)}</mark>${esc(ctx.after)}`);
            frag.appendChild(mark);
          } else {
            frag.appendChild(document.createTextNode(seg.text));
          }
          offset += seg.text.length;
        }
        node.replaceWith(frag);
      }
    }
    $('#search-count').textContent =
      query === '' ? '' : marks.length === 0 ? '見つかりません' : `${marks.length}件`;
    renderSearchResults();
    if (marks.length > 0) showMatch(0); // 検索直後は先頭の一致へ
  }

  // 検索結果を文脈つきで一覧する。クリックでその一致へ飛べる。
  function renderSearchResults(): void {
    const box = $<HTMLOListElement>('#search-results');
    box.innerHTML = matchSnippets
      .map(
        (html, i) =>
          `<li><button type="button" class="search-hit" data-match="${i}">` +
          `<span class="search-hit-no">${i + 1}</span><span class="search-hit-text">${html}</span></button></li>`,
      )
      .join('');
  }

  function pageOfElement(el: HTMLElement): number {
    const fromStart = content.getBoundingClientRect().right - el.getBoundingClientRect().right;
    const target = Math.floor(fromStart / pageWidth);
    return Math.min(totalPages - 1, Math.max(0, target));
  }

  function showMatch(index: number): void {
    if (marks.length === 0) return;
    matchIndex = ((index % marks.length) + marks.length) % marks.length;
    marks.forEach((m, i) => m.classList.toggle('current', i === matchIndex));
    const items = $('#search-results').querySelectorAll<HTMLElement>('.search-hit');
    items.forEach((el, i) => el.classList.toggle('current', i === matchIndex));
    items[matchIndex]?.scrollIntoView({ block: 'nearest' });
    const mark = marks[matchIndex];
    if (mark !== undefined) {
      goTo(pageOfElement(mark));
      $('#search-count').textContent = `${matchIndex + 1} / ${marks.length}件`;
    }
  }

  function gotoMatch(delta: number): void {
    if (marks.length === 0) return;
    showMatch(matchIndex + delta);
  }

  function clearSearch(): void {
    if (marks.length === 0 && matchIndex === -1) return;
    marks = [];
    matchSnippets = [];
    matchIndex = -1;
    const keep = ratio();
    renderContent();
    paginate(keep);
    $('#search-count').textContent = '';
    $('#search-results').innerHTML = '';
    $<HTMLInputElement>('#search-input').value = '';
  }

  function openWork(work: Work): void {
    currentId = work.id;
    currentDoc = parseAozora(work.text);
    currentChars = countChars(currentDoc);
    docText = flattenDoc(currentDoc);
    marks = [];
    matchIndex = -1;
    lib.setLastRead(work.id);
    $('#reader-title').textContent = work.title;
    $('#reader-author').textContent = work.author === '' ? '' : ` ${work.author}`;
    renderContent();
    applySettings();
    updateReadingMeta();
    openPanel = null;
    $('#toc-panel').hidden = true;
    $('#settings-panel').hidden = true;
    $('#search-panel').hidden = true;
    $('#bookmark-panel').hidden = true;
    shelfEl.hidden = true;
    readerEl.hidden = false;
    const saved = lib.progress(work.id);
    // レイアウト確定後に1度だけ採寸する。
    requestAnimationFrame(() => paginate(saved));
  }

  function closeReader(): void {
    currentId = null;
    currentDoc = null;
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

  function readFiles(files: FileList | File[]): void {
    for (const file of Array.from(files)) {
      void file.arrayBuffer().then((buffer) => {
        addText(decodeAozora(new Uint8Array(buffer)));
      });
    }
  }

  $('#open-file').addEventListener('click', () => {
    $<HTMLInputElement>('#file-input').click();
  });

  $<HTMLInputElement>('#file-input').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (files !== null && files.length > 0) readFiles(files);
    input.value = '';
  });

  $('#shelf-filter').addEventListener('input', (e) => {
    shelfQuery = (e.target as HTMLInputElement).value;
    renderShelf();
  });

  $('#resume').addEventListener('click', () => {
    const id = $<HTMLButtonElement>('#resume').dataset.id ?? '';
    const work = lib.get(id);
    if (work !== null) openWork(work);
  });

  $('#export-lib').addEventListener('click', () => {
    const blob = new Blob([lib.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tategaki-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    $<HTMLDetailsElement>('.lib-menu').open = false;
  });

  $('#import-lib').addEventListener('click', () => {
    $<HTMLInputElement>('#import-input').click();
    $<HTMLDetailsElement>('.lib-menu').open = false;
  });

  $<HTMLInputElement>('#import-input').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    void file.text().then((text) => {
      try {
        const { added } = lib.importJSON(text, 'merge');
        toast(
          added === 0 ? '新しく追加する作品はありませんでした' : `${added}作品を読み込みました`,
        );
        renderShelf();
      } catch (err) {
        toast(err instanceof LibraryError ? err.message : '読み込みに失敗しました');
      }
    });
  });

  $('#show-help').addEventListener('click', () => {
    $<HTMLDetailsElement>('.lib-menu').open = false;
    helpDialog.showModal();
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

  $('#toc-toggle').addEventListener('click', () => setPanel('toc'));
  $('#settings-toggle').addEventListener('click', () => setPanel('settings'));
  $('#search-toggle').addEventListener('click', () => setPanel('search'));
  $('#bookmark-toggle').addEventListener('click', () => setPanel('bookmarks'));

  $('#toc-panel').addEventListener('click', (e) => {
    const jump = (e.target as HTMLElement).closest<HTMLElement>('[data-toc]');
    if (jump === null) return;
    const target = content.querySelector<HTMLElement>(`[data-h="${jump.dataset.toc}"]`);
    if (target !== null) goTo(pageOfElement(target));
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
    if (name === 'ruby') lib.updateSettings({ ruby: value === 'on' });
    renderSettingsPanel();
    applySettings();
    requestAnimationFrame(() => paginate(keep));
  });

  $('#search-input').addEventListener('input', (e) => {
    runSearch((e.target as HTMLInputElement).value.trim());
  });

  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      gotoMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      setPanel('search');
    }
  });

  $('#search-prev').addEventListener('click', () => gotoMatch(-1));
  $('#search-next').addEventListener('click', () => gotoMatch(1));

  $('#search-results').addEventListener('click', (e) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-match]');
    if (hit !== null) showMatch(Number(hit.dataset.match));
  });

  $('#bookmark-panel').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('#drop-bookmark') !== null) {
      dropBookmark();
      return;
    }
    const jump = target.closest<HTMLElement>('[data-jump]');
    if (jump !== null && currentId !== null) {
      const bm = lib.bookmarks(currentId).find((b: Bookmark) => b.id === jump.dataset.jump);
      if (bm !== undefined) goTo(Math.round(bm.ratio * (totalPages - 1)));
      return;
    }
    const del = target.closest<HTMLElement>('[data-del]');
    if (del !== null && currentId !== null) {
      lib.removeBookmark(currentId, del.dataset.del ?? '');
      renderBookmarks();
      renderShelf();
    }
  });

  root.querySelector('.zone-next')?.addEventListener('click', () => goTo(page + 1));
  root.querySelector('.zone-prev')?.addEventListener('click', () => goTo(page - 1));

  slider.addEventListener('input', () => goTo(Number(slider.value)));

  function cycleFontSize(delta: number): void {
    const sizes = FONT_SIZES as readonly number[];
    const at = sizes.indexOf(lib.settings().fontSize);
    const next = sizes[Math.min(sizes.length - 1, Math.max(0, at + delta))];
    if (next === undefined || next === lib.settings().fontSize) return;
    const keep = ratio();
    lib.updateSettings({ fontSize: next });
    applySettings();
    requestAnimationFrame(() => paginate(keep));
  }

  function cycleTheme(): void {
    const at = THEME_ORDER.indexOf(lib.settings().theme);
    const next = THEME_ORDER[(at + 1) % THEME_ORDER.length] ?? 'auto';
    lib.updateSettings({ theme: next });
    applySettings();
    toast(`配色: ${THEME_LABELS[next]}`);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === '?' && !readerEl.hidden) {
      e.preventDefault();
      helpDialog.showModal();
      return;
    }
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
      case '+':
        cycleFontSize(1);
        break;
      case '-':
        cycleFontSize(-1);
        break;
      case 't':
        cycleTheme();
        break;
      case 'b':
        dropBookmark();
        break;
      case 'm':
        setPanel('toc');
        break;
      case '/':
        e.preventDefault();
        if (openPanel !== 'search') setPanel('search');
        else $<HTMLInputElement>('#search-input').focus();
        break;
      case 'Escape':
        if (openPanel !== null) setPanel(openPanel);
        else closeReader();
        break;
    }
  });

  // 書架へのドラッグ&ドロップでファイルを取り込む。
  const dropHint = $('#drop-hint');
  shelfEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropHint.classList.add('show');
  });
  shelfEl.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) dropHint.classList.remove('show');
  });
  shelfEl.addEventListener('drop', (e) => {
    e.preventDefault();
    dropHint.classList.remove('show');
    const files = e.dataTransfer?.files;
    if (files !== undefined && files.length > 0) readFiles(files);
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
