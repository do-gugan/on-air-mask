// On-Air Mask — content script
// 役割: (1) 保存済みルールを <style> として注入  (2) 要素ピッカー  (3) セレクタ候補生成  (4) プレビュー
(() => {
  'use strict';
  if (window.__sbmLoaded) return;
  window.__sbmLoaded = true;

  const K_SESSION = 'sbm:rules';
  const K_SAVED = 'sbm:saved';
  const K_SETTINGS = 'sbm:settings';
  const DEFAULT_SETTINGS = { enabled: true };
  const ORIGIN = self.origin; // about:blank の iframe でも親のオリジンになる
  const IS_TOP = window === window.top;

  const state = { session: [], saved: [], settings: { ...DEFAULT_SETTINGS }, loaded: false, excludeId: null };
  let styleEl = null;
  let previewEl = null;
  let pickStyleEl = null;
  let lastPath = location.pathname;

  // ===================================================================
  // ユーティリティ
  // ===================================================================
  const scratch = document.createDocumentFragment();
  function isValidSelector(sel) {
    if (typeof sel !== 'string' || !sel.trim() || /[{};]/.test(sel)) return false;
    try {
      scratch.querySelector(sel);
      return true;
    } catch {
      return false;
    }
  }
  function countOf(sel) {
    try {
      return document.querySelectorAll(sel).length;
    } catch {
      return -1;
    }
  }
  function whenRoot(cb) {
    if (document.documentElement) return cb();
    const mo = new MutationObserver(() => {
      if (document.documentElement) {
        mo.disconnect();
        cb();
      }
    });
    mo.observe(document, { childList: true });
  }
  function attach(el) {
    const root = document.documentElement;
    if (root && el && el.parentNode !== root) root.appendChild(el);
  }
  function makeStyle(tag) {
    const el = document.createElement('style');
    el.setAttribute('data-sbm', tag);
    return el;
  }

  // ===================================================================
  // 文字単位マスク（CSS Custom Highlight API。DOM は一切書き換えない）
  // ===================================================================
  const HL_OK = typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight === 'function';
  // 文字を持たない要素（入力欄の値や画像など）は Highlight が効かないので、要素ごとマスクする
  const NON_TEXT = ':is(input,textarea,select,img,picture,video,canvas,svg,iframe,object,embed)';
  const TEXT_SKIP = 'script,style,noscript,template,textarea,[data-sbm]';
  const WS = /[\s　]/;
  const PREFS = [
    '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県',
    '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
    '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
    '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
    '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
  ];
  // 先頭の郵便番号（〒・全角数字・各種ハイフン）と空白を読み飛ばす
  const POSTAL_RE = /^(?:〒[\s　]*)?(?:[0-9０-９]{3}[-－ー‐−―][0-9０-９]{4}|[0-9０-９]{7})?[\s　]*/;
  const HONORIFIC_RE = /(?:様|さま|さん|殿|御中)$/;
  const SEG = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;

  function hasKeep(r) {
    return HL_OK && !!r.keep && !!r.keep.type && r.keep.type !== 'none';
  }
  // 文字列中の書記素（絵文字・結合文字を1文字と数える）の開始位置
  function graphemeStarts(str) {
    if (SEG) return [...SEG.segment(str)].map((s) => s.index);
    const out = [];
    for (let i = 0; i < str.length; ) {
      out.push(i);
      i += str.codePointAt(i) > 0xffff ? 2 : 1;
    }
    return out;
  }
  let regexCache = { src: null, re: null };
  function userRegex(src) {
    if (regexCache.src !== src) {
      let re = null;
      try {
        re = src ? new RegExp(src, 'u') : null;
      } catch {}
      regexCache = { src, re };
    }
    return regexCache.re;
  }
  // text の [a, b)（前後の空白を除いた本体）のうち「残す部分」を返す。見つからなければ null
  function findKeep(text, a, b, keep) {
    const body = text.slice(a, b);
    const n = Math.max(0, Math.floor(Number(keep.n) || 0));
    switch (keep.type) {
      case 'head': {
        const g = graphemeStarts(body);
        return [a, n >= g.length ? b : a + g[n]];
      }
      case 'tail': {
        const g = graphemeStarts(body);
        return [n >= g.length ? a : a + g[g.length - n], b];
      }
      case 'honorific': {
        const m = HONORIFIC_RE.exec(body);
        return m ? [a + m.index, b] : null;
      }
      case 'pref': {
        const p = POSTAL_RE.exec(body)[0].length;
        const rest = body.slice(p);
        const hit = PREFS.find((x) => rest.startsWith(x));
        return hit ? [a + p, a + p + hit.length] : null;
      }
      case 'regex': {
        const re = userRegex(keep.pattern);
        const m = re && re.exec(body);
        return m && m[0].length ? [a + m.index, a + m.index + m[0].length] : null;
      }
    }
    return null;
  }
  // マスクする範囲の一覧。判定に失敗したら本体全体をマスクする（隠す側に倒す）
  function maskRanges(text, keep) {
    let a = 0;
    let b = text.length;
    while (a < b && WS.test(text[a])) a++;
    while (b > a && WS.test(text[b - 1])) b--;
    if (a >= b) return { ranges: [], matched: true, empty: true };
    const k = findKeep(text, a, b, keep);
    if (!k) return { ranges: [[a, b]], matched: false };
    const r = [];
    if (k[0] > a) r.push([a, k[0]]);
    if (k[1] < b) r.push([k[1], b]);
    return { ranges: r, matched: true };
  }
  function collectText(el) {
    const segs = [];
    let text = '';
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const v = n.nodeValue;
      if (!v) continue;
      const p = n.parentElement;
      if (!p || p.closest(TEXT_SKIP)) continue;
      segs.push({ node: n, start: text.length, end: text.length + v.length });
      text += v;
    }
    return { segs, text };
  }
  function toRange(segs, s, e) {
    const a = segs.find((x) => s >= x.start && s < x.end);
    const b = segs.find((x) => e > x.start && e <= x.end);
    if (!a || !b) return null;
    const r = new Range();
    r.setStart(a.node, s - a.start);
    r.setEnd(b.node, e - b.start);
    return r;
  }

  let textJobs = []; // { sel, opts, keep, preview }
  let textStyleEl = null;
  const ownHighlights = new Set();
  let lastPreviewStats = null;

  function applyTextMasks() {
    if (!HL_OK) return;
    for (const name of ownHighlights) CSS.highlights.delete(name);
    ownHighlights.clear();
    lastPreviewStats = null;
    const groups = new Map(); // name -> { css, ranges }
    const colorCache = new Map();
    const textColor = (el) => {
      if (!colorCache.has(el)) colorCache.set(el, toOpaqueHex(getComputedStyle(el).color) || '#000000');
      return colorCache.get(el);
    };
    for (const job of textJobs) {
      const stats = { total: 0, matched: 0 };
      let els = [];
      try {
        els = [...document.querySelectorAll(job.sel)].slice(0, 1000);
      } catch {}
      for (const el of els) {
        const { segs, text } = collectText(el);
        if (!segs.length) continue;
        const res = maskRanges(text, job.keep);
        if (res.empty) continue;
        stats.total++;
        if (res.matched) stats.matched++;
        for (const [s, e] of res.ranges) {
          const range = toRange(segs, s, e);
          if (!range) continue;
          let name;
          let css;
          if (job.opts.mode === 'fill') {
            const c = normColor(job.opts.fillColor);
            name = 'sbm-tf-' + c.slice(1);
            // 文字幅ぴったりの帯。文字は透明にして読めなくする
            css = `color:transparent;-webkit-text-fill-color:transparent;text-shadow:none;background-color:${c};`;
          } else {
            const px = Math.max(1, Math.round((Number(job.opts.blurPx) || 0) * 0.6));
            const c = textColor(range.startContainer.parentElement);
            name = `sbm-tb-${px}-${c.slice(1)}`;
            // 文字を透明にし、元の文字色のぼかした影だけを描く（ぼかし風）
            css = `color:transparent;-webkit-text-fill-color:transparent;text-shadow:0 0 ${px}px ${c},0 0 ${px}px ${c};`;
          }
          if (!groups.has(name)) groups.set(name, { css, ranges: [] });
          groups.get(name).ranges.push(range);
        }
      }
      if (job.preview) lastPreviewStats = stats;
    }
    let css = '';
    for (const [name, g] of groups) {
      const hl = new Highlight(...g.ranges);
      hl.priority = 100;
      CSS.highlights.set(name, hl);
      ownHighlights.add(name);
      css += `::highlight(${name}){${g.css}}\n`;
    }
    if (!textStyleEl) textStyleEl = makeStyle('text');
    if (textStyleEl.textContent !== css) textStyleEl.textContent = css;
    attach(textStyleEl);
    syncTextObserver();
  }

  // 中身の書き換えに追従する。MutationObserver のコールバックは描画前に走るので、生の文字は映らない
  let textMO = null;
  function syncTextObserver() {
    const need = textJobs.length > 0;
    if (need && !textMO) {
      textMO = new MutationObserver((records) => {
        for (const r of records) {
          const t = r.target.nodeType === Node.TEXT_NODE ? r.target.parentElement : r.target;
          if (t && t.closest && t.closest('[data-sbm]')) continue; // 自分の要素の変更は無視
          applyTextMasks();
          return;
        }
      });
      textMO.observe(document, { childList: true, characterData: true, subtree: true });
    } else if (!need && textMO) {
      textMO.disconnect();
      textMO = null;
    }
  }

  // ===================================================================
  // マスク適用
  // ===================================================================
  const GRAY = '#808080';
  const DEFAULT_OPTS = { mode: 'blur', blurPx: 12, spreadPx: 16 };

  // 色 → SVG フィルター（feFlood で指定色を流し込み、要素の不透明部分の形で切り抜く）
  const filterColors = new Map(); // id -> color
  let svgEl = null;
  function normColor(c) {
    return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : GRAY;
  }
  function filterIdFor(color) {
    const id = 'sbm-fill-' + color.slice(1);
    filterColors.set(id, color);
    return id;
  }
  function syncFilters() {
    const SVG = 'http://www.w3.org/2000/svg';
    if (!svgEl) {
      svgEl = document.createElementNS(SVG, 'svg');
      svgEl.setAttribute('data-sbm', 'filters');
      svgEl.setAttribute('aria-hidden', 'true');
      svgEl.setAttribute('width', '0');
      svgEl.setAttribute('height', '0');
      // display:none にすると参照先のフィルターが効かない実装があるため、サイズ0で置く
      svgEl.style.cssText =
        'position:absolute!important;width:0!important;height:0!important;overflow:hidden!important;pointer-events:none!important;';
    }
    const want = [...filterColors.keys()].sort().join(',');
    if (svgEl.dataset.ids !== want) {
      svgEl.replaceChildren(
        ...[...filterColors].map(([id, color]) => {
          const f = document.createElementNS(SVG, 'filter');
          f.setAttribute('id', id);
          f.setAttribute('color-interpolation-filters', 'sRGB');
          f.setAttribute('x', '0');
          f.setAttribute('y', '0');
          f.setAttribute('width', '1');
          f.setAttribute('height', '1');
          const flood = document.createElementNS(SVG, 'feFlood');
          flood.setAttribute('flood-color', color);
          flood.setAttribute('result', 'c');
          const comp = document.createElementNS(SVG, 'feComposite');
          comp.setAttribute('in', 'c');
          comp.setAttribute('in2', 'SourceAlpha');
          comp.setAttribute('operator', 'in');
          f.append(flood, comp);
          return f;
        }),
      );
      svgEl.dataset.ids = want;
    }
    if (filterColors.size) attach(svgEl);
  }

  // ルールごとのパラメータ。旧版（全体設定にぼかし量を持っていた頃）のルールはその値で補う
  function optsOf(r) {
    const legacy = state.settings;
    return {
      mode: r.mode === 'fill' ? 'fill' : 'blur',
      blurPx: Number.isFinite(r.blurPx) ? r.blurPx : (legacy.blurPx ?? DEFAULT_OPTS.blurPx),
      spreadPx: Number.isFinite(r.spreadPx) ? r.spreadPx : (legacy.spreadPx ?? DEFAULT_OPTS.spreadPx),
      fillColor: r.fillColor,
    };
  }

  // :is() で包むと不正な部分は無視され、:not(#x) ×2 でページ側の !important より詳細度を上げる
  // プレビューも適用時と同一の描画にする（装飾を足すと filter に巻き込まれて色が滲むため）
  function ruleCss(sel, o, extra = '') {
    const s = `:is(${sel})${extra}:not(#_sbm_):not(#_sbm_)`;
    let d;
    if (o.mode === 'fill') {
      // 塗りつぶしはぼかし・はみ出しを使わず、要素の矩形ぴったりを一色にする。
      // 背景を指定色で不透明にして要素の矩形全体をアルファ1にし、SVG フィルターで指定色一色にする。
      // 文字色の透明化は、万一フィルター参照が外れたときの保険。
      const color = normColor(o.fillColor);
      d =
        `background-color:${color}!important;color:transparent!important;-webkit-text-fill-color:transparent!important;` +
        `filter:url(#${filterIdFor(color)})!important;clip-path:inset(0)!important;`;
    } else {
      const px = Math.max(0, Number(o.blurPx) || 0);
      const spread = Math.max(0, Number(o.spreadPx) | 0);
      // filter の描画は要素の外まで広がるので、切り抜き範囲を外側へ広げるだけで
      // レイアウトを変えずに縁をフェードさせられる（0 なら要素の矩形ぴったり）
      d =
        `filter:blur(${px}px)!important;` +
        `clip-path:inset(${spread ? -spread + 'px' : '0'})!important;`;
    }
    return `${s}{${d}}`;
  }
  function applies(rule) {
    return rule.scope !== 'path' || rule.path === location.pathname;
  }
  let previewSel = null;
  let previewOpts = null;
  function activeRules() {
    if (!state.settings.enabled) return [];
    return [...state.saved, ...state.session]
      .filter(applies)
      .filter((r) => !r.disabled) // 個別にオフにしたマスク
      .filter((r) => r.id !== state.excludeId) // 編集中のルールはプレビューで置き換える
      .filter((r) => isValidSelector(r.selector));
  }
  // 要素単位なら CSS ルール、文字単位なら「文字を持たない要素用の CSS」＋文字範囲のジョブ
  function plan(sel, opts, keep, jobs, preview = false) {
    if (keep && hasKeep({ keep })) {
      jobs.push({ sel, opts, keep, preview });
      return ruleCss(sel, opts, NON_TEXT);
    }
    return ruleCss(sel, opts);
  }
  function render() {
    if (!styleEl) styleEl = makeStyle('rules');
    filterColors.clear();
    const jobs = [];
    const css = activeRules()
      .map((r) => plan(r.selector, optsOf(r), r.keep, jobs))
      .join('\n');
    const pcss = previewSel ? plan(previewSel, previewOpts, previewOpts.keep, jobs, true) : '';
    if (previewEl) previewEl.textContent = pcss;
    syncFilters();
    if (styleEl.textContent !== css) styleEl.textContent = css;
    attach(styleEl);
    textJobs = jobs;
    applyTextMasks();
  }
  let holdReady = false;
  function markReady() {
    if (holdReady) return;
    document.documentElement?.setAttribute('data-sbm-ready', '');
  }
  async function load() {
    try {
      const [s, l] = await Promise.all([
        chrome.storage.session.get(K_SESSION),
        chrome.storage.local.get([K_SAVED, K_SETTINGS]),
      ]);
      state.session = (s[K_SESSION] || {})[ORIGIN] || [];
      state.saved = (l[K_SAVED] || {})[ORIGIN] || [];
      state.settings = { ...DEFAULT_SETTINGS, ...(l[K_SETTINGS] || {}) };
    } catch (e) {
      console.warn('[SBM] load failed', e);
    }
    state.loaded = true;
    render();
    if (textJobs.length && document.readyState === 'loading') {
      // 文字単位マスクは中身ができるまで範囲を決められないので、パース完了まで表示を待つ
      holdReady = true;
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          holdReady = false;
          applyTextMasks();
          markReady();
        },
        { once: true },
      );
    } else {
      markReady(); // ルール適用後にページを表示（guard.css 解除）
    }
  }

  whenRoot(() => {
    render();
    load();
    // ページ側が <html> の子を入れ替えたり属性を消したりしても復帰させる
    const mo = new MutationObserver(() => {
      const root = document.documentElement;
      if (!root) return;
      if (styleEl && styleEl.parentNode !== root) attach(styleEl);
      if (previewEl && previewEl.textContent && previewEl.parentNode !== root) attach(previewEl);
      if (svgEl && filterColors.size && svgEl.parentNode !== root) attach(svgEl);
      if (textStyleEl && textStyleEl.textContent && textStyleEl.parentNode !== root) attach(textStyleEl);
      if (state.loaded && !root.hasAttribute('data-sbm-ready')) markReady();
    });
    mo.observe(document.documentElement, {
      childList: true,
      attributes: true,
      attributeFilter: ['data-sbm-ready'],
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    let dirty = false;
    if (area === 'session' && changes[K_SESSION]) {
      state.session = (changes[K_SESSION].newValue || {})[ORIGIN] || [];
      dirty = true;
    }
    if (area === 'local' && changes[K_SAVED]) {
      state.saved = (changes[K_SAVED].newValue || {})[ORIGIN] || [];
      dirty = true;
    }
    if (area === 'local' && changes[K_SETTINGS]) {
      state.settings = { ...DEFAULT_SETTINGS, ...(changes[K_SETTINGS].newValue || {}) };
      dirty = true;
    }
    if (dirty) render();
  });

  // SPA の pushState 遷移で「このページのみ」ルールを切り替える
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      render();
    }
  }, 300);

  // ===================================================================
  // 塗りつぶし色の解決
  // ===================================================================
  function toOpaqueHex(cssColor) {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,\/]+([\d.]+%?))?\s*\)$/i.exec(cssColor || '');
    if (!m) return null;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]) / (m[4].endsWith('%') ? 100 : 1);
    if (!(a > 0)) return null; // 透明 → さらに上の祖先を見る
    const hex = (v) => Math.round(Math.min(255, parseFloat(v))).toString(16).padStart(2, '0');
    return '#' + hex(m[1]) + hex(m[2]) + hex(m[3]); // 半透明でも不透明扱い（中身を透かさないため）
  }
  // start から祖先方向に、最初に背景色を持つ要素の色を返す
  function effectiveBg(start) {
    for (let e = start; e; e = e.parentElement) {
      const hex = toOpaqueHex(getComputedStyle(e).backgroundColor);
      if (hex) return hex;
    }
    return '#ffffff'; // 何も指定がなければキャンバスの既定色
  }
  function resolveFill(sel, fill) {
    const source = fill?.source || 'gray';
    if (source === 'custom') return normColor(fill.color);
    if (source === 'page') return effectiveBg(document.body || document.documentElement);
    if (source === 'parent') {
      let el = null;
      try {
        el = sel ? document.querySelector(sel) : null;
      } catch {}
      // 文字単位では文字が載っている要素自身の背景、要素単位では親の背景
      const start = fill?.text ? el : el?.parentElement;
      return effectiveBg(start || document.body || document.documentElement);
    }
    return GRAY;
  }

  // ===================================================================
  // プレビュー
  // ===================================================================
  function setPreview(sel, opts) {
    if (!previewEl) previewEl = makeStyle('preview');
    if (sel && isValidSelector(sel)) {
      previewSel = sel;
      previewOpts = { ...DEFAULT_OPTS, ...(opts || {}) };
    } else {
      previewSel = null;
      previewOpts = null;
    }
    render(); // フィルター定義をルールとプレビューの両方からまとめて作り直す
    attach(previewEl);
  }

  // ===================================================================
  // ハイライト（一覧ホバー時に該当箇所を枠で示す。マスク本体とは別レイヤー）
  // ===================================================================
  let hlHost = null;
  let hlRoot = null;
  let hlSel = null;
  let hlLabel = '';
  let hlRaf = 0;
  function drawHighlight() {
    hlRaf = 0;
    if (!hlSel) {
      hlHost?.remove();
      return;
    }
    if (!hlHost) {
      hlHost = document.createElement('div');
      hlHost.setAttribute('data-sbm', 'highlight');
      hlHost.style.cssText =
        'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;';
      hlRoot = hlHost.attachShadow({ mode: 'closed' });
    }
    attach(hlHost);
    let els = [];
    try {
      els = [...document.querySelectorAll(hlSel)].slice(0, 200);
    } catch {}
    const nodes = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const b = document.createElement('div');
      b.style.cssText =
        `position:fixed;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;` +
        'box-sizing:border-box;border:2px solid #d6406a;border-radius:4px;background:rgba(214,64,106,.10);' +
        'box-shadow:0 0 0 9999px rgba(0,0,0,.18);pointer-events:none;';
      nodes.push(b);
    }
    // 複数あるときは暗転を重ねないよう、2個目以降の外側の影は消す
    nodes.slice(1).forEach((b) => (b.style.boxShadow = 'none'));
    if (hlLabel && nodes[0]) {
      const r = els[0].getBoundingClientRect();
      const lbl = document.createElement('div');
      lbl.textContent = hlLabel; // パネルで付けた名前のみ（ページの文字は出さない）
      lbl.style.cssText =
        `position:fixed;left:${Math.max(0, r.left - 3)}px;top:${r.top - 24 < 0 ? r.bottom + 4 : r.top - 24}px;` +
        'font:600 11px/1.6 system-ui,sans-serif;background:#d6406a;color:#fff;padding:0 7px;border-radius:4px;white-space:nowrap;pointer-events:none;';
      nodes.push(lbl);
    }
    hlRoot.replaceChildren(...nodes);
  }
  function scheduleHighlight() {
    if (!hlRaf) hlRaf = requestAnimationFrame(drawHighlight);
  }
  function setHighlight(sel, label) {
    hlSel = sel && isValidSelector(sel) ? sel : null;
    hlLabel = label || '';
    if (hlSel) {
      window.addEventListener('scroll', scheduleHighlight, { capture: true, passive: true });
      window.addEventListener('resize', scheduleHighlight, { passive: true });
    } else {
      window.removeEventListener('scroll', scheduleHighlight, { capture: true });
      window.removeEventListener('resize', scheduleHighlight);
    }
    drawHighlight();
  }

  // ===================================================================
  // セレクタ候補生成
  // ===================================================================
  // Tailwind 等のユーティリティクラス（見た目用で意味を持たない＆広く当たりすぎる）
  // 「接頭辞-スケール値」の形だけをユーティリティとみなす（order-row や text-muted は残す）
  const UTIL_EXACT = new Set([
    'flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents', 'table',
    'hidden', 'relative', 'absolute', 'fixed', 'sticky', 'static', 'container', 'truncate', 'sr-only',
    'antialiased', 'underline', 'uppercase', 'lowercase', 'capitalize', 'italic', 'grow', 'shrink',
    'transform', 'transition', 'rounded', 'border', 'shadow', 'outline', 'ring', 'blur', 'flow-root',
  ]);
  const UTIL_PREFIX =
    /^-?(?:p|m|[pm][xytrblse]|w|h|min-w|max-w|min-h|max-h|size|text|bg|from|via|to|gap|gap-[xy]|items|justify|content|self|place-(?:items|content|self)|col-span|col-start|col-end|row-span|row-start|grid-cols|grid-rows|rounded(?:-[trblse]{1,2})?|border(?:-[xytrblse])?|font|leading|tracking|shadow|opacity|z|top|left|right|bottom|inset(?:-[xy])?|overflow(?:-[xy])?|space-[xy]|divide(?:-[xy])?|ring|cursor|select|whitespace|break|align|line-clamp|decoration|backdrop-\w+|blur|drop-shadow|animate|duration|ease|delay|translate-[xy]|scale(?:-[xy])?|rotate|outline|fill|stroke|object|aspect|basis|flex|grow|shrink)-(.+)$/;
  const UTIL_VALUE =
    /^(?:\d+(?:\.\d+)?|\d+\/\d+|px|auto|full|screen|svh|dvh|min|max|fit|none|xs|sm|base|md|lg|xl|\dxl|center|start|end|between|around|evenly|stretch|baseline|left|right|top|bottom|wrap|nowrap|row|col|row-reverse|col-reverse|hidden|visible|scroll|clip|ellipsis|bold|semibold|medium|light|normal|thin|extralight|extrabold|black|white|transparent|current|inherit|pointer|default|inner|outer|cover|contain|square|video|x|y|t|b|l|r|tight|snug|relaxed|loose|wide|wider|widest|all|colors|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})$/;
  // 状態で値が変わる data 属性（セレクタにすると外れる）
  const VOLATILE_ATTR_RE =
    /^data-(state|active|selected|hover|hovered|focus|focused|focus-visible|open|opened|expanded|checked|disabled|highlighted|index|orientation|side|align|headlessui-state|pressed|visible|loading|dragging|sbm)/;
  const ATTR_PRIORITY = [
    'data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-e2e',
    'data-component', 'data-section', 'name', 'itemprop', 'aria-label', 'role',
  ];
  const STRONG_ATTRS = new Set([
    'data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-e2e', 'name', 'itemprop',
  ]);

  function isHashy(t) {
    if (!t) return true;
    if (/^(css|sc|jsx|emotion|styled|svelte|astro)-/i.test(t)) return true; // CSS-in-JS
    if (/^:|:$/.test(t)) return true;                                       // React useId
    if (/\d{4,}/.test(t)) return true;                                      // 連番・ID
    const tail = t.split('__').pop();
    if (t.includes('__') && tail.length >= 5 && /\d/.test(tail)) return true; // CSS Modules
    const flips = (t.match(/[a-z][0-9]|[0-9][a-z]/gi) || []).length;
    return t.length >= 6 && flips >= 3;                                      // ハッシュっぽい英数混在
  }
  function isUtility(c) {
    if (/[:\[\]\/!@#%(),.]/.test(c)) return true; // hover:… / w-[30px] / w-1/2 など
    if (UTIL_EXACT.has(c)) return true;
    if (/^order-(?:\d+|first|last|none)$/.test(c)) return true;
    if (/^list-(?:none|disc|decimal|inside|outside)$/.test(c)) return true;
    const m = c.match(UTIL_PREFIX);
    return !!m && UTIL_VALUE.test(m[1]);
  }
  function escAttr(v) {
    return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // 要素単体から作れるセレクタ
  function ownSelectors(el) {
    const out = [];
    const tag = el.localName;
    if (el.id && !/\s/.test(el.id) && !isHashy(el.id)) {
      out.push({ sel: '#' + CSS.escape(el.id), kind: 'id', stab: 3 });
    }
    const attrs = [];
    for (const a of el.attributes) {
      const n = a.name;
      const v = a.value;
      const prio = ATTR_PRIORITY.indexOf(n);
      const isData = n.startsWith('data-');
      if (prio < 0 && !isData) continue;
      if (VOLATILE_ATTR_RE.test(n)) continue;
      if (!v || v.length > 40 || /[\n\r]/.test(v) || /^\d+$/.test(v) || isHashy(v)) continue;
      attrs.push({ n, v, prio: prio < 0 ? 99 : prio });
    }
    attrs.sort((a, b) => a.prio - b.prio);
    for (const a of attrs.slice(0, 3)) {
      out.push({
        sel: `${tag}[${a.n}="${escAttr(a.v)}"]`,
        kind: 'attr',
        stab: STRONG_ATTRS.has(a.n) ? 3 : 2,
      });
    }
    const good = [...el.classList].filter((c) => !isHashy(c) && !isUtility(c));
    if (good.length) {
      out.push({ sel: tag + good.map((c) => '.' + CSS.escape(c)).join(''), kind: 'class', stab: 2 });
      let best = null;
      for (const c of good) {
        const n = countOf('.' + CSS.escape(c));
        if (n > 0 && (!best || n < best.n)) best = { c, n };
      }
      if (best) out.push({ sel: '.' + CSS.escape(best.c), kind: 'class', stab: 2 });
    }
    return out;
  }

  // 文書内で一意に特定できる最も近い祖先（文脈セレクタの起点）
  function findAnchor(start) {
    let a = start;
    for (let i = 0; a && i < 12; i++, a = a.parentElement) {
      if (a === document.body || a === document.documentElement) return null;
      for (const c of ownSelectors(a)) {
        if (c.stab >= 2 && countOf(c.sel) === 1) return { el: a, sel: c.sel, stab: c.stab };
      }
    }
    return null;
  }

  // nth-of-type による構造パス（最終手段）
  function structuralPath(el, anchor) {
    const stopEl = anchor ? anchor.el : document.body;
    const parts = [];
    let cur = el;
    for (let i = 0; cur && cur !== stopEl && i < 8; i++) {
      const parent = cur.parentElement;
      if (!parent) return null;
      const same = [...parent.children].filter((c) => c.localName === cur.localName);
      parts.unshift(
        same.length > 1 ? `${cur.localName}:nth-of-type(${same.indexOf(cur) + 1})` : cur.localName,
      );
      cur = parent;
    }
    if (cur !== stopEl || !parts.length) return null;
    return `${anchor ? anchor.sel : 'body'} > ${parts.join(' > ')}`;
  }

  function candidatesFor(el) {
    const raw = [];
    const own = ownSelectors(el);
    raw.push(...own);

    const anchor = findAnchor(el.parentElement);
    if (anchor) {
      const locals = own.filter((c) => c.kind === 'class').map((c) => c.sel);
      if (!locals.length) locals.push(el.localName);
      for (const l of locals.slice(0, 2)) {
        raw.push({ sel: `${anchor.sel} ${l}`, kind: 'context', stab: Math.min(anchor.stab, 2) });
      }
    }
    const path = structuralPath(el, anchor);
    if (path) raw.push({ sel: path, kind: 'path', stab: 0 });

    const seen = new Set();
    const out = [];
    for (const c of raw) {
      if (seen.has(c.sel) || !isValidSelector(c.sel)) continue;
      seen.add(c.sel);
      let hit = false;
      try {
        hit = el.matches(c.sel);
      } catch {}
      if (!hit) continue;
      out.push({ ...c, count: countOf(c.sel) });
    }
    out.sort((a, b) => b.stab - a.stab || a.count - b.count);
    return out;
  }

  function buildLevels(target) {
    const levels = [];
    let el = target;
    for (let i = 0; el && i < 7; i++) {
      if (el === document.documentElement || el === document.body) break;
      const r = el.getBoundingClientRect();
      levels.push({
        tag: el.localName,
        w: Math.round(r.width),
        h: Math.round(r.height),
        candidates: candidatesFor(el),
      });
      el = el.parentElement;
    }
    return levels;
  }

  // ===================================================================
  // ピッカー（トップフレームのみ）
  // ===================================================================
  let picking = false;
  let hoverEl = null;
  let ovHost = null;
  let ovBox = null;
  let ovLbl = null;
  let panelPort = null;
  let pendingMsg = null;
  const BLOCK_EVENTS = [
    'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu',
  ];

  function ensureOverlay() {
    if (ovHost) {
      attach(ovHost);
      return;
    }
    ovHost = document.createElement('div');
    ovHost.setAttribute('data-sbm', 'overlay');
    ovHost.style.cssText =
      'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;';
    const sr = ovHost.attachShadow({ mode: 'closed' });
    ovBox = document.createElement('div');
    ovBox.style.cssText =
      'position:fixed;box-sizing:border-box;border:2px solid #d6406a;background:rgba(214,64,106,.12);pointer-events:none;';
    ovLbl = document.createElement('div');
    ovLbl.style.cssText =
      'position:fixed;font:11px/1.5 ui-monospace,Menlo,monospace;background:#d6406a;color:#fff;padding:0 6px;border-radius:3px;white-space:nowrap;pointer-events:none;';
    sr.append(ovBox, ovLbl);
    attach(ovHost);
  }
  function positionOverlay() {
    if (!hoverEl || !ovBox) return;
    const r = hoverEl.getBoundingClientRect();
    Object.assign(ovBox.style, {
      left: r.left + 'px',
      top: r.top + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
    });
    // 中身のテキストは出さない（ラベル自体が配信に映るため）
    ovLbl.textContent = `${hoverEl.localName}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    const top = r.top - 20 < 0 ? r.bottom + 2 : r.top - 20;
    Object.assign(ovLbl.style, { left: Math.max(0, r.left) + 'px', top: top + 'px' });
  }
  function onMove(e) {
    const t = e.target;
    if (!(t instanceof Element) || t === ovHost) return;
    hoverEl = t;
    ensureOverlay();
    positionOverlay();
  }
  function onBlock(e) {
    if (!picking) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click') {
      const t = e.target instanceof Element && e.target !== ovHost ? e.target : hoverEl;
      if (t) choose(t);
    }
  }
  function onKey(e) {
    if (!picking || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stopPick();
    post({ type: 'sbm:pickCancelled' });
  }
  function onScroll() {
    positionOverlay();
  }

  function startPick() {
    if (picking || !IS_TOP) return;
    picking = true;
    window.addEventListener('mousemove', onMove, true);
    for (const t of BLOCK_EVENTS) window.addEventListener(t, onBlock, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    if (!pickStyleEl) pickStyleEl = makeStyle('pick');
    pickStyleEl.textContent = '*{cursor:crosshair!important}';
    attach(pickStyleEl);
  }
  function stopPick() {
    if (!picking) return;
    picking = false;
    window.removeEventListener('mousemove', onMove, true);
    for (const t of BLOCK_EVENTS) window.removeEventListener(t, onBlock, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, { capture: true });
    if (pickStyleEl) pickStyleEl.textContent = '';
    ovHost?.remove();
    hoverEl = null;
  }
  function choose(el) {
    stopPick();
    let levels = buildLevels(el);
    if (!levels.length) levels = [{ tag: el.localName, w: 0, h: 0, candidates: [] }];
    post({ type: 'sbm:picked', origin: ORIGIN, path: location.pathname, levels });
  }
  function post(msg) {
    if (panelPort) {
      try {
        panelPort.postMessage(msg);
        return;
      } catch {}
    }
    pendingMsg = msg; // パネル未接続（ショートカット起動直後など）なら接続時に送る
  }

  // ===================================================================
  // パネルとの通信
  // ===================================================================
  if (IS_TOP) {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== 'sbm-panel') return;
      panelPort = port;
      if (pendingMsg) {
        port.postMessage(pendingMsg);
        pendingMsg = null;
      }
      // パネルが閉じた／別タブに移った → プレビューと選択モードを片付ける
      port.onDisconnect.addListener(() => {
        if (panelPort !== port) return;
        panelPort = null;
        state.excludeId = null;
        setHighlight(null);
        setPreview(null);
        stopPick();
      });
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      switch (msg?.type) {
        case 'sbm:info':
          sendResponse({ origin: ORIGIN, path: location.pathname, picking });
          break;
        case 'sbm:startPick':
          startPick();
          sendResponse({ ok: true });
          break;
        case 'sbm:stopPick':
          stopPick();
          sendResponse({ ok: true });
          break;
        case 'sbm:preview': {
          // msg.opts = { mode, blurPx, spreadPx }, msg.fill = { source, color }
          const ok = !!msg.selector && isValidSelector(msg.selector);
          const opts = { ...DEFAULT_OPTS, ...(msg.opts || {}) };
          const color = ok && opts.mode === 'fill' ? resolveFill(msg.selector, msg.fill) : null;
          setPreview(ok ? msg.selector : null, { ...opts, fillColor: color, keep: msg.keep || null });
          sendResponse({
            count: ok ? countOf(msg.selector) : -1,
            color,
            keepStats: ok && msg.keep && hasKeep({ keep: msg.keep }) ? lastPreviewStats : null,
            keepSupported: HL_OK,
          });
          break;
        }
        case 'sbm:highlight':
          setHighlight(msg.selector, msg.label);
          sendResponse({ count: msg.selector && isValidSelector(msg.selector) ? countOf(msg.selector) : -1 });
          break;
        case 'sbm:inspect': {
          // 適用済みルールの編集開始: そのルールを一時的に外し、最初に一致する要素から候補を作る
          state.excludeId = msg.excludeId || null;
          let el = null;
          try {
            el = msg.selector ? document.querySelector(msg.selector) : null;
          } catch {}
          const levels = el ? buildLevels(el) : [];
          render();
          sendResponse({ levels, count: msg.selector && isValidSelector(msg.selector) ? countOf(msg.selector) : -1 });
          break;
        }
        case 'sbm:endEdit':
          state.excludeId = null;
          render();
          sendResponse({ ok: true });
          break;
        case 'sbm:resolveFill':
          sendResponse({ color: resolveFill(msg.selector, msg.fill) });
          break;
        case 'sbm:count':
          sendResponse({
            counts: (msg.selectors || []).map((s) => (isValidSelector(s) ? countOf(s) : -1)),
          });
          break;
        default:
          return; // 未知のメッセージには応答しない
      }
    });
  }
})();
