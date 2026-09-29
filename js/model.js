import { lastDayOfMonth } from './dates.js';

const pad = n => String(n).padStart(2, '0');
const yearOf = r => Number(r.date.slice(0, 4));
const monthOf = r => Number(r.date.slice(5, 7));
const signed = r => (r.kind === 'income' ? r.amount : -r.amount);

export function pickYear(rows, today) {
  let y = 0;
  for (const r of rows) y = Math.max(y, yearOf(r));
  return y || today.getFullYear();
}

export function latestDataMonth(rows, year) {
  let last = null;
  for (const r of rows) if (yearOf(r) === year) last = Math.max(last ?? 0, monthOf(r));
  return last;
}

export function monthRange(rows, year, today) {
  let last = latestDataMonth(rows, year) ?? 1;
  if (year === today.getFullYear()) last = Math.max(last, today.getMonth() + 1);
  return Array.from({ length: last }, (_, i) => i + 1);
}

export function monthlyTotals(rows, year) {
  const t = { income: new Array(12).fill(0), expense: new Array(12).fill(0), transfer: new Array(12).fill(0) };
  for (const r of rows) if (yearOf(r) === year) t[r.kind][monthOf(r) - 1] += r.amount;
  return t;
}

export function categoryTotals(rows, year, month, kind) {
  const sums = new Map();
  for (const r of rows) {
    if (r.kind !== kind || yearOf(r) !== year || monthOf(r) !== month) continue;
    sums.set(r.cat, (sums.get(r.cat) || 0) + r.amount);
  }
  return [...sums].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}

export function endOfMonth(year, month) {
  return `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`;
}

export function balanceAt(rows, startBalance, isoDate) {
  let bal = startBalance;
  for (const r of rows) if (r.date <= isoDate) bal += signed(r);
  return bal;
}

export function savingRates(totals) {
  return totals.income.map((inc, i) => (inc > 0 ? Math.round(((inc - totals.expense[i]) / inc) * 1000) / 10 : null));
}

// 전체 거래를 날짜순(같은 날은 원래 순서)으로 정렬하고 각 줄에 누적 잔액을 붙인다
export function withBalances(rows, startBalance) {
  const sorted = rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : a.i - b.i));
  let bal = startBalance;
  return sorted.map(({ row }) => { bal += signed(row); return { ...row, balance: bal }; });
}

export function ledgerForMonth(rows, startBalance, year, month) {
  const prefix = `${year}-${pad(month)}`;
  return withBalances(rows, startBalance).filter(r => r.date.startsWith(prefix));
}

// 내역·분류·금액으로 검색 (대소문자·쉼표 무시). 빈 검색어면 빈 배열
export function searchRows(rowsWithBalance, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const qNum = q.replace(/[,\s원₩]/g, '');
  return rowsWithBalance.filter(r =>
    r.name.toLowerCase().includes(q) ||
    r.cat.toLowerCase().includes(q) ||
    (/^\d+$/.test(qNum) && String(r.amount).includes(qNum)));
}

export function isDuplicate(c, rows) {
  return rows.some(r => r.date === c.date && r.amount === c.amount && r.name === c.name);
}
