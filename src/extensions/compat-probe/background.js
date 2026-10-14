'use strict';
console.info('[Bridge MV3 Probe] Background evaluated');
// Register synchronously before the first asynchronous boundary.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'BRIDGE_PING') return false;
  sendResponse({
    ok: true,
    nonce: message.nonce,
    senderOrigin: sender?.origin || null,
    background: 'mv3-service-worker',
    runtimeId: chrome.runtime.id,
    hasAlarms: typeof chrome.alarms?.create === 'function',
    hasTabs: typeof chrome.tabs?.query === 'function',
    hasStorageLocal: !!chrome.storage?.local,
    now: Date.now()
  });
  return false;
});
