// Stream Blur Mask — service worker
const K_SESSION = 'sbm:rules'; // chrome.storage.session: { [origin]: Rule[] }
const K_SAVED = 'sbm:saved';   // chrome.storage.local:   { [origin]: Rule[] }
const GUARD_ID = 'sbm-guard';

// content script から storage.session を直接読めるようにする（既定では拡張ページのみ）
chrome.storage.session
  .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
  .catch((e) => console.warn('[SBM] setAccessLevel', e));

// ツールバーアイコンでサイドパネルを開く
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.warn('[SBM] setPanelBehavior', e));

function originToPattern(origin) {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // マッチパターンはポートを持てない（ポートは無視される）
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

// ルールを持つオリジンにだけ guard.css を document_start で注入する
let syncChain = Promise.resolve();
function syncGuard() {
  syncChain = syncChain.then(doSyncGuard).catch((e) => console.warn('[SBM] syncGuard', e));
  return syncChain;
}
async function doSyncGuard() {
  const [s, l] = await Promise.all([
    chrome.storage.session.get(K_SESSION),
    chrome.storage.local.get(K_SAVED),
  ]);
  const origins = new Set();
  for (const map of [s[K_SESSION] || {}, l[K_SAVED] || {}]) {
    for (const [origin, rules] of Object.entries(map)) {
      if (Array.isArray(rules) && rules.length) origins.add(origin);
    }
  }
  const matches = [...new Set([...origins].map(originToPattern).filter(Boolean))];

  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [GUARD_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [GUARD_ID] });
  if (matches.length) {
    await chrome.scripting.registerContentScripts([
      {
        id: GUARD_ID,
        css: ['guard.css'],
        matches,
        runAt: 'document_start',
        allFrames: true,
        persistAcrossSessions: true,
      },
    ]);
  }
}

chrome.runtime.onInstalled.addListener(syncGuard);
chrome.runtime.onStartup.addListener(syncGuard);
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'session' && changes[K_SESSION]) || (area === 'local' && changes[K_SAVED])) {
    syncGuard();
  }
});
