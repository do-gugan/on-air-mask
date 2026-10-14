// On-Air Mask — side panel
const K_SESSION = 'sbm:rules';
const K_SAVED = 'sbm:saved';
const K_SETTINGS = 'sbm:settings';
const K_LAST = 'sbm:lastOpts';
const GRAY = '#808080';
const DEFAULT_SETTINGS = { enabled: true };
// 新規マスクの初期値（前回の適用時の値で上書きされる）
const DEFAULT_DRAFT = {
  mode: 'blur',
  blurPx: 12,
  spreadPx: 16,
  fillSource: 'gray',
  customColor: '#000000',
  scope: 'site',
  persist: false,
  // 文字単位（一部を残す）。前回値は引き継がず、新規は常に「要素全体」から始める
  target: 'element',
  keepType: 'pref',
  keepN: 1,
  keepPattern: '',
};
const KEEP_FIELDS = ['target', 'keepType', 'keepN', 'keepPattern'];
// ===================================================================
// 多言語化
// 文言は _locales/<言語>/messages.json にあり、ブラウザの表示言語で自動的に選ばれる。
// 翻訳がない言語・キーは manifest の default_locale（en）にフォールバックする。
// ===================================================================
function t(key, subs) {
  const s = chrome.i18n.getMessage(key, subs === undefined ? undefined : [].concat(subs).map(String));
  return s || key;
}
function localize(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  document.documentElement.lang = chrome.i18n.getUILanguage?.() || document.documentElement.lang;
}

const KEEP_LABEL = {
  pref: () => t('keepBadgePref'),
  honorific: () => t('keepBadgeHonorific'),
  head: (n) => t('keepBadgeHead', n),
  tail: (n) => t('keepBadgeTail', n),
  regex: () => t('keepBadgeRegex'),
};
function regexError(src) {
  if (!src) return t('regexEmpty');
  try {
    new RegExp(src, 'u');
    return null;
  } catch {
    return t('regexInvalid');
  }
}
function keepSpec(d) {
  if (d.target !== 'partial') return null;
  const k = { type: d.keepType };
  if (d.keepType === 'head' || d.keepType === 'tail') k.n = Math.max(1, Math.floor(Number(d.keepN) || 1));
  if (d.keepType === 'regex') k.pattern = d.keepPattern;
  return k;
}

const $ = (id) => document.getElementById(id);
const S = {
  tabId: null,
  origin: null,
  path: null,
  port: null,
  picking: false,
  settings: { ...DEFAULT_SETTINGS },
  legacy: { blurPx: 12, spreadPx: 16 }, // 旧版の全体設定（パラメータを持たない古いルール用）
  last: { ...DEFAULT_DRAFT },
  // 編集枠
  open: false,
  editing: null, // 既存ルールの編集中ならそのルール（saved フラグ付き）
  levels: [],
  li: 0,
  ci: -1, // -1 = 候補ではなくセレクタ欄の値を使っている
  draft: { name: '', selector: '', ...DEFAULT_DRAFT },
};

// 外部リンク（空文字なら非表示）。公開時に URL を入れる
const LINKS = {
  repo: 'https://github.com/do-gugan/on-air-mask',
  donate: 'https://donate.stripe.com/3cIbJ3cpt9i25yr6ka5Rm0s',
};

// 小さな DOM ヘルパー（ページ由来の文字列は必ず textContent で入れる）
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

// ===================================================================
// タブとの通信
// ===================================================================
function send(msg) {
  if (S.tabId == null) return Promise.reject(new Error('no tab'));
  return chrome.tabs.sendMessage(S.tabId, msg, { frameId: 0 });
}
async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

let refreshToken = 0;
async function refresh() {
  const token = ++refreshToken;
  const tab = await activeTab();
  if (token !== refreshToken) return;

  closeEditor(false);
  if (S.port) {
    try { S.port.disconnect(); } catch {}
    S.port = null;
  }
  S.tabId = tab?.id ?? null;

  let info = null;
  if (S.tabId != null) {
    try { info = await send({ type: 'sbm:info' }); } catch {}
  }
  if (token !== refreshToken) return;

  if (!info) {
    S.origin = null;
    $('unavailable').hidden = false;
    $('main').hidden = true;
    $('origin').textContent = '—';
    updateDot();
    return;
  }
  $('unavailable').hidden = true;
  $('main').hidden = false;
  S.origin = info.origin;
  S.path = info.path;
  $('origin').textContent = info.origin;
  setPicking(!!info.picking);

  S.port = chrome.tabs.connect(S.tabId, { frameId: 0, name: 'sbm-panel' });
  S.port.onMessage.addListener(onPortMessage);
  const port = S.port;
  S.port.onDisconnect.addListener(() => {
    if (S.port === port) S.port = null;
  });
  updateDot();
  renderRules();
}

function onPortMessage(msg) {
  if (msg.type === 'sbm:picked') {
    setPicking(false);
    S.path = msg.path;
    if (!S.open) openEditor(null); // 新規
    S.levels = msg.levels || [];
    S.li = 0;
    S.ci = S.levels[0]?.candidates?.length ? 0 : -1;
    if (S.ci >= 0) S.draft.selector = currentCand().sel;
    renderEditor();
    preview();
    window.focus(); // キー操作をすぐ受けられるように
  } else if (msg.type === 'sbm:pickCancelled') {
    setPicking(false);
  }
}

chrome.tabs.onActivated.addListener(() => refresh());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId !== S.tabId) return;
  if (info.status === 'complete') {
    refresh();
  } else if (info.url) {
    // SPA 遷移: 作業中の編集は維持し、件数だけ更新
    try { S.path = new URL(info.url).pathname; } catch {}
    renderRules();
  }
});
// OBS などに切り替えて戻ってきただけなら作業中の編集は維持する
chrome.windows.onFocusChanged.addListener(async () => {
  const t = await activeTab();
  if (t?.id !== S.tabId) refresh();
});

// ===================================================================
// 要素選択
// ===================================================================
function setPicking(on) {
  S.picking = on;
  const b = $('pickBtn');
  b.textContent = on ? t('pickActive') : t('pickStart');
  b.classList.toggle('active', on);
}
async function startPick() {
  try {
    await send({ type: 'sbm:startPick' });
    setPicking(true);
  } catch {
    refresh();
  }
}
$('pickBtn').addEventListener('click', async () => {
  if (S.picking) {
    await send({ type: 'sbm:stopPick' }).catch(() => {});
    setPicking(false);
    return;
  }
  // 既存ルールの編集中なら閉じてから新規の選択に入る
  if (S.editing) closeEditor(true);
  startPick();
});
$('repickBtn').addEventListener('click', startPick);
$('manualBtn').addEventListener('click', () => {
  if (S.editing) closeEditor(true);
  if (!S.open) openEditor(null);
  renderEditor();
  $('selector').focus();
});

// ===================================================================
// 編集枠
// ===================================================================
function draftFromRule(r) {
  return {
    name: r.name || '',
    selector: r.selector,
    mode: r.mode === 'fill' ? 'fill' : 'blur',
    blurPx: Number.isFinite(r.blurPx) ? r.blurPx : S.legacy.blurPx,
    spreadPx: Number.isFinite(r.spreadPx) ? r.spreadPx : S.legacy.spreadPx,
    fillSource: r.fillSource || 'gray',
    customColor: r.fillSource === 'custom' && isHex(r.fillColor) ? r.fillColor : S.last.customColor,
    scope: r.scope === 'path' ? 'path' : 'site',
    persist: !!r.saved,
    target: r.keep?.type ? 'partial' : 'element',
    keepType: r.keep?.type || DEFAULT_DRAFT.keepType,
    keepN: r.keep?.n ?? DEFAULT_DRAFT.keepN,
    keepPattern: r.keep?.pattern || '',
  };
}

function openEditor(rule) {
  S.open = true;
  S.editing = rule;
  S.levels = [];
  S.li = 0;
  S.ci = -1;
  S.draft = rule ? draftFromRule(rule) : { name: '', selector: '', ...S.last, ...Object.fromEntries(KEEP_FIELDS.map((k) => [k, DEFAULT_DRAFT[k]])) };
  renderEditor();
}

function closeEditor(clearPreview = true) {
  if (!S.open) return;
  const wasEditing = !!S.editing;
  S.open = false;
  S.editing = null;
  S.levels = [];
  renderEditor();
  if (S.tabId != null) {
    // 編集中ルールの復帰 → プレビュー解除の順（マスクが一瞬も外れないように）
    if (wasEditing) send({ type: 'sbm:endEdit' }).catch(() => {});
    if (clearPreview) send({ type: 'sbm:preview', selector: null }).catch(() => {});
  }
  renderRules();
}

async function editRule(r) {
  if (S.picking) {
    await send({ type: 'sbm:stopPick' }).catch(() => {});
    setPicking(false);
  }
  openEditor(r);
  let res = { levels: [], count: -1 };
  try {
    res = await send({ type: 'sbm:inspect', selector: r.selector, excludeId: r.id });
  } catch {}
  if (S.editing?.id !== r.id) return; // 待っている間に別の操作をされた
  const levels = res.levels || [];
  // 今のセレクタが候補にあればそこを選択。なければ候補は選ばずセレクタ欄の値を使う
  let li = 0;
  let ci = -1;
  levels.some((lv, i) => {
    const j = lv.candidates.findIndex((c) => c.sel === r.selector);
    if (j >= 0) [li, ci] = [i, j];
    return j >= 0;
  });
  S.levels = levels;
  S.li = li;
  S.ci = ci;
  renderEditor();
  preview();
  renderRules();
}

function currentCand() {
  return S.ci >= 0 ? (S.levels[S.li]?.candidates?.[S.ci] ?? null) : null;
}

function countBadge(n) {
  if (n < 0) return h('span', { class: 'badge bad' }, t('countInvalid'));
  if (n === 0) return h('span', { class: 'badge zero' }, t('countZero'));
  if (n === 1) return h('span', { class: 'badge one' }, t('countOne'));
  return h('span', { class: 'badge many' }, t('countMany', n));
}
function setCountBadge(el, n) {
  const b = countBadge(n);
  el.className = b.className;
  el.textContent = b.textContent;
}
const KIND_LABEL = { id: 'id', attr: t('kindAttr'), class: 'class', context: t('kindContext'), path: t('kindPath') };
const STAB_LABEL = { 3: t('stabilityHigh'), 2: t('stabilityMid'), 0: t('stabilityLow') };

function setSeg(id, value) {
  for (const b of $(id).querySelectorAll('button[data-v]')) b.classList.toggle('on', b.dataset.v === value);
}

function renderEditor() {
  $('editor').hidden = !S.open;
  $('pickBtn').hidden = false;
  if (!S.open) return;
  const d = S.draft;

  $('edTitle').textContent = S.editing ? t('editorEdit') : t('editorNew');
  $('applyBtn').textContent = S.editing ? t('update') : t('apply');
  $('deleteBtn').hidden = !S.editing;
  if (document.activeElement !== $('name')) $('name').value = d.name;
  if (document.activeElement !== $('selector')) $('selector').value = d.selector;

  // 対象（要素全体／一部を残す）
  const partial = d.target === 'partial';
  setSeg('targetSeg', d.target);
  $('keepParams').hidden = !partial;
  $('keepType').value = d.keepType;
  $('keepNBox').hidden = !(d.keepType === 'head' || d.keepType === 'tail');
  if (document.activeElement !== $('keepN')) $('keepN').value = d.keepN;
  $('keepPatternRow').hidden = d.keepType !== 'regex';
  if (document.activeElement !== $('keepPattern')) $('keepPattern').value = d.keepPattern;
  $('spreadRow').hidden = partial; // 文字単位でははみ出しは使わない
  $('blurHint').textContent = partial ? t('blurHintText') : t('blurHint');

  // パラメータ
  setSeg('modeSeg', d.mode);
  setSeg('fillSeg', d.fillSource);
  setSeg('scopeSeg', d.scope);
  $('blurParams').hidden = d.mode !== 'blur';
  $('fillParams').hidden = d.mode !== 'fill';
  $('customColor').hidden = d.fillSource !== 'custom';
  $('customColor').value = d.customColor;
  $('blurPx').value = d.blurPx;
  $('blurVal').textContent = d.blurPx;
  $('spreadPx').value = d.spreadPx;
  $('spreadVal').textContent = d.spreadPx;
  $('persist').checked = d.persist;

  // 候補
  $('candBlock').hidden = !S.levels.length;
  const levels = $('levels');
  levels.replaceChildren(
    ...S.levels.map((lv, i) =>
      h(
        'button',
        { class: i === S.li ? 'on' : '', role: 'tab', onclick: () => selectLevel(i) },
        i === 0 ? t('levelClicked') : t('levelParent', i),
        h('small', {}, `${lv.tag} ${lv.w}×${lv.h}`),
      ),
    ),
  );
  levels.children[S.li]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  const list = $('cands');
  const cands = S.levels[S.li]?.candidates || [];
  if (!cands.length) {
    list.replaceChildren(
      h('li', { class: 'none' }, t('noCandidates')),
    );
    return;
  }
  list.replaceChildren(
    ...cands.map((c, i) =>
      h(
        'li',
        {
          class: i === S.ci ? 'on' : '',
          role: 'option',
          onmouseenter: () => i !== S.ci && selectCand(i),
          onclick: () => selectCand(i),
          ondblclick: () => apply(),
        },
        h('code', {}, c.sel),
        countBadge(c.count),
        h(
          'div',
          { class: 'meta' },
          h('span', { class: `badge s${c.stab}` }, STAB_LABEL[c.stab] ?? ''),
          h('span', { class: 'badge' }, KIND_LABEL[c.kind] ?? c.kind),
        ),
      ),
    ),
  );
  markCand();
}

function markCand() {
  const items = $('cands').children;
  for (let i = 0; i < items.length; i++) items[i].classList.toggle('on', i === S.ci);
  if (S.ci >= 0) items[S.ci]?.scrollIntoView({ block: 'nearest' });
}
function selectCand(i) {
  S.ci = i;
  S.draft.selector = currentCand()?.sel ?? S.draft.selector;
  $('selector').value = S.draft.selector;
  markCand();
  preview();
}
function selectLevel(i) {
  S.li = i;
  const n = S.levels[i]?.candidates?.length || 0;
  S.ci = n ? 0 : -1;
  if (n) S.draft.selector = currentCand().sel;
  renderEditor();
  preview();
}

// プレビュー（編集枠の内容そのままで描画）
let previewSeq = 0;
async function preview() {
  if (!S.open) return;
  const seq = ++previewSeq;
  const d = S.draft;
  try {
    const res = await send({
      type: 'sbm:preview',
      selector: d.selector || null,
      opts: { mode: d.mode, blurPx: d.blurPx, spreadPx: d.spreadPx },
      fill: { source: d.fillSource, color: d.customColor, text: d.target === 'partial' },
      keep: keepSpec(d),
    });
    if (seq !== previewSeq) return;
    renderKeepStats(res);
    if (d.selector) setCountBadge($('selCount'), res?.count ?? -1);
    else {
      $('selCount').className = '';
      $('selCount').textContent = '';
    }
    const sw = $('fillSwatch');
    sw.hidden = !(d.mode === 'fill' && res?.color);
    if (res?.color) {
      sw.style.background = res.color;
      sw.title = res.color;
    }
  } catch {}
}

function renderKeepStats(res) {
  const el = $('keepStats');
  const d = S.draft;
  el.className = 'hint';
  if (d.target !== 'partial') return;
  const err = d.keepType === 'regex' ? regexError(d.keepPattern) : null;
  if (res && res.keepSupported === false) {
    el.textContent = t('keepUnsupported');
    el.classList.add('warn');
  } else if (err) {
    el.textContent = t('regexWarn', err);
    el.classList.add('warn');
  } else if (!d.selector || !res?.keepStats) {
    el.textContent = '';
  } else {
    const { total, matched } = res.keepStats;
    const miss = total - matched;
    el.textContent = total
      ? t('keepMatched', [total, matched]) + (miss ? t('keepMissed', miss) : '')
      : t('keepNoText');
    if (miss) el.classList.add('warn');
  }
}

// 入力
$('name').addEventListener('input', (e) => (S.draft.name = e.target.value));
$('keepType').addEventListener('change', (e) => {
  S.draft.keepType = e.target.value;
  renderEditor();
  preview();
});
$('keepN').addEventListener('input', (e) => {
  const n = Math.floor(Number(e.target.value));
  if (n >= 1) {
    S.draft.keepN = n;
    preview();
  }
});
let patTimer = 0;
$('keepPattern').addEventListener('input', (e) => {
  S.draft.keepPattern = e.target.value;
  clearTimeout(patTimer);
  patTimer = setTimeout(preview, 200);
});
let selTimer = 0;
$('selector').addEventListener('input', (e) => {
  S.draft.selector = e.target.value.trim();
  if (S.ci >= 0) {
    S.ci = -1; // 手入力した時点で候補の選択は外す
    markCand();
  }
  clearTimeout(selTimer);
  selTimer = setTimeout(preview, 150);
});
function bindSeg(id, key, after) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    S.draft[key] = b.dataset.v;
    renderEditor();
    after?.();
  });
}
bindSeg('targetSeg', 'target', preview);
bindSeg('modeSeg', 'mode', preview);
bindSeg('fillSeg', 'fillSource', preview);
bindSeg('scopeSeg', 'scope');
$('customColor').addEventListener('input', (e) => {
  S.draft.customColor = e.target.value;
  preview();
});
$('blurPx').addEventListener('input', (e) => {
  S.draft.blurPx = Number(e.target.value);
  $('blurVal').textContent = S.draft.blurPx;
  preview();
});
$('spreadPx').addEventListener('input', (e) => {
  S.draft.spreadPx = Number(e.target.value);
  $('spreadVal').textContent = S.draft.spreadPx;
  preview();
});
$('persist').addEventListener('change', (e) => (S.draft.persist = e.target.checked));

$('applyBtn').addEventListener('click', () => apply());
$('cancelBtn').addEventListener('click', () => closeEditor(true));
$('deleteBtn').addEventListener('click', async () => {
  const r = S.editing;
  if (!r) return;
  closeEditor(true);
  await mutate(r.saved, (l) => l.filter((x) => x.id !== r.id));
});

document.addEventListener('keydown', (e) => {
  if (!S.open) return;
  const inText =
    e.target instanceof HTMLSelectElement ||
    (e.target instanceof HTMLInputElement && ['text', 'search', 'number', ''].includes(e.target.type));
  // 日本語入力の変換中（確定前）のキーは無視する
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeEditor(true);
    return;
  }
  if (inText) return;
  const cands = S.levels[S.li]?.candidates || [];
  let handled = true;
  switch (e.key) {
    case 'ArrowDown':
      if (cands.length) selectCand((S.ci + 1 + cands.length) % cands.length);
      break;
    case 'ArrowUp':
      if (cands.length) selectCand(S.ci <= 0 ? cands.length - 1 : S.ci - 1);
      break;
    case 'ArrowRight': // 親へ
      if (S.li < S.levels.length - 1) selectLevel(S.li + 1);
      break;
    case 'ArrowLeft': // 子へ
      if (S.li > 0) selectLevel(S.li - 1);
      break;
    default:
      handled = false;
  }
  if (handled) e.preventDefault();
});

// ===================================================================
// ルールの保存
// ===================================================================
function area(saved) {
  return saved
    ? { store: chrome.storage.local, key: K_SAVED }
    : { store: chrome.storage.session, key: K_SESSION };
}
async function mutate(saved, fn) {
  if (!S.origin) return;
  const { store, key } = area(saved);
  const obj = (await store.get(key))[key] || {};
  const next = fn(obj[S.origin] || []);
  if (next.length) obj[S.origin] = next;
  else delete obj[S.origin];
  await store.set({ [key]: obj });
}

async function apply() {
  const d = S.draft;
  if (!d.selector) {
    $('selector').focus();
    return;
  }
  const { counts } = await send({ type: 'sbm:count', selectors: [d.selector] }).catch(() => ({ counts: [-1] }));
  if (counts[0] < 0) {
    $('selector').focus();
    return; // 無効なセレクタ
  }

  if (d.target === 'partial' && d.keepType === 'regex' && regexError(d.keepPattern)) {
    $('keepPattern').focus();
    return;
  }

  const old = S.editing;
  const rule = {
    id: old?.id ?? crypto.randomUUID(),
    name: d.name.trim() || undefined,
    selector: d.selector,
    mode: d.mode,
    blurPx: d.blurPx,
    spreadPx: d.spreadPx,
    scope: d.scope,
    path: d.scope === 'path' ? (old?.scope === 'path' && old.path ? old.path : S.path) : null,
    createdAt: old?.createdAt ?? Date.now(),
  };
  if (old?.disabled) rule.disabled = true; // 個別のオン／オフは編集しても維持
  const keepSp = keepSpec(d);
  if (keepSp) rule.keep = keepSp;
  if (d.mode === 'fill') {
    // 親/ページの背景は適用時点の色を読み取って保存。編集でセレクタ・取り方・対象が同じなら元の色を維持
    const sameColor =
      old && old.mode === 'fill' && isHex(old.fillColor) && old.fillSource === d.fillSource &&
      d.fillSource !== 'custom' && old.selector === d.selector && !!old.keep === !!keepSp;
    if (sameColor) rule.fillColor = old.fillColor;
    else {
      try {
        rule.fillColor = (
          await send({
            type: 'sbm:resolveFill',
            selector: d.selector,
            fill: { source: d.fillSource, color: d.customColor, text: !!keepSp },
          })
        ).color;
      } catch {}
    }
    rule.fillColor ||= GRAY;
    rule.fillSource = d.fillSource;
  }

  if (!old) {
    await mutate(d.persist, (l) => [...l, rule]);
  } else if (d.persist === !!old.saved) {
    await mutate(old.saved, (l) => l.map((x) => (x.id === old.id ? rule : x)));
  } else {
    // 保存先が変わる: 先に移動先へ追加してから元を消す
    await mutate(d.persist, (l) => [...l.filter((x) => x.id !== old.id), rule]);
    await mutate(old.saved, (l) => l.filter((x) => x.id !== old.id));
  }

  // 次の新規マスクの初期値として覚えておく
  const { name, selector, ...opts } = d;
  for (const k of KEEP_FIELDS) delete opts[k];
  S.last = { ...DEFAULT_DRAFT, ...opts };
  chrome.storage.local.set({ [K_LAST]: S.last });

  closeEditor(true);
}

// ===================================================================
// 一覧
// ===================================================================
async function getRules() {
  const [s, l] = await Promise.all([
    chrome.storage.session.get(K_SESSION),
    chrome.storage.local.get(K_SAVED),
  ]);
  return [
    ...((l[K_SAVED] || {})[S.origin] || []).map((r) => ({ ...r, saved: true })),
    ...((s[K_SESSION] || {})[S.origin] || []).map((r) => ({ ...r, saved: false })),
  ];
}

function summary(r) {
  const keepBadge = r.keep?.type
    ? h('span', { class: 'badge keep' }, (KEEP_LABEL[r.keep.type] || (() => t('targetPartial')))(r.keep.n ?? 1))
    : null;
  if (r.mode === 'fill') {
    return [
      keepBadge,
      h(
        'span',
        { class: 'badge' },
        h('span', { class: 'sw', style: `background:${isHex(r.fillColor) ? r.fillColor : GRAY}` }),
        t('modeFill'),
      ),
    ];
  }
  const px = Number.isFinite(r.blurPx) ? r.blurPx : S.legacy.blurPx;
  const sp = Number.isFinite(r.spreadPx) ? r.spreadPx : S.legacy.spreadPx;
  return [keepBadge, h('span', { class: 'badge' }, r.keep?.type ? t('summaryBlur', px) : t('summaryBlurSpread', [px, sp]))];
}

function highlight(r) {
  send({ type: 'sbm:highlight', selector: r?.selector ?? null, label: r?.name || '' }).catch(() => {});
}

let renderRulesQueued = false;
function renderRules() {
  if (renderRulesQueued) return;
  renderRulesQueued = true;
  setTimeout(async () => {
    renderRulesQueued = false;
    await doRenderRules();
  }, 50);
}
async function doRenderRules() {
  const ul = $('rules');
  if (!S.origin) {
    ul.replaceChildren();
    return;
  }
  const rules = await getRules();
  let counts = [];
  try {
    counts = (await send({ type: 'sbm:count', selectors: rules.map((r) => r.selector) })).counts;
  } catch {}

  $('ruleCount').textContent = rules.length ? `${rules.length}` : '';
  $('rulesEmpty').hidden = rules.length > 0;
  $('rulesHint').hidden = rules.length === 0;
  $('clearSite').hidden = rules.length === 0;

  ul.replaceChildren(
    ...rules.map((r, i) => {
      const here = r.scope !== 'path' || r.path === S.path;
      const on = !r.disabled;
      return h(
        'li',
        {
          class: [S.editing?.id === r.id ? 'editing' : '', on ? '' : 'off'].join(' ').trim(),
          onmouseenter: () => here && highlight(r),
          onclick: (e) => {
            if (e.target.closest('button, label, input')) return;
            highlight(null);
            editRule(r);
          },
        },
        h(
          'div',
          { class: 'top' },
          h(
            'label',
            { class: 'switch mini', title: on ? t('toggleOff') : t('toggleOn') },
            h('input', {
              type: 'checkbox',
              ...(on ? { checked: '' } : {}),
              onchange: (e) =>
                mutate(r.saved, (l) =>
                  l.map((x) => {
                    if (x.id !== r.id) return x;
                    const { disabled, ...rest } = x;
                    return e.target.checked ? rest : { ...rest, disabled: true };
                  }),
                ),
            }),
            h('span', { class: 'track' }),
          ),
          r.name ? h('span', { class: 'title' }, r.name) : h('code', { class: 'title' }, r.selector),
          h(
            'button',
            {
              class: 'del',
              title: t('deleteTitle'),
              onclick: async () => {
                highlight(null);
                if (S.editing?.id === r.id) closeEditor(true);
                await mutate(r.saved, (l) => l.filter((x) => x.id !== r.id));
              },
            },
            '×',
          ),
        ),
        r.name ? h('code', { class: 'selsub' }, r.selector) : null,
        h(
          'div',
          { class: 'meta' },
          here ? countBadge(counts[i] ?? -1) : h('span', { class: 'badge', title: r.path || '' }, t('otherPage')),
          summary(r),
          h('span', { class: 'badge' }, r.scope === 'path' ? t('scopePath') : t('scopeSite')),
          h('span', { class: 'badge' + (r.saved ? ' one' : '') }, r.saved ? t('saved') : t('session')),
        ),
      );
    }),
  );
}
$('rules').addEventListener('mouseleave', () => highlight(null));

$('clearSite').addEventListener('click', async () => {
  if (!confirm(t('clearConfirm', S.origin))) return;
  closeEditor(true);
  await mutate(true, () => []);
  await mutate(false, () => []);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if ((areaName === 'session' && changes[K_SESSION]) || (areaName === 'local' && changes[K_SAVED])) {
    renderRules();
  }
  if (areaName === 'local' && changes[K_SETTINGS]) {
    applySettings(changes[K_SETTINGS].newValue);
  }
});

// ===================================================================
// 全体設定（有効／一時停止のみ）
// ===================================================================
function applySettings(v) {
  const raw = v || {};
  S.settings = { ...DEFAULT_SETTINGS, enabled: raw.enabled !== false };
  S.legacy = { blurPx: raw.blurPx ?? 12, spreadPx: raw.spreadPx ?? 16 };
  $('enabled').checked = S.settings.enabled;
  $('enabledLbl').textContent = S.settings.enabled ? t('enabledOn') : t('enabledOff');
  updateDot();
}
function updateDot() {
  $('dot').className = 'dot' + (!S.origin ? ' na' : S.settings.enabled ? '' : ' off');
}
$('enabled').addEventListener('change', async (e) => {
  const cur = (await chrome.storage.local.get(K_SETTINGS))[K_SETTINGS] || {};
  chrome.storage.local.set({ [K_SETTINGS]: { ...cur, enabled: e.target.checked } });
});

// ===================================================================
// 起動
// ===================================================================
(async () => {
  document.title = t('extName');
  localize();
  setPicking(false);
  for (const [id, url] of [['repoLink', LINKS.repo], ['donateLink', LINKS.donate]]) {
    if (/^https:\/\//.test(url)) {
      $(id).href = url;
      $(id).hidden = false;
    }
  }
  $('footer').hidden = !LINKS.repo && !LINKS.donate;
  const l = await chrome.storage.local.get([K_SETTINGS, K_LAST]);
  applySettings(l[K_SETTINGS]);
  S.last = { ...DEFAULT_DRAFT, ...(l[K_LAST] || {}) };
  await refresh();
})();
