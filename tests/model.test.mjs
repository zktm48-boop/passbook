import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickYear, monthRange, latestDataMonth, monthlyTotals, categoryTotals, endOfMonth, balanceAt, savingRates, ledgerForMonth, isDuplicate, withBalances, searchRows } from '../js/model.js';

const r = (id, date, kind, name, cat, amount, summary = false) => ({ id, date, kind, name, cat, amount, summary });
const rows = [
  r('a', '2026-01-05', 'income', '월급', '월급', 1000),
  r('b', '2026-01-10', 'expense', '이마트', '식비', 300),
  r('c', '2026-01-10', 'transfer', '적금', '저축', 200),
  r('d', '2026-02-03', 'expense', '카페', '카페', 50),
  r('e', '2026-01-02', 'expense', '버스', '교통비', 10),
];

test('pickYear / monthRange / latestDataMonth', () => {
  assert.equal(pickYear(rows, new Date(2026, 8, 29)), 2026);
  assert.equal(pickYear([], new Date(2027, 0, 1)), 2027);
  assert.deepEqual(monthRange(rows, 2026, new Date(2026, 8, 29)), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(monthRange(rows, 2026, new Date(2027, 2, 1)), [1, 2]);
  assert.deepEqual(monthRange([], 2026, new Date(2026, 0, 15)), [1]);
  assert.equal(latestDataMonth(rows, 2026), 2);
  assert.equal(latestDataMonth(rows, 2025), null);
});

test('monthlyTotals', () => {
  const t = monthlyTotals(rows, 2026);
  assert.equal(t.income[0], 1000);
  assert.equal(t.expense[0], 310);
  assert.equal(t.transfer[0], 200);
  assert.equal(t.expense[1], 50);
  assert.equal(t.income.length, 12);
});

test('categoryTotals sorted desc, zero excluded', () => {
  assert.deepEqual(categoryTotals(rows, 2026, 1, 'expense'), [['식비', 300], ['교통비', 10]]);
  assert.deepEqual(categoryTotals(rows, 2026, 3, 'expense'), []);
});

test('balanceAt includes the day itself', () => {
  assert.equal(endOfMonth(2026, 2), '2026-02-28');
  assert.equal(balanceAt(rows, 100, '2026-01-31'), 590);
  assert.equal(balanceAt(rows, 100, endOfMonth(2026, 2)), 540);
  assert.equal(balanceAt(rows, 100, '2026-01-01'), 100);
});

test('savingRates null when no income', () => {
  const rates = savingRates(monthlyTotals(rows, 2026));
  assert.equal(rates[0], 69);
  assert.equal(rates[1], null);
});

test('ledgerForMonth: date order, stable within a day, running balance', () => {
  const l = ledgerForMonth(rows, 100, 2026, 1);
  assert.deepEqual(l.map(x => x.id), ['e', 'a', 'b', 'c']);
  assert.deepEqual(l.map(x => x.balance), [90, 1090, 790, 590]);
  const feb = ledgerForMonth(rows, 100, 2026, 2);
  assert.deepEqual(feb.map(x => x.balance), [540]);
});

test('isDuplicate matches date+name+amount', () => {
  assert.equal(isDuplicate({ date: '2026-01-10', name: '이마트', amount: 300 }, rows), true);
  assert.equal(isDuplicate({ date: '2026-01-10', name: '이마트', amount: 301 }, rows), false);
});

test('withBalances gives every row its running balance in date order', () => {
  const all = withBalances(rows, 100);
  assert.deepEqual(all.map(x => x.id), ['e', 'a', 'b', 'c', 'd']);
  assert.deepEqual(all.map(x => x.balance), [90, 1090, 790, 590, 540]);
});

test('searchRows matches name, category, or amount (commas ignored), case-insensitive', () => {
  const all = withBalances(rows, 100);
  assert.deepEqual(searchRows(all, '이마트').map(x => x.id), ['b']);
  assert.deepEqual(searchRows(all, '저축').map(x => x.id), ['c']);
  assert.deepEqual(searchRows(all, '1,000').map(x => x.id), ['a']);
  assert.deepEqual(searchRows(all, '  ').map(x => x.id), []);
  assert.deepEqual(searchRows([{ ...rows[0], name: 'GS25 편의점' }], 'gs25').length, 1);
});
