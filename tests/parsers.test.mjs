import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTableRows, parsePdfLines } from '../js/parsers.js';

test('simple 날짜/항목/금액 table uses 항목 as name and category', () => {
  const res = parseTableRows([
    ['가계부'],
    ['날짜', '항목', '금액'],
    ['2026-03-02', '식비', '12,000'],
    ['2026-03-03', '카페', -4500],
    ['', '', ''],
    ['합계', '', 16500],
  ], 2026);
  assert.equal(res.format, 'simple');
  assert.deepEqual(res.items, [
    { date: '2026-03-02', name: '식비', amount: 12000, cat: '식비' },
    { date: '2026-03-03', name: '카페', amount: 4500, cat: '카페' },
  ]);
});

test('card statement: finds columns, skips 소계/합계 and refunds, keeps names ending in digits', () => {
  const res = parseTableRows([
    ['현대카드 이용내역'],
    ['이용일', '이용가맹점', '이용금액', '할부', '결제원금'],
    ['2026.03.05', '이마트24 사상점', '3,000', '', '3,000'],
    ['2026.03.06', 'GS25', '1,500', '', '1,500'],
    ['2026.03.07', '쿠팡 12,000', '', '', '12,000'],
    ['2026.03.08', '취소된 결제', '-5,000', '', '-5,000'],
    ['', '소계', '', '', '16,500'],
  ], 2026);
  assert.equal(res.format, 'card');
  assert.deepEqual(res.items, [
    { date: '2026-03-05', name: '이마트24 사상점', amount: 3000 },
    { date: '2026-03-06', name: 'GS25', amount: 1500 },
    { date: '2026-03-07', name: '쿠팡', amount: 12000 },
  ]);
});

test('unknown table format throws a readable error', () => {
  assert.throws(() => parseTableRows([['a', 'b'], ['1', '2']], 2026), /명세서 형식을 알아보지 못했어요/);
});

test('PDF lines: MM/DD name amounts; discount-only lines skipped', () => {
  const items = parsePdfLines([
    '이용 일자 이용가맹점 이용금액',
    '03/15 스타벅스사상점 5,000 5,000',
    '03/16 이마트 1,000 -1,000 할인',
    '03/17 롯데마트 12,000 12,000',
    '소계 18,000',
  ], 2026);
  assert.deepEqual(items, [
    { date: '2026-03-15', name: '스타벅스사상점', amount: 5000 },
    { date: '2026-03-17', name: '롯데마트', amount: 12000 },
  ]);
});

test('PDF MM/DD across New Year uses previous year', () => {
  const items = parsePdfLines(['12/30 롯데마트 12,000 12,000'], 2027, new Date(2027, 0, 5));
  assert.equal(items[0].date, '2026-12-30');
});
