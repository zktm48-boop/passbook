// 날짜는 항상 'YYYY-MM-DD' 문자열로 다룬다. toISOString()은 UTC 기준이라 한국 시간에서 하루 밀리므로 쓰지 않는다.
const pad = n => String(n).padStart(2, '0');
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function toISODate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function localISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function formatKoreanDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${pad(m)}월 ${pad(d)}일 (${DAYS[dow]})`;
}

// 연도 없는 MM/DD가 오늘+7일보다 미래면 작년 거래로 본다 (1월에 받은 12월 명세서)
function yearless(y, m, d, today) {
  const iso = toISODate(y, m, d);
  if (!iso || !today) return iso;
  const limit = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  return iso > localISODate(limit) ? toISODate(y - 1, m, d) : iso;
}

export function parseDateFlexible(v, defaultYear, today) {
  if (v instanceof Date) {
    if (isNaN(v)) return null;
    // 엑셀 라이브러리가 자정을 UTC/로컬 어느 쪽으로 만들든 같은 날이 되도록 정오로 옮겨서 읽는다
    const t = new Date(v.getTime() + 12 * 3600 * 1000);
    return toISODate(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null; // 엑셀 일련번호 범위 (1954~2119)
    const t = new Date(Math.round((v - 25569) * 86400000));
    return toISODate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const s = String(v ?? '').trim();
  let m = s.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
  if (m) return toISODate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return toISODate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
  if (m) return yearless(defaultYear, +m[1], +m[2], today);
  return null;
}
