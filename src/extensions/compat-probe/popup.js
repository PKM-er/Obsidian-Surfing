'use strict';
const chrome = globalThis.chrome || {};
const el = document.getElementById('output');
async function withTimeout(p, ms = 4500) {
  let timer;
  return Promise.race([p, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`等待 ${ms}ms 后超时`)), ms);
  })]).finally(() => clearTimeout(timer));
}
async function run() {
  const results = { time: new Date().toISOString(), url: location.href, api: {} };
  results.api.chromeRuntime = !!globalThis.chrome?.runtime;
  results.api.runtimeId = globalThis.chrome?.runtime?.id || null;
  results.api.runtimeSendMessage = typeof chrome?.runtime?.sendMessage === 'function';
  results.api.alarms = typeof chrome?.alarms?.create === 'function';
  results.api.tabsQuery = typeof chrome?.tabs?.query === 'function';
  results.api.storageLocal = !!chrome?.storage?.local;
  results.api.storageSync = !!chrome?.storage?.sync;
  el.textContent = JSON.stringify(results, null, 2) + '\n正在执行消息往返…';
  try {
    const nonce = crypto.randomUUID();
    const response = await withTimeout(chrome.runtime.sendMessage({ type: 'BRIDGE_PING', nonce }));
    results.background = response;
    results.messageRoundTrip = response?.ok === true && response?.nonce === nonce ? 'PASS' : 'FAIL: 错误的响应';
  } catch (e) { results.messageRoundTrip = `FAIL: ${e?.message || e}`; }
  try {
    const key = 'bridge_probe_' + Math.random().toString(36).slice(2);
    await withTimeout(chrome.storage.local.set({ [key]: 42 }));
    const value = await withTimeout(chrome.storage.local.get(key));
    await withTimeout(chrome.storage.local.remove(key));
    results.storageRoundTrip = value?.[key] === 42 ? 'PASS' : 'FAIL';
  } catch (e) { results.storageRoundTrip = `FAIL: ${e?.message || e}`; }
  try {
    const tabs = await withTimeout(chrome.tabs.query({ active: true }));
    results.tabsQuery = { isArray: Array.isArray(tabs), count: tabs?.length || 0, first: tabs?.[0]?.url || null };
  } catch (e) { results.tabsQuery = `FAIL: ${e?.message || e}`; }
  el.textContent = JSON.stringify(results, null, 2);
  el.className = results.messageRoundTrip === 'PASS' ? 'ok' : 'err';
  console.log('[Bridge MV3 Probe] Results', results);
}
document.getElementById('retry').addEventListener('click', run);
run();
