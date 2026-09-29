import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadGs() {
  const ctx = vm.createContext({
    Utilities: { formatDate: (d, tz, fmt) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` },
  });
  vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  return ctx;
}

test('validateRow_ accepts good rows and normalizes', () => {
  const gs = loadGs();
  assert.deepEqual(
    JSON.parse(JSON.stringify(gs.validateRow_({ date: '2026-09-01', kind: 'expense', name: ' 이마트 ', cat: '식비', amount: 5000 }, 0))),
    { date: '2026-09-01', kind: 'expense', name: '이마트', cat: '식비', amount: 5000, summary: false });
});

test('validateRow_ rejects bad input with row number', () => {
  const gs = loadGs();
  const bad = [
    [{ date: '2026-02-30', kind: 'expense', name: 'a', cat: 'b', amount: 1 }, /날짜/],
    [{ date: '2026-09-01', kind: 'gift', name: 'a', cat: 'b', amount: 1 }, /구분/],
    [{ date: '2026-09-01', kind: 'income', name: '', cat: 'b', amount: 1 }, /내역/],
    [{ date: '2026-09-01', kind: 'income', name: 'a', cat: 'b', amount: 1.5 }, /금액/],
    [{ date: '2026-09-01', kind: 'income', name: 'a', cat: 'b', amount: -3 }, /금액/],
  ];
  for (const [row, re] of bad) assert.throws(() => gs.validateRow_(row, 2), e => re.test(e.message) && /3번째/.test(e.message));
});

test('escapeCell_ neutralizes formulas', () => {
  const gs = loadGs();
  assert.equal(gs.escapeCell_('=HYPERLINK("x")'), "'=HYPERLINK(\"x\")");
  assert.equal(gs.escapeCell_('+82'), "'+82");
  assert.equal(gs.escapeCell_('이마트'), "'이마트");
  assert.equal(gs.escapeCell_('2026-01-05'), "'2026-01-05"); // 날짜·숫자처럼 보이는 글자도 그대로
});

test('normalizeSheetRow_ tolerates hand-edited cells', () => {
  const gs = loadGs();
  // Date는 vm 컨텍스트 안에서 만들어야 Code.gs의 `instanceof Date`가 참이 된다 (realm이 다르면 거짓)
  const sheetDate = vm.runInContext('new Date(Date.UTC(2026, 0, 24))', gs);
  const ok = gs.normalizeSheetRow_(['t_1', sheetDate, '지출', '이마트', '식비', '12,340', 'y', ''], 'Asia/Seoul');
  assert.deepEqual(JSON.parse(JSON.stringify(ok)), { id: 't_1', date: '2026-01-24', kind: 'expense', name: '이마트', cat: '식비', amount: 12340, summary: true });
  const noCat = gs.normalizeSheetRow_(['t_2', '2026-01-24', '수입', '이자', '', 100, '', ''], 'Asia/Seoul');
  assert.equal(noCat.cat, '기타');
  assert.equal(gs.normalizeSheetRow_(['t_3', '어제', '지출', 'a', 'b', 1, '', ''], 'Asia/Seoul'), null);
  assert.equal(gs.normalizeSheetRow_(['t_4', '2026-01-24', '환불', 'a', 'b', 1, '', ''], 'Asia/Seoul'), null);
  assert.equal(gs.normalizeSheetRow_(['t_5', '2026-01-24', '지출', 'a', 'b', 0, '', ''], 'Asia/Seoul'), null);
});

test('sheetTz_ uses the spreadsheet timezone, not the script project timezone', () => {
  const gs = loadGs();
  gs.SpreadsheetApp = { getActive: () => ({ getSpreadsheetTimeZone: () => 'Asia/Seoul' }) };
  gs.Session = { getScriptTimeZone: () => 'America/New_York' };
  assert.equal(gs.sheetTz_(), 'Asia/Seoul');
});

test('add_ with the same requestId appends only once and returns the same ids', () => {
  const gs = loadGs();
  const store = new Map();
  gs.CacheService = { getScriptCache: () => ({ get: k => store.get(k) ?? null, put: (k, v) => store.set(k, v) }) };
  let appends = 0;
  gs.appendRows_ = clean => { appends++; return clean.map((_, i) => 't_' + appends + '_' + i); };
  gs.mirrorToYearSheets_ = () => [];
  const rows = [{ date: '2026-09-01', kind: 'expense', name: 'a', cat: 'b', amount: 1 }];
  const first = gs.add_(rows, 'req-1');
  const second = gs.add_(rows, 'req-1');
  assert.equal(appends, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(second.ids)), JSON.parse(JSON.stringify(first.ids)));
  gs.add_(rows, 'req-2');
  assert.equal(appends, 2);
});

test('convertLegacyRow_ maps the old yearly tab (날짜/내역/분류/수입/지출/이체/잔액)', () => {
  const gs = loadGs();
  const conv = v => JSON.parse(JSON.stringify(gs.convertLegacyRow_(v, 2026, 'Asia/Seoul')));
  assert.deepEqual(conv([' 01월 23일 (금)', '월급 입금', '월급', '1,000', '', '', '5,000']),
    { row: { date: '2026-01-23', kind: 'income', name: '월급 입금', cat: '월급', amount: 1000, summary: false } });
  assert.deepEqual(conv(['01월 24일 (토)', '마트', '식비', '', '2,500', '', '2,500']).row.kind, 'expense');
  assert.deepEqual(conv(['01월 24일 (토)', '적금', '저축', '', '', '-90,000', '1']).row, { date: '2026-01-24', kind: 'transfer', name: '적금', cat: '저축', amount: 90000, summary: false });
  assert.deepEqual(conv(['01월 01일 (목)', '전년도 이월금', '기타', '', '', '', '4,000']), { carry: 4000 });
  const d = vm.runInContext('new Date(Date.UTC(2026, 2, 5))', gs);
  assert.equal(conv([d, '가게', '식비', '', 300, '', '']).row.date, '2026-03-05');
  assert.equal(gs.convertLegacyRow_(['', '', '', '', '', '', ''], 2026, 'Asia/Seoul'), null); // 빈 줄
  assert.deepEqual(conv(['01월 25일 (일)', '환불', '식비', '', '-3,000', '', '']), { skip: '지출이 음수(환불 등)' });
  assert.deepEqual(conv(['날짜', '내역', '분류', '수입', '지출', '이체', '잔액']), { skip: '날짜를 읽지 못함' });
});

test('findLegacyHeader_ finds 날짜/내역 in any column, tolerating spaces', () => {
  const gs = loadGs();
  const values = [
    ['', '31', '', ''],
    ['', '2026년 창호미니 부자되기 프로젝트', '', ''],
    ['', 'EX)1-11', '내용만 기재', ''],
    ['', ' 날짜 ', '내역\n', '분류'],
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(gs.findLegacyHeader_(values))), { row: 3, col: 1 });
  assert.equal(gs.findLegacyHeader_([['a', 'b']]), null);
});

test('legacyLine_ builds a row in the old yearly-tab format', () => {
  const gs = loadGs();
  const line = r => JSON.parse(JSON.stringify(gs.legacyLine_(r, false)));
  assert.deepEqual(line({ date: '2026-01-24', kind: 'expense', name: '마트', cat: '식비', amount: 2500 }), ['01월 24일 (토)', "'마트", "'식비", '', 2500, '']);
  assert.deepEqual(line({ date: '2026-09-01', kind: 'income', name: '월급', cat: '월급', amount: 100 }), ['09월 01일 (화)', "'월급", "'월급", 100, '', '']);
  assert.deepEqual(line({ date: '2026-09-01', kind: 'transfer', name: '적금', cat: '저축', amount: 90000 }), ['09월 01일 (화)', "'적금", "'저축", '', '', -90000]);
  const asDate = gs.legacyLine_({ date: '2026-03-05', kind: 'expense', name: 'a', cat: 'b', amount: 1 }, true)[0];
  assert.equal(asDate.getFullYear() * 10000 + (asDate.getMonth() + 1) * 100 + asDate.getDate(), 20260305);
});
