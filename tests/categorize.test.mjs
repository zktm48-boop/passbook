import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMerchantMap, guessCategory, DEFAULT_CATEGORY } from '../js/categorize.js';

const rows = [
  { id: '1', date: '2026-01-24', kind: 'expense', name: '이마트 사상점', cat: '식비', amount: 1, summary: false },
  { id: '2', date: '2026-01-25', kind: 'expense', name: '이마트 사상점', cat: '식비', amount: 1, summary: false },
  { id: '3', date: '2026-01-26', kind: 'expense', name: '이마트 사상점', cat: '생필품', amount: 1, summary: false },
  { id: '4', date: '2026-02-28', kind: 'expense', name: '2월 카페 합계', cat: '카페', amount: 1, summary: true },
  { id: '5', date: '2026-01-23', kind: 'income', name: '월급 입금', cat: '월급', amount: 1, summary: false },
];

test('buildMerchantMap picks most frequent category, skips summary and non-expense', () => {
  const map = buildMerchantMap(rows);
  assert.equal(map['이마트 사상점'], '식비');
  assert.equal(map['2월 카페 합계'], undefined);
  assert.equal(map['월급 입금'], undefined);
});

test('guessCategory: exact, contains, keyword, default', () => {
  const map = buildMerchantMap(rows);
  assert.equal(guessCategory('이마트 사상점', map), '식비');
  assert.equal(guessCategory('이마트 사상점 (주말)', map), '식비');
  assert.equal(guessCategory('스타벅스 부산점', map), '카페');
  assert.equal(guessCategory('행복약국', map), '병원비/약');
  assert.equal(guessCategory('KTX 부산역', map), DEFAULT_CATEGORY); // KT 통신 아님
  assert.equal(guessCategory('KT 통신요금', map), '통신비');
  assert.equal(guessCategory('알 수 없는 가게', map), DEFAULT_CATEGORY);
  assert.equal(guessCategory('', map), DEFAULT_CATEGORY);
});
