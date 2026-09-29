process.env.TZ = 'Asia/Seoul';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toISODate, localISODate, lastDayOfMonth, formatKoreanDate, parseDateFlexible } from '../js/dates.js';

test('toISODate pads and rejects impossible dates', () => {
  assert.equal(toISODate(2026, 1, 5), '2026-01-05');
  assert.equal(toISODate(2026, 2, 30), null);
  assert.equal(toISODate(2026, 13, 1), null);
});

test('localISODate uses local calendar day (no UTC shift in KST)', () => {
  assert.equal(localISODate(new Date(2026, 0, 24, 0, 30)), '2026-01-24');
});

test('lastDayOfMonth', () => {
  assert.equal(lastDayOfMonth(2026, 2), 28);
  assert.equal(lastDayOfMonth(2028, 2), 29);
  assert.equal(lastDayOfMonth(2026, 8), 31);
});

test('formatKoreanDate adds weekday', () => {
  assert.equal(formatKoreanDate('2026-01-24'), '01월 24일 (토)');
  assert.equal(formatKoreanDate('2026-01-01'), '01월 01일 (목)');
});

test('parseDateFlexible handles many formats', () => {
  assert.equal(parseDateFlexible('2026-01-24', 2026), '2026-01-24');
  assert.equal(parseDateFlexible('2026.1.24', 2026), '2026-01-24');
  assert.equal(parseDateFlexible('2026년 1월 24일', 2026), '2026-01-24');
  assert.equal(parseDateFlexible('01/24', 2026), '2026-01-24');
  assert.equal(parseDateFlexible('20260124', 2026), '2026-01-24');
  assert.equal(parseDateFlexible(46046, 2026), '2026-01-24'); // 엑셀 일련번호
  assert.equal(parseDateFlexible(new Date(2026, 0, 24), 2026), '2026-01-24'); // KST 자정
  assert.equal(parseDateFlexible(new Date(Date.UTC(2026, 0, 24)), 2026), '2026-01-24'); // UTC 자정
  assert.equal(parseDateFlexible('소계', 2026), null);
  assert.equal(parseDateFlexible('', 2026), null);
  assert.equal(parseDateFlexible('02/30', 2026), null);
});

test('year-less dates later than today+7d belong to the previous year (Dec statement read in Jan)', () => {
  const jan5 = new Date(2027, 0, 5);
  assert.equal(parseDateFlexible('12/28', 2027, jan5), '2026-12-28');
  assert.equal(parseDateFlexible('01/03', 2027, jan5), '2027-01-03');
  assert.equal(parseDateFlexible('01/10', 2027, jan5), '2027-01-10'); // 7일 이내 미래는 그대로
});
