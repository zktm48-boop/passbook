// 창호미니 통장 — 구글 시트 API (Apps Script 웹 앱)
// 배포: 실행 계정 "나", 액세스 "모든 사용자". 토큰은 프로젝트 설정 > 스크립트 속성 TOKEN.

const SHEET_TX = '거래';
const SHEET_SETTINGS = '설정';
const HEADERS = ['id', '날짜', '구분', '내역', '분류', '금액', '요약', '입력시각'];
const KIND_TO_KO = { income: '수입', expense: '지출', transfer: '이체' };
const KO_TO_KIND = { '수입': 'income', '지출': 'expense', '이체': 'transfer' };
const MAX_ROWS_PER_ADD = 500;

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action !== 'list') return json_({ status: 'error', message: 'GET 요청은 list만 지원해요' });
  return handle_(p);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ status: 'error', message: '요청 형식이 잘못됐어요' });
  }
  return handle_(body);
}

function handle_(req) {
  try {
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token) return json_({ status: 'error', message: '스크립트 속성에 TOKEN이 설정되지 않았어요' });
    if (req.token !== token) return json_({ status: 'error', message: '토큰이 올바르지 않아요' });
    if (req.action === 'list') return json_(withLock_(list_));
    if (req.action === 'add') return json_(withLock_(function () { return add_(req.rows, req.requestId); }));
    if (req.action === 'delete') return json_(withLock_(function () { return remove_(req.id); }));
    return json_({ status: 'error', message: '알 수 없는 요청이에요: ' + req.action });
  } catch (err) {
    return json_({ status: 'error', message: String((err && err.message) || err) });
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- 시트 ----------

function txSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_TX);
  if (!sh) {
    sh = ss.insertSheet(SHEET_TX);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('B:B').setNumberFormat('@'); // 날짜를 텍스트로 유지
  }
  return sh;
}

function settingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_SETTINGS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_SETTINGS);
    sh.getRange('B2').setNumberFormat('@');
    sh.getRange(1, 1, 2, 2).setValues([['시작잔액', 0], ['시작일', '']]);
  }
  return sh;
}

function writeSettings_(s) {
  const sh = settingsSheet_();
  sh.clear();
  sh.getRange('B2').setNumberFormat('@');
  sh.getRange(1, 1, 2, 2).setValues([['시작잔액', s.startBalance], ['시작일', s.startDate]]);
}

function readSettings_() {
  const tz = sheetTz_();
  const out = { startBalance: 0, startDate: '' };
  settingsSheet_().getDataRange().getValues().forEach(function (r) {
    const key = String(r[0]).trim();
    if (key === '시작잔액') out.startBalance = toNumber_(r[1]) || 0;
    if (key === '시작일') out.startDate = r[1] instanceof Date ? Utilities.formatDate(r[1], tz, 'yyyy-MM-dd') : String(r[1]).trim();
  });
  return out;
}

// ---------- 순수 함수 (tests/code-gs.test.mjs) ----------

function sheetTz_() {
  // 스크립트 프로젝트 시간대가 아니라 시트 시간대 기준으로 날짜 칸을 읽어야 하루 밀리지 않는다
  return SpreadsheetApp.getActive().getSpreadsheetTimeZone();
}

function toNumber_(v) {
  return Number(String(v).replace(/[,\s원₩]/g, ''));
}

function isRealDate_(s) {
  const p = s.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function escapeCell_(s) {
  // 항상 앞에 '를 붙여 글자로 저장: 수식(=, +, -, @)이나 날짜·숫자처럼 보이는 글자가 자동 변환되지 않도록
  return "'" + s;
}

function validateRow_(r, i) {
  const where = (i + 1) + '번째 거래: ';
  if (!r || typeof r !== 'object') throw new Error(where + '형식이 잘못됐어요');
  const date = String(r.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRealDate_(date)) throw new Error(where + '날짜가 잘못됐어요 (' + date + ')');
  if (!KIND_TO_KO[r.kind]) throw new Error(where + '구분이 잘못됐어요 (' + r.kind + ')');
  const name = String(r.name || '').trim();
  const cat = String(r.cat || '').trim();
  if (!name || !cat) throw new Error(where + '내역과 분류를 모두 입력해 주세요');
  if (name.length > 100 || cat.length > 30) throw new Error(where + '내역 또는 분류가 너무 길어요');
  const amount = Number(r.amount);
  if (!isFinite(amount) || amount <= 0 || Math.round(amount) !== amount || amount > 1e10) {
    throw new Error(where + '금액은 1원 이상의 정수여야 해요');
  }
  return { date: date, kind: r.kind, name: name, cat: cat, amount: amount, summary: r.summary === true };
}

function normalizeSheetRow_(v, tz) {
  const date = v[1] instanceof Date ? Utilities.formatDate(v[1], tz, 'yyyy-MM-dd') : String(v[1]).trim();
  const kind = KO_TO_KIND[String(v[2]).trim()];
  const amount = toNumber_(v[5]);
  const name = String(v[3]).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRealDate_(date) || !kind || !(amount > 0) || !name) return null;
  return {
    id: String(v[0]),
    date: date,
    kind: kind,
    name: name,
    cat: String(v[4]).trim() || '기타',
    amount: Math.round(amount),
    summary: String(v[6]).trim().toUpperCase() === 'Y',
  };
}

// 기존 연도 탭(날짜/내역/분류/수입/지출/이체/잔액) 한 줄 → {row} | {carry: 잔액} | {skip: 이유} | null(빈 줄)
function convertLegacyRow_(v, year, tz) {
  const name = String(v[1]).trim();
  if (!String(v[0]).trim() && !name) return null;
  let date = null;
  if (v[0] instanceof Date) {
    date = Utilities.formatDate(v[0], tz, 'yyyy-MM-dd');
  } else {
    const m = String(v[0]).match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (m) date = year + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  }
  if (!date || !isRealDate_(date)) return { skip: '날짜를 읽지 못함' };
  const income = toNumber_(v[3]) || 0;
  const expense = toNumber_(v[4]) || 0;
  const transfer = toNumber_(v[5]) || 0;
  const cat = String(v[2]).trim() || '기타';
  const make = function (kind, amount) {
    return { row: { date: date, kind: kind, name: name, cat: cat, amount: Math.round(Math.abs(amount)), summary: false } };
  };
  if (income > 0) return make('income', income);
  if (expense > 0) return make('expense', expense);
  if (expense < 0) return { skip: '지출이 음수(환불 등)' };
  if (transfer !== 0) return make('transfer', transfer);
  if (name.indexOf('이월') !== -1) return { carry: toNumber_(v[6]) || 0 };
  return { skip: '금액이 없음' };
}

// '날짜' 바로 오른쪽 칸이 '내역'인 제목 줄을 어느 열에서든 찾는다 (위쪽 50줄 안)
function findLegacyHeader_(values) {
  const clean = function (c) { return String(c).replace(/\s+/g, ''); };
  for (let r = 0; r < Math.min(values.length, 50); r++) {
    for (let c = 0; c < values[r].length - 1; c++) {
      if (clean(values[r][c]) === '날짜' && clean(values[r][c + 1]) === '내역') return { row: r, col: c };
    }
  }
  return null;
}

// 앱 거래 → 기존 연도 탭 한 줄 [날짜, 내역, 분류, 수입, 지출, 이체] (잔액은 따로 처리)
function legacyLine_(r, asDate) {
  const p = r.date.split('-').map(Number);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  const label = ('0' + p[1]).slice(-2) + '월 ' + ('0' + p[2]).slice(-2) + '일 (' + days[dow] + ')';
  return [
    asDate ? new Date(p[0], p[1] - 1, p[2]) : label,
    escapeCell_(r.name),
    escapeCell_(r.cat),
    r.kind === 'income' ? r.amount : '',
    r.kind === 'expense' ? r.amount : '',
    r.kind === 'transfer' ? -r.amount : '', // 기존 탭은 이체를 음수로 적음
  ];
}

// 추가된 거래를 연도별 기존 탭('2026년' 등) 맨 아래에도 적는다. 실패해도 앱 저장은 유지하고 경고만 돌려준다.
function mirrorToYearSheets_(clean) {
  const ss = SpreadsheetApp.getActive();
  const byYear = {};
  clean.forEach(function (r) {
    const y = r.date.slice(0, 4);
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(r);
  });
  const warnings = [];
  Object.keys(byYear).forEach(function (y) {
    const sh = ss.getSheetByName(y + '년');
    if (!sh) { warnings.push("'" + y + "년' 탭이 없어서 그 탭에는 적지 않았어요"); return; }
    try {
      appendLegacyRows_(sh, byYear[y]);
    } catch (err) {
      warnings.push("'" + y + "년' 탭에 적지 못했어요: " + ((err && err.message) || err));
    }
  });
  return warnings;
}

function appendLegacyRows_(sh, rows) {
  const values = sh.getDataRange().getValues();
  const h = findLegacyHeader_(values);
  if (!h) throw new Error("'날짜/내역' 제목 줄을 찾지 못했어요");
  // 날짜·내역 칸 기준 마지막 거래 줄 (오른쪽 요약표나 미리 채워 둔 잔액 수식 줄은 무시)
  let last = h.row;
  for (let i = h.row + 1; i < values.length; i++) {
    if (String(values[i][h.col]).trim() !== '' || String(values[i][h.col + 1]).trim() !== '') last = i;
  }
  const col = h.col + 1;      // 1부터 세는 열 번호
  const lastRow = last + 1;   // 1부터 세는 행 번호
  const useDate = values[last][h.col] instanceof Date;
  const balFormula = last > h.row ? sh.getRange(lastRow, col + 6).getFormulaR1C1() : '';
  let bal = toNumber_(values[last][h.col + 6]) || 0;
  rows.forEach(function (r, k) {
    const rowNum = lastRow + 1 + k;
    if (last > h.row) {
      sh.getRange(lastRow, col, 1, 7).copyTo(sh.getRange(rowNum, col, 1, 7), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    }
    sh.getRange(rowNum, col, 1, 6).setValues([legacyLine_(r, useDate)]);
    const balCell = sh.getRange(rowNum, col + 6);
    bal += r.kind === 'income' ? r.amount : -r.amount;
    if (balFormula) balCell.setFormulaR1C1(balFormula);   // 윗줄 잔액 수식을 그대로 이어서
    else if (!balCell.getFormula()) balCell.setValue(bal); // 수식이 없으면 계산값
  });
}

// Apps Script 편집기에서 한 번 실행: 기존 '2026년' 탭의 거래를 '거래' 탭으로 복사 (기존 탭은 그대로 둠)
function importLedger() {
  importFromYearSheet_('2026년');
}

function importFromYearSheet_(tabName) {
  const ss = SpreadsheetApp.getActive();
  const src = ss.getSheetByName(tabName);
  if (!src) throw new Error("'" + tabName + "' 탭을 찾지 못했어요");
  const tx = txSheet_();
  if (tx.getLastRow() > 1) throw new Error("'거래' 탭에 이미 데이터가 있어서 가져오지 않았어요");
  const year = Number(String(tabName).replace(/\D/g, '')) || new Date().getFullYear();
  const tz = sheetTz_();
  const values = src.getDataRange().getValues();
  const header = findLegacyHeader_(values);
  if (!header) throw new Error("'" + tabName + "' 탭에서 '날짜/내역' 제목 줄을 찾지 못했어요");
  const rows = [];
  const skipped = [];
  let carry = 0;
  for (let i = header.row + 1; i < values.length; i++) {
    const v = values[i].slice(header.col, header.col + 7); // 날짜~잔액 7칸
    const r = convertLegacyRow_(v, year, tz);
    if (!r) continue;
    if (r.row) rows.push(r.row);
    else if (r.carry !== undefined) carry = r.carry;
    else skipped.push((i + 1) + '행 ' + v[1] + ': ' + r.skip);
  }
  writeSettings_({ startBalance: carry, startDate: year + '-01-01' });
  const clean = rows.map(validateRow_);
  if (clean.length) appendRows_(clean);
  Logger.log('가져온 거래 ' + clean.length + '건, 시작잔액 ' + carry + ', 건너뛴 줄 ' + skipped.length + '개');
  skipped.forEach(function (s) { Logger.log('건너뜀: ' + s); });
}

// ---------- 동작 ----------

function newId_() {
  return 't_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function list_() {
  const sh = txSheet_();
  const last = sh.getLastRow();
  const tz = sheetTz_();
  const rows = [];
  let skipped = 0;
  if (last >= 2) {
    const values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
    values.forEach(function (v, i) {
      if (v.every(function (c) { return c === '' || c === null; })) return; // 빈 줄
      if (!v[0]) { // 시트에서 직접 추가한 줄: id 부여
        v[0] = newId_();
        sh.getRange(i + 2, 1).setValue(v[0]);
      }
      const row = normalizeSheetRow_(v, tz);
      if (row) rows.push(row); else skipped++;
    });
  }
  return { status: 'ok', settings: readSettings_(), rows: rows, skipped: skipped };
}

function appendRows_(clean) {
  const sh = txSheet_();
  const stamp = Utilities.formatDate(new Date(), sheetTz_(), 'yyyy-MM-dd HH:mm');
  const ids = [];
  const values = clean.map(function (r) {
    const id = newId_();
    ids.push(id);
    return [id, r.date, KIND_TO_KO[r.kind], escapeCell_(r.name), escapeCell_(r.cat), r.amount, r.summary ? 'Y' : '', stamp];
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, HEADERS.length).setValues(values);
  return ids;
}

function add_(rows, requestId) {
  // 같은 requestId로 다시 오면(앱이 응답을 못 받고 재시도) 새로 쓰지 않고 이전 결과를 돌려준다. 6시간 보관.
  const cache = requestId ? CacheService.getScriptCache() : null;
  const key = requestId ? 'add_' + String(requestId).slice(0, 200) : null;
  if (cache) {
    const hit = cache.get(key);
    if (hit) return { status: 'ok', ids: JSON.parse(hit), duplicate: true };
  }
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('추가할 거래가 없어요');
  if (rows.length > MAX_ROWS_PER_ADD) throw new Error('한 번에 ' + MAX_ROWS_PER_ADD + '건까지만 추가할 수 있어요');
  const clean = rows.map(validateRow_); // 하나라도 틀리면 여기서 중단 → 아무것도 쓰지 않음
  const ids = appendRows_(clean);
  if (cache) cache.put(key, JSON.stringify(ids), 21600);
  const warnings = mirrorToYearSheets_(clean);
  return { status: 'ok', ids: ids, warnings: warnings };
}

function remove_(id) {
  if (!id) throw new Error('삭제할 거래 id가 없어요');
  const sh = txSheet_();
  const last = sh.getLastRow();
  if (last >= 2) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        sh.deleteRow(i + 2);
        return { status: 'ok' };
      }
    }
  }
  throw new Error('이미 지워졌거나 없는 거래예요. 동기화 후 다시 확인해 주세요');
}
