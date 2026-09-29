export const CONFIG_KEY = 'passbook_config';
export const CACHE_KEY = 'passbook_cache';
const TIMEOUT_MS = 30000;
const defaultStorage = () => globalThis.localStorage;
const defaultFetch = (...args) => globalThis.fetch(...args);

function readJSON(storage, key) {
  try { const v = storage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function writeJSON(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function loadConfig(storage = defaultStorage()) {
  const c = readJSON(storage, CONFIG_KEY);
  return c && c.url && c.token ? c : null;
}
export function saveConfig(cfg, storage = defaultStorage()) {
  return writeJSON(storage, CONFIG_KEY, { url: cfg.url.trim(), token: cfg.token.trim() });
}
export function validateConfig({ url, token }) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test((url || '').trim())) {
    return 'Apps Script 웹 앱 주소는 https://script.google.com/macros/s/.../exec 형식이어야 해요';
  }
  if (!(token || '').trim()) return '보안 토큰을 입력해 주세요';
  return null;
}
export function loadCache(storage = defaultStorage()) { return readJSON(storage, CACHE_KEY); }
export function saveCache(data, storage = defaultStorage()) { return writeJSON(storage, CACHE_KEY, data); }

async function call(cfg, req, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    if (req.method === 'GET') {
      const u = new URL(cfg.url);
      for (const [k, v] of Object.entries(req.params)) u.searchParams.set(k, v);
      res = await fetchImpl(u.toString(), { signal: ctrl.signal });
    } else {
      // text/plain이면 CORS 사전 요청(preflight)이 생기지 않아 Apps Script가 받을 수 있다
      res = await fetchImpl(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(req.body),
        signal: ctrl.signal,
      });
    }
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? '시트 응답이 너무 늦어요 (30초 초과)' : '네트워크 연결을 확인해 주세요. 인터넷이 되는데도 안 되면 Apps Script 웹 앱 주소와 배포 액세스("모든 사용자")를 확인해 주세요');
    err.uncertain = true; // 요청이 서버에 닿았는지 알 수 없음 (저장됐을 수도 있음)
    throw err;
  } finally {
    clearTimeout(timer);
  }
  let data;
  try { data = await res.json(); } catch {
    throw new Error('시트 응답을 읽지 못했어요 (Apps Script 배포 설정: 액세스 "모든 사용자"인지 확인해 주세요)');
  }
  if (!data || data.status !== 'ok') throw new Error((data && data.message) || '알 수 없는 오류가 났어요');
  return data;
}

export async function listTransactions(cfg, fetchImpl = defaultFetch) {
  const d = await call(cfg, { method: 'GET', params: { action: 'list', token: cfg.token } }, fetchImpl);
  return { settings: d.settings || { startBalance: 0, startDate: '' }, rows: d.rows || [], skipped: d.skipped || 0 };
}
// requestId가 같은 재시도는 서버가 한 번만 저장한다 (타임아웃 후 다시 눌러도 중복 없음)
export async function addTransactions(cfg, rows, fetchImpl = defaultFetch, requestId) {
  const d = await call(cfg, { method: 'POST', body: { action: 'add', token: cfg.token, rows, requestId } }, fetchImpl);
  return d.ids;
}
export async function deleteTransaction(cfg, id, fetchImpl = defaultFetch) {
  await call(cfg, { method: 'POST', body: { action: 'delete', token: cfg.token, id } }, fetchImpl);
}
