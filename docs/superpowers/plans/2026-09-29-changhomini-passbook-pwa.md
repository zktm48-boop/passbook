# 창호미니 통장 PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 단일 HTML 가계부를 GitHub Pages에 올리는 설치형 PWA로 만들고, Apps Script 웹 앱을 통해 구글 시트를 유일한 데이터 원본으로 쓴다.

**Architecture:** 빌드 도구 없는 정적 사이트(ES 모듈). 순수 로직(`dates`, `model`, `categorize`, `parsers`, `api`)은 Node 테스트로 검증하고, `app.js`가 DOM·차트·이벤트를 담당한다. 시트 쪽은 `Code.gs` 하나가 `list/add/delete`를 처리하고, 초기 데이터는 git 제외 파일 `Seed.gs`로 한 번 넣는다.

**Tech Stack:** HTML/CSS/바닐라 JS(ES 모듈), Chart.js 4.4.0, SheetJS 0.18.5, pdf.js 3.11.174 (모두 cdnjs), Service Worker, Google Apps Script(V8), Node 24 `node --test`, PowerShell 5.1 + System.Drawing(아이콘 생성).

**Spec:** `docs/superpowers/specs/2026-09-29-changhomini-passbook-pwa-design.md`

## Global Constraints

- 공개 저장소: 코드·커밋에 토큰, Apps Script URL, 실제 가계 데이터 금지. `reference/`, `apps-script/Seed.gs`는 `.gitignore`에 이미 있음.
- 시트 날짜는 `YYYY-MM-DD` 텍스트. 금액은 양의 정수. 구분은 시트 `수입|지출|이체` ↔ API `income|expense|transfer`.
- 잔액은 저장하지 않고 `시작잔액 + 수입 − 지출 − 이체`로 계산.
- 날짜 생성에 `toISOString()` 사용 금지 (한국 시간대에서 하루 밀림). `js/dates.js` 함수만 사용.
- 외부 문자열(가맹점명, 시트 값)은 `esc()`를 거쳐 HTML에 출력.
- 앱 안 거래 수정 없음, 오프라인 입력 대기열 없음, 로그인 없음.
- POST는 `Content-Type: text/plain;charset=utf-8` (CORS preflight 회피).
- CDN 주소는 원본과 동일: `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js`, `.../xlsx/0.18.5/xlsx.full.min.js`, `.../pdf.js/3.11.174/pdf.min.js`, 워커 `.../pdf.js/3.11.174/pdf.worker.min.js`.
- UI 문구는 한국어 존댓말(해요체), 기존 디자인 토큰(`--navy`, `--brass` 등) 유지.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **사용자가 시트를 직접 고친 줄** (날짜 칸이 Date로 바뀜, 금액에 쉼표, 빈 줄, id 없는 줄) → 앱이 깨지지 않고 읽을 수 있는 줄은 읽고, 못 읽는 줄은 건너뛴 개수를 알려야 함. → Task 6 `normalizeSheetRow_` 테스트.
2. **잘못된 URL / "모든 사용자" 권한이 아닌 배포** (JSON 대신 로그인 HTML이 옴) → 이해할 수 있는 한국어 오류, 앱은 캐시 데이터로 계속 동작. → Task 5 테스트.
3. **같은 명세서를 두 번 업로드** → 이미 있는 거래는 미리보기에서 기본 해제 + "이미 있음" 표시. → Task 2 `isDuplicate` 테스트 + Task 9.
4. **한국 시간대에서 날짜** (엑셀 Date 셀, 입력 폼) → 하루 밀리지 않음. → Task 1 테스트(TZ=Asia/Seoul).
5. **`=`, `+`, `-`, `@`로 시작하는 가맹점명** → 시트에서 수식으로 실행되지 않고 글자 그대로 저장. → Task 6 `escapeCell_` 테스트.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `package.json` | `"type":"module"`, `npm test` = `node --test` |
| `js/dates.js` | ISO 날짜 생성/검증, 한국어 날짜 표시, 유연한 날짜 파싱 |
| `js/model.js` | 거래 배열 → 월별 합계, 분류 합계, 잔액, 저축률, 월 거래내역, 중복 판정 |
| `js/categorize.js` | 가맹점 → 분류 추측 |
| `js/parsers.js` | 엑셀 행 배열 / PDF 줄 → 후보 거래, pdf.js 텍스트 추출 |
| `js/api.js` | 설정·캐시(localStorage), Apps Script 호출 |
| `js/app.js` | 렌더링, 이벤트, 서비스 워커 등록 |
| `index.html` | 마크업 + CSS |
| `manifest.webmanifest`, `sw.js`, `icons/*`, `.nojekyll` | PWA |
| `apps-script/Code.gs` | 시트 API |
| `apps-script/Seed.gs` | (생성물, git 제외) 초기 데이터 |
| `tools/seed-lib.mjs`, `tools/build-seed.mjs` | 원본 HTML → Seed.gs |
| `tools/make-icons.ps1` | 아이콘 PNG 생성 |
| `tools/serve.mjs` | 로컬 확인용 정적 서버 |
| `tests/*.test.mjs` | 단위 테스트 |
| `docs/SETUP.md`, `README.md` | 설치 안내 |

---

### Task 1: 프로젝트 설정 + 날짜 유틸

**Files:**
- Create: `package.json`, `js/dates.js`
- Test: `tests/dates.test.mjs`

**Interfaces:**
- Produces:
  - `toISODate(y:number, m:number, d:number) → string|null` (존재하지 않는 날짜면 null)
  - `localISODate(date:Date) → string`
  - `lastDayOfMonth(y, m) → number`
  - `formatKoreanDate(iso) → "01월 24일 (토)"`
  - `parseDateFlexible(v:any, defaultYear:number) → string|null` (Date, 엑셀 일련번호, `2026-01-24`, `2026.1.24`, `2026년 1월 24일`, `01/24`, `20260124`)

- [ ] **Step 1: git 사용자 설정과 package.json**

```bash
git config user.name "ckdgh"
git config user.email "zktm48@gmail.com"
```

`package.json`:
```json
{
  "name": "changhomini-passbook",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "serve": "node tools/serve.mjs",
    "seed": "node tools/build-seed.mjs"
  }
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/dates.test.mjs`

```js
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
```

- [ ] **Step 3: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module ... js/dates.js`

- [ ] **Step 4: 구현** — `js/dates.js`

```js
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

export function parseDateFlexible(v, defaultYear) {
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
  if (m) return toISODate(defaultYear, +m[1], +m[2]);
  return null;
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json js/dates.js tests/dates.test.mjs
git commit -m "feat: 날짜 유틸 (한국 시간대 하루 밀림 방지)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 계산 모델

**Files:**
- Create: `js/model.js`
- Test: `tests/model.test.mjs`

**Interfaces:**
- Consumes: `lastDayOfMonth` (Task 1)
- Produces (Row = `{id, date:'YYYY-MM-DD', kind:'income'|'expense'|'transfer', name, cat, amount:number, summary:boolean}`):
  - `pickYear(rows, today:Date) → number` — 데이터 중 가장 늦은 연도, 없으면 오늘 연도
  - `monthRange(rows, year, today) → number[]` — `[1..last]`, last = max(그 연도 데이터의 마지막 달, 올해면 오늘 달)
  - `latestDataMonth(rows, year) → number|null`
  - `monthlyTotals(rows, year) → {income:number[12], expense:number[12], transfer:number[12]}`
  - `categoryTotals(rows, year, month, kind) → [cat, amount][]` 큰 순, 0 제외
  - `endOfMonth(year, month) → 'YYYY-MM-DD'`
  - `balanceAt(rows, startBalance, isoDate) → number` — 그 날짜까지(포함)
  - `savingRates(totals) → (number|null)[]` — 수입 0이면 null, 소수 1자리
  - `ledgerForMonth(rows, startBalance, year, month) → (Row & {balance})[]` — 날짜순, 같은 날은 원래 순서
  - `isDuplicate(candidate:{date,name,amount}, rows) → boolean`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/model.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickYear, monthRange, latestDataMonth, monthlyTotals, categoryTotals, endOfMonth, balanceAt, savingRates, ledgerForMonth, isDuplicate } from '../js/model.js';

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
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module ... js/model.js`

- [ ] **Step 3: 구현** — `js/model.js`

```js
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

export function ledgerForMonth(rows, startBalance, year, month) {
  const prefix = `${year}-${pad(month)}`;
  const sorted = rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : a.i - b.i));
  const out = [];
  let bal = startBalance;
  for (const { row } of sorted) {
    bal += signed(row);
    if (row.date.startsWith(prefix)) out.push({ ...row, balance: bal });
  }
  return out;
}

export function isDuplicate(c, rows) {
  return rows.some(r => r.date === c.date && r.amount === c.amount && r.name === c.name);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS (dates 5 + model 7)

- [ ] **Step 5: Commit**

```bash
git add js/model.js tests/model.test.mjs
git commit -m "feat: 월별 합계·잔액·저축률 계산 모델

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 분류 추측

**Files:**
- Create: `js/categorize.js`
- Test: `tests/categorize.test.mjs`

**Interfaces:**
- Consumes: Row 형식 (Task 2)
- Produces: `CATEGORY_KEYWORDS: [RegExp, string][]`, `DEFAULT_CATEGORY = '기타 생활비'`, `buildMerchantMap(rows) → {[name]: cat}` (요약 줄·지출 아닌 줄 제외), `guessCategory(name, merchantMap) → string`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/categorize.test.mjs`

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module ... js/categorize.js`

- [ ] **Step 3: 구현** — `js/categorize.js`

```js
export const DEFAULT_CATEGORY = '기타 생활비';

// 순서가 중요하다: 위에서부터 처음 맞는 규칙을 쓴다 (예: 이마트24는 편의점이라 이마트보다 먼저).
export const CATEGORY_KEYWORDS = [
  [/약국|의원|병원|한의원|치과|정형외과|피부과|내과|이비인후과|소아과/, '병원비/약'],
  [/스타벅스|이디야|투썸|카페|커피|빽다방|메가커피|컴포즈/, '카페'],
  [/GS25|CU|세븐일레븐|이마트24|미니스톱|씨유/, '생필품'],
  [/주유소|오일뱅크|S-OIL|칼텍스|주유/, '유류비'],
  [/정비|카센터|타이어|자동차|세차|스피드메이트/, '차량유지비'],
  [/네이버페이|쿠팡|11번가|지마켓|옥션|마켓컬리|SSG/, '쇼핑'],
  [/SKT|KT(?!X)|LG유플러스|통신|텔레콤/, '통신비'],
  [/다이소|아트박스|올리브영/, '생필품'],
  [/이마트|롯데마트|홈플러스|하나로마트/, '식비'],
  [/김밥|분식|치킨|피자|버거|맥도날드|국밥|식당|반점|고기|삼겹살|족발|갈비/, '외식비'],
  [/택시|버스|지하철|주차/, '교통비'],
  [/영화|CGV|롯데시네마|메가박스|공연/, '문화생활'],
  [/헬스|필라테스|요가|미용실|피부관리/, '미용'],
  [/코웨이|연회비/, '기타 생활비'],
];

export function buildMerchantMap(rows) {
  const counts = new Map();
  for (const r of rows) {
    if (r.summary || r.kind !== 'expense') continue;
    const name = r.name.trim();
    if (!name) continue;
    if (!counts.has(name)) counts.set(name, new Map());
    const byCat = counts.get(name);
    byCat.set(r.cat, (byCat.get(r.cat) || 0) + 1);
  }
  const map = {};
  for (const [name, byCat] of counts) {
    let best = null, bestN = 0;
    for (const [cat, n] of byCat) if (n > bestN) { best = cat; bestN = n; }
    map[name] = best;
  }
  return map;
}

export function guessCategory(name, merchantMap) {
  const t = String(name ?? '').trim();
  if (!t) return DEFAULT_CATEGORY;
  // 1) 예전에 똑같은 가맹점을 쓴 적이 있으면 그 분류
  if (Object.hasOwn(merchantMap, t)) return merchantMap[t];
  // 2) 메모·지점명이 붙어 이름이 조금 다르면 포함 관계로
  for (const known of Object.keys(merchantMap)) {
    if (known.length >= 3 && t.length >= 3 && (t.includes(known) || known.includes(t))) return merchantMap[known];
  }
  // 3) 업종 키워드
  for (const [re, cat] of CATEGORY_KEYWORDS) if (re.test(t)) return cat;
  return DEFAULT_CATEGORY;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/categorize.js tests/categorize.test.mjs
git commit -m "feat: 가맹점 분류 추측 (과거 거래 학습 + 키워드)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 명세서 파서

**Files:**
- Create: `js/parsers.js`
- Test: `tests/parsers.test.mjs`

**Interfaces:**
- Consumes: `parseDateFlexible` (Task 1)
- Produces:
  - `parseTableRows(rows:any[][], defaultYear) → {format:'simple'|'card', items:{date,name,amount,cat?}[]}` — 카드 명세서 헤더를 못 찾으면 `Error('명세서 형식을 알아보지 못했어요 (이용일/가맹점 열을 못 찾음)')`
  - `parsePdfLines(lines:string[], defaultYear) → {date,name,amount}[]`
  - `extractPdfLines(buf:ArrayBuffer, pdfjsLib) → Promise<string[]>` (브라우저 전용, 테스트 없음)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/parsers.test.mjs`

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module ... js/parsers.js`

- [ ] **Step 3: 구현** — `js/parsers.js`

```js
import { parseDateFlexible } from './dates.js';

const toNum = v => {
  const n = Number(String(v ?? '').replace(/[,\s원₩]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const cellText = v => String(v ?? '').trim();

export function parseTableRows(rows, defaultYear) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map(cellText);
    const d = row.indexOf('날짜'), c = row.indexOf('항목'), a = row.indexOf('금액');
    if (d !== -1 && c !== -1 && a !== -1) {
      return { format: 'simple', items: parseSimple(rows, i, d, c, a, defaultYear) };
    }
  }
  return { format: 'card', items: parseCard(rows, defaultYear) };
}

function parseSimple(rows, headerIdx, dateCol, catCol, amtCol, year) {
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const cat = cellText(row[catCol]);
    const amount = Math.abs(Math.round(toNum(row[amtCol])));
    const date = parseDateFlexible(row[dateCol], year);
    if (!cat || !amount || !date) continue;
    out.push({ date, name: cat, amount, cat });
  }
  return out;
}

function parseCard(rows, year) {
  // 카드사마다 헤더 문구가 달라서(이용일/이용일자, 결제원금/원금 등) 포함 여부로 열을 찾는다
  let headerIdx = -1, dateCol = -1, nameCol = -1;
  const amtCols = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map(cellText);
    const di = row.findIndex(v => v.includes('이용일'));
    const ni = row.findIndex(v => v.includes('가맹점'));
    if (di === -1 || ni === -1) continue;
    headerIdx = i; dateCol = di; nameCol = ni;
    for (const key of ['결제원금', '원금', '결제금액', '이용금액', '금액']) {
      row.forEach((v, ci) => { if (v.includes(key) && ci !== dateCol && ci !== nameCol && !amtCols.includes(ci)) amtCols.push(ci); });
    }
    // 열이 밀려 나오는 파일 대비: 가맹점 오른쪽 칸들도 후보로
    for (const off of [4, 5, 6, 7, 1, 2, 3]) {
      const ci = nameCol + off;
      if (ci < row.length && !amtCols.includes(ci)) amtCols.push(ci);
    }
    break;
  }
  if (headerIdx === -1) throw new Error('명세서 형식을 알아보지 못했어요 (이용일/가맹점 열을 못 찾음)');

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const raw = cellText(row[nameCol]);
    if (!raw || raw.includes('소계') || raw.includes('합계')) continue;
    // 가맹점 칸 끝에 금액이 붙어 나오는 경우만 떼어냄 (쉼표 있는 금액 또는 4자리 이상). "이마트24"는 그대로.
    const m = raw.match(/^(.*?)\s*(-?\d{1,3}(?:,\d{3})+|-?\d{4,})$/);
    const name = (m ? m[1] : raw).trim();
    if (!name) continue;
    let amount = 0;
    for (const ci of amtCols) {
      const v = toNum(row[ci]);
      if (v > 0) { amount = Math.round(v); break; }
    }
    if (amount <= 0) continue; // 취소·환불
    const date = parseDateFlexible(row[dateCol], year);
    if (!date) continue;
    out.push({ date, name, amount });
  }
  return out;
}

export async function extractPdfLines(buf, pdfjsLib) {
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const byY = {};
    for (const it of content.items) {
      const y = Math.round(it.transform[5]);
      (byY[y] ||= []).push({ x: it.transform[4], str: it.str });
    }
    for (const y of Object.keys(byY).map(Number).sort((a, b) => b - a)) {
      const line = byY[y].sort((a, b) => a.x - b.x).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (line) lines.push(line);
    }
  }
  return lines;
}

// 하나카드 PDF: "MM/DD 가맹점 금액 금액 [할인 -금액]" 줄 형식
const HEADER_WORDS = new Set(['이용', '기간', '일자', '회차', '원금', '수수료', '혜택', '금액', '포인트', '할부', '이번', '달', '결제하실']);
const DATE_LINE = /^(\d{2})\/(\d{2})\s*(.*)$/;
const isNumTok = t => /^-?[\d,]+$/.test(t);
const isHeaderOnly = l => {
  const toks = l.split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.every(t => HEADER_WORDS.has(t));
};
const isSkipLine = l =>
  l.includes('상세정보') || l.includes('소계') || l.includes('합계') ||
  l.includes('이용가맹점') || l.includes('결제후잔액') || l.includes('이용기간') ||
  l.includes('본인신용카드') || l.startsWith('*') || l.startsWith('-') ||
  l.includes('COPYRIGHT') || l.includes('고객센터') || l.includes('file:') ||
  l.includes('카드') || /^\d+\.\s/.test(l) || l.includes('오 후') || l.includes('오후') ||
  l.includes('~') || l.length > 30 || isHeaderOnly(l);

export function parsePdfLines(lines, defaultYear) {
  const out = [];
  let preBuffer = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(DATE_LINE);
    if (!m) {
      if (!isSkipLine(line) && !/^\d/.test(line)) preBuffer = line; // 가맹점명이 윗줄로 넘어간 경우
      continue;
    }
    const [, mm, dd, rest] = m;
    const tokens = rest.split(/\s+/).filter(Boolean);
    const nameTokens = [];
    let j = 0;
    while (j < tokens.length && !isNumTok(tokens[j])) nameTokens.push(tokens[j++]);
    const nums = [];
    let hasDiscount = false;
    for (const t of tokens.slice(j)) {
      if (t === '할인') { hasDiscount = true; continue; }
      if (isNumTok(t)) nums.push(Number(t.replace(/,/g, '')));
    }
    const positives = nums.filter(n => n > 0);
    let amount = 0;
    if (positives.length >= 2) amount = positives[1];
    else if (positives.length === 1 && !hasDiscount) amount = positives[0];

    let name = (preBuffer + nameTokens.join('')).trim();
    preBuffer = '';
    const next = lines[i + 1];
    if (next && !DATE_LINE.test(next) && !isSkipLine(next) && next.length <= 12 && !/\d/.test(next)) {
      name += next.trim(); // 가맹점명이 아랫줄로 이어진 경우
      i++;
    }
    const date = parseDateFlexible(`${mm}/${dd}`, defaultYear);
    if (!name || amount <= 0 || !date) continue;
    out.push({ date, name, amount });
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/parsers.js tests/parsers.test.mjs
git commit -m "feat: 엑셀·PDF 명세서 파서

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: API 클라이언트 + 로컬 저장

**Files:**
- Create: `js/api.js`
- Test: `tests/api.test.mjs`

**Interfaces:**
- Produces:
  - `loadConfig(storage?) → {url, token}|null`, `saveConfig(cfg, storage?) → boolean`
  - `validateConfig({url, token}) → string|null` (오류 메시지 또는 null)
  - `loadCache(storage?) → {settings, rows, savedAt}|null`, `saveCache(data, storage?) → boolean`
  - `listTransactions(cfg, fetchImpl?) → Promise<{settings:{startBalance,startDate}, rows:Row[], skipped:number}>`
  - `addTransactions(cfg, rows:{date,kind,name,cat,amount}[], fetchImpl?) → Promise<string[]>` (ids)
  - `deleteTransaction(cfg, id, fetchImpl?) → Promise<void>`
  - 모든 실패는 한국어 `message`를 가진 `Error`로 throw

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/api.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, saveConfig, validateConfig, loadCache, saveCache, listTransactions, addTransactions, deleteTransaction } from '../js/api.js';

const memStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const brokenStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
const cfg = { url: 'https://script.google.com/macros/s/ABC/exec', token: 'secret' };
const jsonRes = obj => ({ json: async () => obj });

test('config and cache round-trip; broken storage is tolerated', () => {
  const s = memStorage();
  assert.equal(loadConfig(s), null);
  assert.equal(saveConfig({ url: ' ' + cfg.url + ' ', token: 'secret ' }, s), true);
  assert.deepEqual(loadConfig(s), cfg);
  saveCache({ settings: { startBalance: 1 }, rows: [], savedAt: 5 }, s);
  assert.equal(loadCache(s).savedAt, 5);
  assert.equal(loadConfig(brokenStorage), null);
  assert.equal(saveConfig(cfg, brokenStorage), false);
});

test('validateConfig', () => {
  assert.equal(validateConfig(cfg), null);
  assert.match(validateConfig({ url: 'https://example.com', token: 'x' }), /주소/);
  assert.match(validateConfig({ url: cfg.url, token: '' }), /토큰/);
});

test('listTransactions sends GET with action and token', async () => {
  let called;
  const fetchImpl = async (url, opts) => { called = { url, opts }; return jsonRes({ status: 'ok', settings: { startBalance: 10, startDate: '2026-01-01' }, rows: [], skipped: 2 }); };
  const res = await listTransactions(cfg, fetchImpl);
  const u = new URL(called.url);
  assert.equal(u.searchParams.get('action'), 'list');
  assert.equal(u.searchParams.get('token'), 'secret');
  assert.equal(res.skipped, 2);
  assert.equal(res.settings.startBalance, 10);
});

test('addTransactions / deleteTransaction POST text/plain JSON', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(opts); return jsonRes({ status: 'ok', ids: ['t_1'] }); };
  const ids = await addTransactions(cfg, [{ date: '2026-09-01', kind: 'expense', name: 'a', cat: 'b', amount: 1 }], fetchImpl);
  assert.deepEqual(ids, ['t_1']);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].headers['Content-Type'], /^text\/plain/);
  assert.equal(JSON.parse(calls[0].body).action, 'add');
  await deleteTransaction(cfg, 't_1', fetchImpl);
  assert.deepEqual(JSON.parse(calls[1].body), { action: 'delete', token: 'secret', id: 't_1' });
});

test('errors become readable Korean messages', async () => {
  await assert.rejects(listTransactions(cfg, async () => jsonRes({ status: 'error', message: '토큰이 올바르지 않아요' })), /토큰이 올바르지 않아요/);
  await assert.rejects(listTransactions(cfg, async () => ({ json: async () => { throw new SyntaxError('Unexpected token <'); } })), /배포 설정/);
  await assert.rejects(listTransactions(cfg, async () => { throw new TypeError('Failed to fetch'); }), /네트워크/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module ... js/api.js`

- [ ] **Step 3: 구현** — `js/api.js`

```js
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
    throw new Error(e.name === 'AbortError' ? '시트 응답이 너무 늦어요 (30초 초과)' : '네트워크 연결을 확인해 주세요');
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
export async function addTransactions(cfg, rows, fetchImpl = defaultFetch) {
  const d = await call(cfg, { method: 'POST', body: { action: 'add', token: cfg.token, rows } }, fetchImpl);
  return d.ids;
}
export async function deleteTransaction(cfg, id, fetchImpl = defaultFetch) {
  await call(cfg, { method: 'POST', body: { action: 'delete', token: cfg.token, id } }, fetchImpl);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/api.js tests/api.test.mjs
git commit -m "feat: Apps Script API 클라이언트와 로컬 설정·캐시

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Apps Script (`Code.gs`)

**Files:**
- Create: `apps-script/Code.gs`
- Test: `tests/code-gs.test.mjs` (Node `vm`으로 순수 함수만 검증)

**Interfaces:**
- Produces (HTTP, spec §2):
  - `GET ?action=list&token=` → `{status:'ok', settings:{startBalance, startDate}, rows:Row[], skipped}`
  - `POST {action:'add', token, rows}` → `{status:'ok', ids}` — 한 줄이라도 검증 실패 시 아무것도 쓰지 않음
  - `POST {action:'delete', token, id}` → `{status:'ok'}`
- Produces (Seed.gs가 사용하는 함수): `txSheet_()`, `writeSettings_({startBalance, startDate})`, `validateRow_(row, index)`, `appendRows_(cleanRows) → ids`
- 테스트 가능한 순수 함수: `validateRow_`, `escapeCell_`, `isRealDate_`, `normalizeSheetRow_(values:any[], tz) → Row|null`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/code-gs.test.mjs`

```js
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
  assert.equal(gs.escapeCell_('이마트'), '이마트');
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `ENOENT ... apps-script/Code.gs`

- [ ] **Step 3: 구현** — `apps-script/Code.gs`

```js
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
    if (req.action === 'add') return json_(withLock_(function () { return add_(req.rows); }));
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
  const tz = Session.getScriptTimeZone();
  const out = { startBalance: 0, startDate: '' };
  settingsSheet_().getDataRange().getValues().forEach(function (r) {
    const key = String(r[0]).trim();
    if (key === '시작잔액') out.startBalance = toNumber_(r[1]) || 0;
    if (key === '시작일') out.startDate = r[1] instanceof Date ? Utilities.formatDate(r[1], tz, 'yyyy-MM-dd') : String(r[1]).trim();
  });
  return out;
}

// ---------- 순수 함수 (tests/code-gs.test.mjs) ----------

function toNumber_(v) {
  return Number(String(v).replace(/[,\s원₩]/g, ''));
}

function isRealDate_(s) {
  const p = s.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function escapeCell_(s) {
  // =, +, -, @로 시작하면 시트가 수식으로 해석하므로 앞에 '를 붙여 글자로 저장
  return /^[=+\-@]/.test(s) ? "'" + s : s;
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

// ---------- 동작 ----------

function newId_() {
  return 't_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function list_() {
  const sh = txSheet_();
  const last = sh.getLastRow();
  const tz = Session.getScriptTimeZone();
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
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const ids = [];
  const values = clean.map(function (r) {
    const id = newId_();
    ids.push(id);
    return [id, r.date, KIND_TO_KO[r.kind], escapeCell_(r.name), escapeCell_(r.cat), r.amount, r.summary ? 'Y' : '', stamp];
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, HEADERS.length).setValues(values);
  return ids;
}

function add_(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('추가할 거래가 없어요');
  if (rows.length > MAX_ROWS_PER_ADD) throw new Error('한 번에 ' + MAX_ROWS_PER_ADD + '건까지만 추가할 수 있어요');
  const clean = rows.map(validateRow_); // 하나라도 틀리면 여기서 중단 → 아무것도 쓰지 않음
  return { status: 'ok', ids: appendRows_(clean) };
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
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps-script/Code.gs tests/code-gs.test.mjs
git commit -m "feat: 구글 시트 Apps Script API (list/add/delete)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 초기 데이터 생성 (`Seed.gs`)

**Files:**
- Create: `tools/seed-lib.mjs`, `tools/build-seed.mjs`
- Generate (git 제외): `apps-script/Seed.gs`
- Test: `tests/seed.test.mjs` (원본 파일이 없으면 skip)

**Interfaces:**
- Consumes: `toISODate`, `lastDayOfMonth` (Task 1); Code.gs의 `txSheet_`, `writeSettings_`, `validateRow_`, `appendRows_` (Task 6)
- Produces: `extractData(html) → {totals, incomeCats, expenseCats, ledgerByMonth}`, `buildSeed(data, year=2026) → {settings, rows}`, `renderSeedGs(seed) → string`

**데이터 규칙 (spec §3 + 확인된 사실):**
- 원본 1월 상세 내역은 94줄: "전년도 이월금" 1줄(시작잔액으로 사용, 행 제외) + 거래 93줄.
- 1월 상세 내역에서 문자열 음수(`"-N"`) 형태 = 이체.
- 원본의 1월 분류별 합계(`expenseCats[*][0]`)가 상세 내역보다 14개 분류에서 큼 (상세 내역 일부가 원본 HTML에 빠져 있음). 차이만큼 `1월 <분류> 미상세분` 요약 줄(2026-01-31, 요약=Y)을 추가 → 1월 지출 = 분류마다 max(분류 합계, 상세 합계)의 합.
- 2~8월: 분류별 값 > 0 마다 요약 줄 + 저축 합계 이체 줄. 월별 줄 수: 25, 27, 30, 28, 28, 29, 25.
- 총 299줄 (93 + 14 + 192).

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/seed.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { extractData, buildSeed, renderSeedGs } from '../tools/seed-lib.mjs';

// 기대값은 원본 파일에서 직접 계산한다 (공개 저장소에 실제 금액을 남기지 않기 위해).
const src = new URL('../reference/original.html', import.meta.url);
const skip = !existsSync(src) && 'reference/original.html 없음 (git 제외 파일)';

const sum = (rows, pred) => rows.filter(pred).reduce((a, r) => a + r.amount, 0);
const inMonth = m => r => r.date.startsWith(`2026-${String(m).padStart(2, '0')}`);

function expectedFromOriginal(data) {
  const ledger = data.ledgerByMonth[1];
  const carry = ledger.find(r => r[3] === '' && r[4] === '');
  const detail = ledger.filter(r => r !== carry);
  const janTransfer = detail.filter(r => typeof r[4] === 'string').reduce((a, r) => a + Math.abs(Number(r[4])), 0);
  const ledgerExpenseByCat = {};
  for (const r of detail) if (typeof r[4] === 'number') ledgerExpenseByCat[r[2]] = (ledgerExpenseByCat[r[2]] || 0) + r[4];
  // 1월 지출 = 분류마다 (원본 분류 합계, 상세 내역 합계) 중 큰 값의 합
  const cats = new Set([...Object.keys(ledgerExpenseByCat), ...Object.keys(data.expenseCats)]);
  let janExpense = 0, janTopUps = 0;
  for (const c of cats) {
    const catTotal = (data.expenseCats[c] || [0])[0];
    const detailTotal = ledgerExpenseByCat[c] || 0;
    janExpense += Math.max(catTotal, detailTotal);
    if (catTotal > detailTotal) janTopUps++;
  }
  let laterRows = 0;
  for (let i = 1; i < data.totals.income.length; i++) {
    laterRows += Object.values(data.incomeCats).filter(v => v[i] > 0).length;
    laterRows += Object.values(data.expenseCats).filter(v => v[i] > 0).length;
    if (data.totals.saving[i] > 0) laterRows++;
  }
  return { startBalance: carry[5], detailCount: detail.length, janTransfer, janExpense, janTopUps, rowCount: detail.length + janTopUps + laterRows };
}

test('seed rows reproduce original totals', { skip }, () => {
  const data = extractData(readFileSync(src, 'utf8'));
  const exp = expectedFromOriginal(data);
  const { settings, rows } = buildSeed(data);
  assert.equal(settings.startBalance, exp.startBalance);
  assert.equal(settings.startDate, '2026-01-01');
  assert.equal(rows.length, exp.rowCount);
  assert.equal(sum(rows, r => inMonth(1)(r) && r.kind === 'income'), data.totals.income[0]);
  assert.equal(sum(rows, r => inMonth(1)(r) && r.kind === 'expense'), exp.janExpense);
  assert.equal(sum(rows, r => inMonth(1)(r) && r.kind === 'transfer'), exp.janTransfer);
  assert.equal(rows.filter(r => inMonth(1)(r) && r.summary).length, exp.janTopUps);
  for (let m = 2; m <= data.totals.income.length; m++) {
    assert.equal(sum(rows, r => inMonth(m)(r) && r.kind === 'income'), data.totals.income[m - 1], `${m}월 수입`);
    assert.equal(sum(rows, r => inMonth(m)(r) && r.kind === 'expense'), data.totals.expense[m - 1], `${m}월 지출`);
    assert.equal(sum(rows, r => inMonth(m)(r) && r.kind === 'transfer'), data.totals.saving[m - 1], `${m}월 저축`);
  }
  assert.ok(!rows.some(r => r.name === '전년도 이월금'));
  for (const r of rows) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isInteger(r.amount) && r.amount > 0, `${r.date} ${r.kind} 금액 오류`);
    assert.ok(['income', 'expense', 'transfer'].includes(r.kind));
  }
});

test('rendered Seed.gs is valid JavaScript with seed()', { skip }, () => {
  const text = renderSeedGs(buildSeed(extractData(readFileSync(src, 'utf8'))));
  const ctx = vm.createContext({});
  vm.runInContext(text, ctx);
  assert.equal(typeof ctx.seed, 'function');
  assert.match(text, /git에 올리지 마세요/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module ... tools/seed-lib.mjs`

- [ ] **Step 3: 구현** — `tools/seed-lib.mjs`

```js
import { toISODate, lastDayOfMonth } from '../js/dates.js';

export function extractData(html) {
  const start = html.indexOf('/* ================= DATA');
  const end = html.indexOf('/* ================= HELPERS');
  if (start < 0 || end < 0) throw new Error('원본 HTML에서 DATA 섹션을 찾지 못했어요');
  return new Function(html.slice(start, end) + ';return {totals, incomeCats, expenseCats, ledgerByMonth};')();
}

function parseLedgerDate(label, year) {
  const m = label.match(/^(\d{2})월 (\d{2})일/);
  if (!m) throw new Error('알 수 없는 날짜 형식: ' + label);
  return toISODate(year, +m[1], +m[2]);
}

export function buildSeed(data, year = 2026) {
  const rows = [];
  const jan = data.ledgerByMonth[1];
  const carry = jan.find(r => r[3] === '' && r[4] === '');
  const janExpenseByCat = {};

  for (const [label, name, cat, inAmt, outAmt] of jan) {
    if (inAmt === '' && outAmt === '') continue; // 전년도 이월금 → 시작잔액
    const date = parseLedgerDate(label, year);
    if (inAmt !== '') {
      rows.push({ date, kind: 'income', name, cat, amount: Number(inAmt), summary: false });
    } else if (typeof outAmt === 'string') { // 원본에서 "-90000"처럼 문자열 음수 = 이체/저축
      rows.push({ date, kind: 'transfer', name, cat, amount: Math.abs(Number(outAmt)), summary: false });
    } else {
      rows.push({ date, kind: 'expense', name, cat, amount: outAmt, summary: false });
      janExpenseByCat[cat] = (janExpenseByCat[cat] || 0) + outAmt;
    }
  }

  // 원본 1월 분류 합계가 상세 내역보다 큰 만큼을 요약 줄로 보충
  const janEnd = toISODate(year, 1, lastDayOfMonth(year, 1));
  for (const [cat, vals] of Object.entries(data.expenseCats)) {
    const diff = vals[0] - (janExpenseByCat[cat] || 0);
    if (diff > 0) rows.push({ date: janEnd, kind: 'expense', name: `1월 ${cat} 미상세분`, cat, amount: diff, summary: true });
  }

  for (let m = 2; m <= data.totals.income.length; m++) {
    const i = m - 1;
    const date = toISODate(year, m, lastDayOfMonth(year, m));
    for (const [cat, vals] of Object.entries(data.incomeCats)) {
      if (vals[i] > 0) rows.push({ date, kind: 'income', name: `${m}월 ${cat} 합계`, cat, amount: vals[i], summary: true });
    }
    for (const [cat, vals] of Object.entries(data.expenseCats)) {
      if (vals[i] > 0) rows.push({ date, kind: 'expense', name: `${m}월 ${cat} 합계`, cat, amount: vals[i], summary: true });
    }
    if (data.totals.saving[i] > 0) {
      rows.push({ date, kind: 'transfer', name: `${m}월 저축 합계`, cat: '저축', amount: data.totals.saving[i], summary: true });
    }
  }

  return { settings: { startBalance: carry ? carry[5] : 0, startDate: `${year}-01-01` }, rows };
}

export function renderSeedGs(seed) {
  const rowLines = seed.rows.map(r => '  ' + JSON.stringify(r)).join(',\n');
  return `// 자동 생성 파일 (tools/build-seed.mjs). 실제 가계 데이터가 들어 있으니 git에 올리지 마세요.
// 사용법: Apps Script 편집기에 붙여 넣고, 함수 목록에서 seed 선택 → 실행 (한 번만).

const SEED_SETTINGS = ${JSON.stringify(seed.settings)};

const SEED_ROWS = [
${rowLines}
];

function seed() {
  const sh = txSheet_();
  if (sh.getLastRow() > 1) {
    throw new Error('거래 탭에 이미 데이터가 있어서 초기 데이터를 넣지 않았어요.');
  }
  writeSettings_(SEED_SETTINGS);
  const clean = SEED_ROWS.map(validateRow_);
  appendRows_(clean);
  Logger.log('초기 데이터 ' + clean.length + '건을 넣었어요.');
}
`;
}
```

`tools/build-seed.mjs`:
```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { extractData, buildSeed, renderSeedGs } from './seed-lib.mjs';

const html = readFileSync(new URL('../reference/original.html', import.meta.url), 'utf8');
const seed = buildSeed(extractData(html));
mkdirSync(new URL('../apps-script/', import.meta.url), { recursive: true });
writeFileSync(new URL('../apps-script/Seed.gs', import.meta.url), renderSeedGs(seed));
console.log(`apps-script/Seed.gs 생성: ${seed.rows.length}건, 시작잔액 ${seed.settings.startBalance}`);
```

- [ ] **Step 4: 통과 확인 + 생성**

Run: `npm test`
Expected: PASS (seed 테스트 2개 포함, skip 아님)

Run: `npm run seed`
Expected: `apps-script/Seed.gs 생성: 299건, 시작잔액 <원본 이월금>`

Run: `git status --short`
Expected: `apps-script/Seed.gs`가 목록에 **없음** (gitignore 확인)

- [ ] **Step 5: Commit**

```bash
git add tools/seed-lib.mjs tools/build-seed.mjs tests/seed.test.mjs
git commit -m "feat: 원본 데이터를 시트 초기 데이터(Seed.gs)로 변환

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: PWA 껍데기 (아이콘, 매니페스트, 서비스 워커, 로컬 서버)

**Files:**
- Create: `tools/make-icons.ps1`, `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png`, `manifest.webmanifest`, `sw.js`, `.nojekyll`, `tools/serve.mjs`

**Interfaces:**
- Produces: `sw.js`가 캐시하는 앱 파일 목록(Task 9의 파일명과 일치해야 함): `./`, `./index.html`, `./manifest.webmanifest`, `./js/app.js`, `./js/api.js`, `./js/model.js`, `./js/categorize.js`, `./js/parsers.js`, `./js/dates.js`, 아이콘 3개.
- `npm run serve` → `http://localhost:8080` (reference/apps-script/tools/tests/docs/.git 경로는 404)

- [ ] **Step 1: 아이콘 생성 스크립트** — `tools/make-icons.ps1`

```powershell
# 네이비 배경 + 황동색 원형 도장 + '통' 글자 아이콘 생성 (Windows PowerShell 5.1)
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'icons'
New-Item -ItemType Directory -Force $out | Out-Null
$glyph = [string][char]0xD1B5  # '통' (파일 인코딩 문제를 피하려고 코드포인트로)

function Make-Icon([int]$size, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#152A3B'))
  $brass = [System.Drawing.ColorTranslator]::FromHtml('#D8B47B')
  $pen = New-Object System.Drawing.Pen $brass, ([float]($size * 0.035))
  $m = [float]($size * 0.2)
  $g.DrawEllipse($pen, $m, $m, [float]($size - 2 * $m), [float]($size - 2 * $m))
  $font = New-Object System.Drawing.Font 'Malgun Gothic', ([float]($size * 0.3)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $brush = New-Object System.Drawing.SolidBrush $brass
  $g.DrawString($glyph, $font, $brush, (New-Object System.Drawing.RectangleF 0, 0, $size, $size), $sf)
  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Make-Icon 192 'icon-192.png'
Make-Icon 512 'icon-512.png'
Make-Icon 180 'apple-touch-icon.png'
Write-Output "icons 생성 완료: $out"
```

Run (PowerShell): `powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1`
Expected: `icons/`에 PNG 3개. Read 도구로 `icons/icon-512.png`를 열어 네이비 배경·황동 원·'통' 글자가 보이는지 확인.

- [ ] **Step 2: 매니페스트** — `manifest.webmanifest`

```json
{
  "name": "창호미니 통장",
  "short_name": "통장",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#F6F1E4",
  "theme_color": "#152A3B",
  "lang": "ko",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }
  ]
}
```

`.nojekyll`: 빈 파일 (GitHub Pages가 Jekyll 처리를 하지 않도록).

- [ ] **Step 3: 서비스 워커** — `sw.js`

```js
// 앱 파일: 네트워크 우선(온라인이면 항상 최신) → 실패 시 캐시.  CDN/폰트: 캐시 우선.  Apps Script API: 가로채지 않음.
const CACHE = 'passbook-v1';
const APP_SHELL = [
  './', './index.html', './manifest.webmanifest',
  './js/app.js', './js/api.js', './js/model.js', './js/categorize.js', './js/parsers.js', './js/dates.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP_SHELL);
    await Promise.all(CDN.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'script.google.com' || url.hostname.endsWith('googleusercontent.com')) return;

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(async () => (await caches.match(req, { ignoreSearch: true })) ||
          (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});
```

- [ ] **Step 4: 로컬 서버** — `tools/serve.mjs`

```js
// 로컬 확인용 정적 서버. 공개하면 안 되는 폴더는 404.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};
const HIDDEN = new Set(['reference', 'apps-script', 'tools', 'tests', 'docs', '.git', 'node_modules']);
const port = Number(process.env.PORT) || 8080;

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  const first = file.slice(root.length).split(sep).filter(Boolean)[0];
  if (!file.startsWith(root) || HIDDEN.has(first)) { res.writeHead(404).end('not found'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
```

- [ ] **Step 5: 확인**

Run (백그라운드): `npm run serve`
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/manifest.webmanifest` → `200`
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/reference/original.html` → `404`
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/icons/icon-192.png` → `200`
서버 종료.

- [ ] **Step 6: Commit**

```bash
git add tools/make-icons.ps1 icons manifest.webmanifest sw.js .nojekyll tools/serve.mjs
git commit -m "feat: PWA 매니페스트·아이콘·서비스 워커, 로컬 서버

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 화면 (`index.html` + `js/app.js`)

**Files:**
- Create: `index.html`, `js/app.js`

**Interfaces:**
- Consumes: Task 1–5의 모든 export (이름 그대로), `window.Chart`, `window.XLSX`, `window.pdfjsLib`
- DOM id 계약 (index.html ↔ app.js): `yearTag, periodLabel, balanceNum, footIn, footOut, footSave, monthBar, syncBtn, syncTime, banner, flowNote, flowChart, catNote, donutChart, rateChart, ledgerCard, catList, inStatementFile, previewCard, previewCount, previewList, bulkSubmitBtn, addMonthNote, inDate, inName, inCat, catOptions, inAmt, submitBtn, settingsCard, syncStatus, inWebhookUrl, inWebhookToken, saveConfigBtn, toast`

- [ ] **Step 1: `index.html` 작성**

`<style>` 안에는 **`reference/original.html` 10–260번째 줄을 그대로 복사**한 뒤, 그 아래에 아래 "추가 CSS"를 붙인다. (원본 CSS 중 `.recent-added`, `.clear-link` 규칙은 남아 있어도 무해하므로 그대로 둔다.)

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>창호미니 통장</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="창호미니 통장">
<meta name="theme-color" content="#152A3B">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;700;900&family=Noto+Sans+KR:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<style>
  /* ↓↓ reference/original.html 10–260번째 줄 그대로 ↓↓ */

  /* ===== 추가 CSS ===== */
  body{padding-top:env(safe-area-inset-top);}
  .led-dot.tr{background:var(--brass);}
  .led-amt.tr{color:var(--brass);}
  .sum-badge{
    display:inline-block;margin-left:6px;padding:1px 6px;border-radius:6px;vertical-align:1px;
    font-size:10px;font-weight:700;color:var(--brass);border:1px solid var(--brass-soft);
  }
  .led-del{
    flex-shrink:0;width:26px;height:26px;border-radius:50%;border:1px solid var(--line);
    background:transparent;color:var(--ink-faint);font-size:15px;line-height:1;cursor:pointer;
  }
  .led-del:active{background:var(--paper-dim);}
  .banner{
    margin:10px 0 0;padding:9px 12px;border-radius:10px;font-size:11.5px;line-height:1.5;
    background:rgba(198,84,58,0.10);color:var(--expense);border:1px solid rgba(198,84,58,0.3);
  }
  .banner[hidden]{display:none;}
  .preview-dup{font-size:10px;color:var(--expense);margin-left:6px;font-weight:700;}
  .toast{white-space:normal;max-width:calc(100% - 32px);text-align:center;}
</style>
</head>
<body>
<div class="app">

  <div class="cover">
    <div class="cover-eyebrow"><span>창호미니 부자되기 프로젝트</span><span id="yearTag"></span></div>
    <div class="cover-title">창호미니 가족 통장</div>
    <div class="cover-sub" id="periodLabel"></div>
    <div class="balance-row">
      <div>
        <div class="balance-label">잔액</div>
        <div class="balance-amount"><span class="won">₩</span><span id="balanceNum">0</span></div>
      </div>
      <div class="stamp"><span>SAVED</span><span>認</span></div>
    </div>
    <div class="cover-foot">
      <div class="in">수입 <b id="footIn">0</b></div>
      <div class="out">지출 <b id="footOut">0</b></div>
      <div>저축 <b id="footSave" style="color:var(--brass-soft)">0</b></div>
    </div>
  </div>

  <div class="months" id="monthBar"></div>
  <div style="text-align:right;margin:6px 2px 0;">
    <span id="syncBtn" style="font-size:11.5px;color:var(--brass);cursor:pointer;font-family:'IBM Plex Mono',monospace;">⟳ 시트와 동기화</span>
    <span id="syncTime" style="font-size:10.5px;color:var(--ink-faint);margin-left:8px;"></span>
  </div>
  <div class="banner" id="banner" hidden></div>

  <div class="tabs">
    <div class="tab active" data-panel="dash">대시보드</div>
    <div class="tab" data-panel="ledger">거래내역</div>
    <div class="tab" data-panel="cat">카테고리</div>
    <div class="tab" data-panel="add">입력</div>
  </div>

  <div class="panel active" id="panel-dash">
    <div class="card">
      <div class="card-title">월별 수입·지출<span class="note" id="flowNote"></span></div>
      <canvas id="flowChart" height="190"></canvas>
    </div>
    <div class="card">
      <div class="card-title">지출 구성<span class="note" id="catNote">선택한 달</span></div>
      <canvas id="donutChart" height="220"></canvas>
    </div>
    <div class="card">
      <div class="card-title">저축률<span class="note">수입 대비</span></div>
      <canvas id="rateChart" height="150"></canvas>
    </div>
  </div>

  <div class="panel" id="panel-ledger">
    <div class="card" id="ledgerCard" style="padding-top:14px;"></div>
  </div>

  <div class="panel" id="panel-cat">
    <div class="card">
      <div class="toggle-row">
        <div class="toggle-btn active out" data-kind="expense">지출 항목</div>
        <div class="toggle-btn in" data-kind="income">수입 항목</div>
      </div>
      <div id="catList"></div>
    </div>
  </div>

  <div class="panel" id="panel-add">
    <div class="card">
      <div class="card-title">명세서 업로드<span class="note">엑셀 · PDF</span></div>
      <input type="file" id="inStatementFile" accept=".xls,.xlsx,.csv,.pdf" style="width:100%;font-size:12.5px;color:var(--navy);">
      <div style="font-size:11px;color:var(--ink-faint);margin-top:8px;line-height:1.6;">
        ① <b>날짜 / 항목 / 금액</b> 세 열짜리 표 — 항목을 그대로 분류로 써요.<br>
        ② 현대카드 등 <b>카드 명세서 엑셀</b> — 가맹점 이름을 보고 분류를 추측해요.<br>
        ③ <b>하나카드 PDF 명세서</b>도 인식해요.<br>
        이미 기록된 거래는 "이미 있음"으로 표시하고 체크를 풀어 둬요.
      </div>
    </div>

    <div class="card" id="previewCard" style="display:none;">
      <div class="card-title">불러온 거래 미리보기<span class="note" id="previewCount"></span></div>
      <div id="previewList"></div>
      <button class="submit-btn" id="bulkSubmitBtn" style="margin-top:12px;">선택한 거래 일괄 등록</button>
    </div>

    <div class="card">
      <div class="card-title">새 거래 입력<span class="note" id="addMonthNote"></span></div>
      <div class="kind-row">
        <div class="kind-btn active" data-kind="expense">지출</div>
        <div class="kind-btn" data-kind="income">수입</div>
        <div class="kind-btn" data-kind="transfer">이체/저축</div>
      </div>
      <div class="field"><label>날짜</label><input type="date" id="inDate"></div>
      <div class="field"><label>내역</label><input type="text" id="inName" placeholder="예: 이마트 사상점" maxlength="100"></div>
      <div class="field">
        <label>분류</label>
        <input type="text" id="inCat" list="catOptions" placeholder="목록에서 고르거나 새로 입력" maxlength="30">
        <datalist id="catOptions"></datalist>
      </div>
      <div class="field">
        <label>금액</label>
        <div class="amt-input-wrap"><span>₩</span><input type="number" id="inAmt" placeholder="0" min="1" step="1" inputmode="numeric"></div>
      </div>
      <button class="submit-btn" id="submitBtn">통장에 기록하기</button>
    </div>

    <div class="card" id="settingsCard">
      <div class="card-title">시트 연결<span class="note" id="syncStatus">연결 안 됨</span></div>
      <div class="field">
        <label>Apps Script 웹 앱 주소</label>
        <input type="url" id="inWebhookUrl" placeholder="https://script.google.com/macros/s/.../exec" autocomplete="off">
      </div>
      <div class="field">
        <label>보안 토큰</label>
        <input type="password" id="inWebhookToken" placeholder="Apps Script 스크립트 속성 TOKEN 값" autocomplete="off">
      </div>
      <button class="submit-btn" id="saveConfigBtn" style="background:var(--brass);">저장하고 불러오기</button>
      <div style="font-size:11px;color:var(--ink-faint);margin-top:10px;line-height:1.6;">
        이 폰(브라우저)에만 저장돼요. 설정 방법은 docs/SETUP.md를 참고하세요.
      </div>
    </div>
  </div>

  <div class="foot-note">창호미니 가계부 · 구글 시트 연동</div>
</div>
<div class="toast" id="toast"></div>
<script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 1b: CDN 스크립트에 SRI(무결성 해시) 추가**

Run (Git Bash):
```bash
for u in \
  https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js \
  https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js \
  https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js; do
  echo "$u sha384-$(curl -sf "$u" | openssl dgst -sha384 -binary | openssl base64 -A)"
done
```
Expected: 주소 3개와 각각의 `sha384-...` 값. (curl 실패로 빈 해시 `sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb`가 나오면 중단하고 네트워크 확인.)

`index.html`의 세 `<script src=...>` 태그에 각각 `integrity="sha384-<해당 값>" crossorigin="anonymous"`를 추가한다. (Google Fonts CSS는 브라우저마다 내용이 달라 SRI를 걸 수 없으므로 제외. `sw.js`가 CDN을 `mode:'cors'`로 캐시하므로 `crossorigin`과 일치한다.)

- [ ] **Step 2: `js/app.js` 작성**

```js
import { listTransactions, addTransactions, deleteTransaction, loadConfig, saveConfig, validateConfig, loadCache, saveCache } from './api.js';
import { pickYear, monthRange, latestDataMonth, monthlyTotals, categoryTotals, endOfMonth, balanceAt, savingRates, ledgerForMonth, isDuplicate } from './model.js';
import { buildMerchantMap, guessCategory, CATEGORY_KEYWORDS, DEFAULT_CATEGORY } from './categorize.js';
import { parseTableRows, parsePdfLines, extractPdfLines } from './parsers.js';
import { formatKoreanDate, localISODate } from './dates.js';

const COLORS = { navy: '#152A3B', income: '#2F8F72', expense: '#C6543A', brass: '#B8894F', faint: '#8A7F68', grid: '#E4DCC7', card: '#FFFDF8' };
const PALETTE = ['#C6543A', '#B8894F', '#D8A24C', '#8FAE8A', '#5C8A9E', '#8B6B9E', '#B57D6C', '#A8A190'];
const BASE_CATS = {
  income: ['월급', '보험환급액', '금융이자', '중고거래수익', '정부지원금', '기타'],
  expense: [...new Set(CATEGORY_KEYWORDS.map(k => k[1]).concat(DEFAULT_CATEGORY))],
  transfer: ['저축', '적금', '주식/투자', '노후준비', 'mmf투자', '기타 이체'],
};
const KIND_LABEL = { income: '수입', expense: '지출', transfer: '이체' };

const today = new Date();
const state = {
  config: loadConfig(),
  settings: { startBalance: 0, startDate: '' },
  rows: [],
  loaded: false,
  year: today.getFullYear(),
  month: today.getMonth() + 1,
  tab: 'dash',
  catKind: 'expense',
  addKind: 'expense',
  pending: [],
  merchantMap: {},
  syncing: false,
  saving: false,
};
const charts = {};

const $ = id => document.getElementById(id);
const won = n => Math.round(n).toLocaleString('ko-KR');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showToast(msg, ms = 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast.h);
  showToast.h = setTimeout(() => t.classList.remove('show'), ms);
}
function showBanner(msg) { $('banner').textContent = msg; $('banner').hidden = false; }
function hideBanner() { $('banner').hidden = true; }

/* ---------- 데이터 ---------- */
function setData({ settings, rows }) {
  state.settings = settings || { startBalance: 0, startDate: '' };
  state.rows = rows || [];
  state.merchantMap = buildMerchantMap(state.rows);
  state.year = pickYear(state.rows, today);
  const range = monthRange(state.rows, state.year, today);
  if (!state.loaded || !range.includes(state.month)) {
    state.month = latestDataMonth(state.rows, state.year) ?? range[range.length - 1];
  }
  state.loaded = true;
}

function persist() {
  state.merchantMap = buildMerchantMap(state.rows);
  saveCache({ settings: state.settings, rows: state.rows, savedAt: Date.now() });
}

async function sync({ quiet = false } = {}) {
  if (!state.config) { if (!quiet) requireConfig(); return; }
  if (state.syncing) return;
  state.syncing = true;
  $('syncBtn').textContent = '⟳ 불러오는 중…';
  try {
    const data = await listTransactions(state.config);
    setData(data);
    saveCache({ settings: data.settings, rows: data.rows, savedAt: Date.now() });
    hideBanner();
    $('syncTime').textContent = '마지막 동기화 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    renderAll();
    if (data.skipped) showToast(`시트에서 형식이 맞지 않는 줄 ${data.skipped}개는 건너뛰었어요`, 4000);
    else if (!quiet) showToast(`시트와 동기화했어요 · 거래 ${data.rows.length}건 ✓`);
  } catch (e) {
    showBanner('시트에 연결하지 못해서 마지막으로 저장된 데이터를 보여주고 있어요 · ' + e.message);
    if (!quiet) showToast('동기화 실패: ' + e.message, 4000);
  } finally {
    state.syncing = false;
    $('syncBtn').textContent = '⟳ 시트와 동기화';
  }
}

function requireConfig() {
  if (state.config) return true;
  switchTab('add');
  $('settingsCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast('먼저 시트 연결 정보를 입력해 주세요');
  return false;
}

/* ---------- 탭·월 ---------- */
function switchTab(name) {
  state.tab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.panel === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  renderAll();
}

function renderMonthBar() {
  const bar = $('monthBar');
  bar.innerHTML = '';
  for (const m of monthRange(state.rows, state.year, today)) {
    const chip = document.createElement('div');
    chip.className = 'month-chip' + (m === state.month ? ' active' : '');
    chip.textContent = m + '월';
    chip.addEventListener('click', () => { state.month = m; renderAll(); });
    bar.appendChild(chip);
  }
  const active = bar.querySelector('.active');
  if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
}

/* ---------- 표지 ---------- */
function renderHero() {
  const t = monthlyTotals(state.rows, state.year);
  const i = state.month - 1;
  $('yearTag').textContent = state.year;
  $('periodLabel').textContent = `${state.year}년 ${state.month}월 말 기준`;
  $('balanceNum').textContent = won(balanceAt(state.rows, state.settings.startBalance, endOfMonth(state.year, state.month)));
  $('footIn').textContent = won(t.income[i]);
  $('footOut').textContent = won(t.expense[i]);
  $('footSave').textContent = won(t.transfer[i]);
  $('addMonthNote').textContent = `${state.month}월 보는 중`;
}

/* ---------- 차트 ---------- */
const axisTicks = size => ({ font: { family: "'IBM Plex Mono'", size }, color: COLORS.faint });

function renderCharts() {
  if (!window.Chart) return; // CDN을 못 불러온 경우 (첫 실행이 오프라인)
  const months = monthRange(state.rows, state.year, today);
  const labels = months.map(m => m + '월');
  const t = monthlyTotals(state.rows, state.year);
  const n = months.length;
  $('flowNote').textContent = `${state.year}. 1–${n}`;

  charts.flow?.destroy();
  charts.flow = new Chart($('flowChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '수입', data: t.income.slice(0, n), backgroundColor: COLORS.income, borderRadius: 4, barPercentage: 0.55 },
        { label: '지출', data: t.expense.slice(0, n), backgroundColor: COLORS.expense, borderRadius: 4, barPercentage: 0.55 },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { font: { family: "'Noto Sans KR'", size: 11 }, boxWidth: 10, color: COLORS.navy } } },
      scales: {
        x: { grid: { display: false }, ticks: axisTicks(10.5) },
        y: { grid: { color: COLORS.grid }, ticks: { ...axisTicks(9.5), callback: v => v / 10000 + '만' } },
      },
    },
  });

  const entries = categoryTotals(state.rows, state.year, state.month, 'expense');
  const top = entries.slice(0, 7);
  const rest = entries.slice(7).reduce((a, [, v]) => a + v, 0);
  if (rest > 0) top.push(['기타 항목', rest]);
  $('catNote').textContent = `${state.month}월 지출`;
  charts.donut?.destroy();
  charts.donut = new Chart($('donutChart'), {
    type: 'doughnut',
    data: { labels: top.map(e => e[0]), datasets: [{ data: top.map(e => e[1]), backgroundColor: PALETTE, borderColor: COLORS.card, borderWidth: 2 }] },
    options: { responsive: true, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { font: { family: "'Noto Sans KR'", size: 10.5 }, boxWidth: 9, color: COLORS.navy, padding: 10 } } } },
  });

  charts.rate?.destroy();
  charts.rate = new Chart($('rateChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{ data: savingRates(t).slice(0, n), borderColor: COLORS.brass, backgroundColor: 'rgba(184,137,79,0.15)', fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: COLORS.brass, spanGaps: false }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false }, ticks: axisTicks(10.5) }, y: { grid: { color: COLORS.grid }, ticks: { ...axisTicks(9.5), callback: v => v + '%' } } },
    },
  });
}

/* ---------- 거래내역 ---------- */
function renderLedger() {
  const card = $('ledgerCard');
  const items = ledgerForMonth(state.rows, state.settings.startBalance, state.year, state.month);
  if (!items.length) {
    card.innerHTML = `<div class="empty"><div class="empty-mark">帳</div>
      <p><b>${state.month}월 거래가 아직 없어요</b></p>
      <p>입력 탭에서 기록하거나 명세서를 올려 보세요.</p></div>`;
    return;
  }
  let html = '';
  let lastDay = null;
  for (const r of items) {
    if (r.date !== lastDay) { html += `<div class="ledger-day">${formatKoreanDate(r.date)}</div>`; lastDay = r.date; }
    const cls = r.kind === 'income' ? 'in' : r.kind === 'expense' ? 'out' : 'tr';
    const sign = r.kind === 'income' ? '+' : r.kind === 'expense' ? '-' : '↔';
    html += `<div class="ledger-row">
      <div class="led-dot ${cls}"></div>
      <div class="led-mid">
        <div class="led-name">${esc(r.name)}${r.summary ? '<span class="sum-badge">월 합계</span>' : ''}</div>
        <div class="led-cat">${esc(r.cat)}</div>
      </div>
      <div style="text-align:right;">
        <div class="led-amt ${cls}">${sign}${won(r.amount)}</div>
        <div class="led-bal">잔액 ${won(r.balance)}</div>
      </div>
      <button class="led-del" data-id="${esc(r.id)}" aria-label="삭제">×</button>
    </div>`;
  }
  card.innerHTML = html;
}

async function onDelete(id) {
  const row = state.rows.find(r => r.id === id);
  if (!row || !requireConfig()) return;
  if (!confirm(`"${row.name}" ${won(row.amount)}원 (${KIND_LABEL[row.kind]})을 삭제할까요?\n구글 시트에서도 지워져요.`)) return;
  try {
    await deleteTransaction(state.config, id);
    state.rows = state.rows.filter(r => r.id !== id);
    persist();
    renderAll();
    showToast('삭제했어요');
  } catch (e) {
    showToast('삭제 실패: ' + e.message, 4000);
  }
}

/* ---------- 카테고리 ---------- */
function renderCatList() {
  const entries = categoryTotals(state.rows, state.year, state.month, state.catKind);
  const list = $('catList');
  if (!entries.length) {
    list.innerHTML = `<div class="empty"><p>${state.month}월 ${state.catKind === 'expense' ? '지출' : '수입'} 기록이 없어요</p></div>`;
    return;
  }
  const max = entries[0][1];
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const fill = state.catKind === 'income' ? 'background:linear-gradient(90deg,#2F8F72,#8FAE8A);' : '';
  list.innerHTML = entries.map(([name, val]) => `<div class="cat-item">
      <div class="cat-top"><span class="nm">${esc(name)}</span><span class="amt">${won(val)}</span></div>
      <div class="cat-bar-bg"><div class="cat-bar-fill" style="width:${(val / max * 100).toFixed(0)}%;${fill}"></div></div>
      <div class="cat-pct">${state.month}월 전체의 ${(val / total * 100).toFixed(1)}%</div>
    </div>`).join('');
}

/* ---------- 입력 ---------- */
function categoryNames(kind) {
  const seen = new Set(state.rows.filter(r => r.kind === kind).map(r => r.cat));
  for (const c of BASE_CATS[kind]) seen.add(c);
  return [...seen];
}

function populateCatOptions() {
  $('catOptions').innerHTML = categoryNames(state.addKind).map(n => `<option value="${esc(n)}">`).join('');
}

async function onSubmit() {
  if (state.saving || !requireConfig()) return;
  const date = $('inDate').value;
  const name = $('inName').value.trim();
  const cat = $('inCat').value.trim();
  const amount = Number($('inAmt').value);
  if (!date || !name || !cat) { showToast('날짜·내역·분류·금액을 모두 입력해 주세요'); return; }
  if (!Number.isInteger(amount) || amount <= 0) { showToast('금액은 1원 이상 정수로 입력해 주세요'); return; }

  const btn = $('submitBtn');
  state.saving = true; btn.disabled = true; btn.textContent = '기록 중…';
  try {
    const row = { date, kind: state.addKind, name, cat, amount };
    const [id] = await addTransactions(state.config, [row]);
    state.rows.push({ ...row, id, summary: false });
    persist();
    if (Number(date.slice(0, 4)) === state.year) state.month = Number(date.slice(5, 7));
    $('inName').value = ''; $('inCat').value = ''; $('inAmt').value = '';
    populateCatOptions();
    renderAll();
    showToast('통장과 시트에 기록했어요 ✓');
  } catch (e) {
    showToast('기록 실패: ' + e.message + ' (입력값은 그대로 있어요)', 4000);
  } finally {
    state.saving = false; btn.disabled = false; btn.textContent = '통장에 기록하기';
  }
}

/* ---------- 업로드 ---------- */
async function onFileChosen(e) {
  const input = e.target;
  const file = input.files[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const year = today.getFullYear();
    let items;
    if (/\.pdf$/i.test(file.name)) {
      if (!window.pdfjsLib) throw new Error('PDF 라이브러리를 불러오지 못했어요 (인터넷 연결 확인)');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      items = parsePdfLines(await extractPdfLines(buf, window.pdfjsLib), year);
    } else {
      if (!window.XLSX) throw new Error('엑셀 라이브러리를 불러오지 못했어요 (인터넷 연결 확인)');
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      items = parseTableRows(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }), year).items;
    }
    if (!items.length) throw new Error('파일에서 거래를 찾지 못했어요');
    state.pending = items.map(it => {
      const dup = isDuplicate(it, state.rows);
      return { ...it, cat: it.cat || guessCategory(it.name, state.merchantMap), include: !dup, dup };
    });
    renderPreview();
  } catch (err) {
    console.error(err);
    showToast(err.message, 4000);
    input.value = '';
  }
}

function renderPreview() {
  $('previewCard').style.display = 'block';
  const dupCount = state.pending.filter(r => r.dup).length;
  $('previewCount').textContent = `${state.pending.length}건` + (dupCount ? ` · 이미 있음 ${dupCount}` : '');
  const cats = categoryNames('expense');
  $('previewList').innerHTML = state.pending.map((r, i) => {
    const options = cats.includes(r.cat) ? cats : [r.cat, ...cats];
    return `<div class="preview-row">
      <input type="checkbox" class="preview-check" data-i="${i}" ${r.include ? 'checked' : ''}>
      <div class="preview-mid">
        <div class="preview-name">${esc(r.name)}</div>
        <div class="preview-date">${formatKoreanDate(r.date)}${r.dup ? '<span class="preview-dup">이미 있음</span>' : ''}</div>
      </div>
      <select class="preview-cat-select" data-i="${i}">
        ${options.map(c => `<option value="${esc(c)}" ${c === r.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
      <div class="preview-amt">${won(r.amount)}</div>
    </div>`;
  }).join('');
}

async function onBulkSubmit() {
  const chosen = state.pending.filter(r => r.include);
  if (!chosen.length) { showToast('등록할 거래를 선택해 주세요'); return; }
  if (state.saving || !requireConfig()) return;
  const btn = $('bulkSubmitBtn');
  state.saving = true; btn.disabled = true; btn.textContent = '등록 중…';
  try {
    const rows = chosen.map(r => ({ date: r.date, kind: 'expense', name: r.name, cat: r.cat, amount: r.amount }));
    const ids = await addTransactions(state.config, rows);
    rows.forEach((r, i) => state.rows.push({ ...r, id: ids[i], summary: false }));
    persist();
    state.pending = [];
    $('previewCard').style.display = 'none';
    $('inStatementFile').value = '';
    renderAll();
    showToast(`${ids.length}건을 통장과 시트에 등록했어요 ✓`);
  } catch (e) {
    showToast('등록 실패: ' + e.message + ' (아무것도 저장되지 않았어요)', 4000);
  } finally {
    state.saving = false; btn.disabled = false; btn.textContent = '선택한 거래 일괄 등록';
  }
}

/* ---------- 설정 ---------- */
function updateSyncStatus() {
  const el = $('syncStatus');
  el.textContent = state.config ? '연결됨 ✓' : '연결 안 됨';
  el.style.color = state.config ? 'var(--income)' : 'var(--ink-faint)';
}

async function onSaveConfig() {
  const cfg = { url: $('inWebhookUrl').value.trim(), token: $('inWebhookToken').value.trim() };
  const err = validateConfig(cfg);
  if (err) { showToast(err, 4000); return; }
  if (!saveConfig(cfg)) showToast('이 브라우저에 저장하지 못했어요 — 이번에만 사용돼요', 4000);
  state.config = cfg;
  updateSyncStatus();
  await sync();
}

/* ---------- 전체 렌더 ---------- */
function renderAll() {
  renderMonthBar();
  renderHero();
  if (state.tab === 'dash') renderCharts();
  if (state.tab === 'ledger') renderLedger();
  if (state.tab === 'cat') renderCatList();
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.panel)));
  document.querySelectorAll('.kind-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.kind-btn').forEach(x => x.classList.toggle('active', x === b));
    state.addKind = b.dataset.kind;
    populateCatOptions();
  }));
  document.querySelectorAll('.toggle-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.toggle-btn').forEach(x => x.classList.toggle('active', x === b));
    state.catKind = b.dataset.kind;
    renderCatList();
  }));
  $('ledgerCard').addEventListener('click', e => {
    const btn = e.target.closest('.led-del');
    if (btn) onDelete(btn.dataset.id);
  });
  $('previewList').addEventListener('change', e => {
    const i = Number(e.target.dataset.i);
    if (e.target.classList.contains('preview-check')) state.pending[i].include = e.target.checked;
    if (e.target.classList.contains('preview-cat-select')) state.pending[i].cat = e.target.value;
  });
  $('syncBtn').addEventListener('click', () => sync());
  $('submitBtn').addEventListener('click', onSubmit);
  $('inStatementFile').addEventListener('change', onFileChosen);
  $('bulkSubmitBtn').addEventListener('click', onBulkSubmit);
  $('saveConfigBtn').addEventListener('click', onSaveConfig);
}

function init() {
  bindEvents();
  $('inDate').value = localISODate(today);
  if (state.config) { $('inWebhookUrl').value = state.config.url; $('inWebhookToken').value = state.config.token; }
  updateSyncStatus();
  const cache = loadCache();
  if (cache && Array.isArray(cache.rows)) {
    setData(cache);
    if (cache.savedAt) {
      $('syncTime').textContent = '저장된 데이터 ' + new Date(cache.savedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  }
  populateCatOptions();
  renderAll();
  if (state.config) sync({ quiet: true });
  else requireConfig();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(err => console.warn('서비스 워커 등록 실패', err));
}

init();
```

- [ ] **Step 3: 단위 테스트 재확인**

Run: `npm test`
Expected: PASS (기존 테스트 전부)

- [ ] **Step 4: 브라우저 확인 (캐시 데이터 주입)**

Run (백그라운드): `npm run serve`

브라우저로 `http://localhost:8080` 열기 (claude-in-chrome 사용 가능하면 사용, 아니면 사용자에게 요청).

1. 첫 화면: 입력 탭으로 이동, "먼저 시트 연결 정보를 입력해 주세요" 토스트, 콘솔 오류 없음.
2. 개발자 도구 콘솔에서 가짜 캐시 주입 후 새로고침:
```js
localStorage.setItem('passbook_cache', JSON.stringify({settings:{startBalance:1000000,startDate:'2026-01-01'},savedAt:Date.now(),rows:[
 {id:'a',date:'2026-08-05',kind:'income',name:'월급',cat:'월급',amount:3000000,summary:false},
 {id:'b',date:'2026-08-10',kind:'expense',name:'<b>이마트</b>',cat:'식비',amount:64620,summary:false},
 {id:'c',date:'2026-08-10',kind:'transfer',name:'적금',cat:'저축',amount:500000,summary:false},
 {id:'d',date:'2026-07-31',kind:'expense',name:'7월 카페 합계',cat:'카페',amount:37385,summary:true}]}));
```
3. 확인 항목:
   - 월 칩 1월~9월, 8월 활성. 표지 잔액 **3,397,995** (= 1,000,000 + 3,000,000 − 37,385 − 64,620 − 500,000).
   - 대시보드 차트 3개 그려짐, 저축률 차트에서 수입 없는 달은 점이 없음(NaN 오류 없음).
   - 거래내역 8월: `<b>이마트</b>`가 태그가 아니라 글자 그대로 보임(HTML 이스케이프), 이체 줄은 황동색 `↔`.
   - 7월 칩 → "7월 카페 합계"에 `월 합계` 뱃지.
   - 카테고리 탭 8월 지출: 식비 1개. 수입 토글: 월급.
   - 입력 탭에서 잘못된 주소(`https://example.com`) 저장 → 주소 형식 오류 토스트.
   - 폭 375px(모바일 에뮬레이션)에서 가로 스크롤 없음.
4. 확인 후 `localStorage.clear()`, 서버 종료.

- [ ] **Step 5: Commit**

```bash
git add index.html js/app.js
git commit -m "feat: PWA 화면 (대시보드·거래내역·카테고리·입력) 시트 연동

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 설치 안내 + GitHub Pages 배포

**Files:**
- Create: `docs/SETUP.md`, `README.md`

**Interfaces:**
- Consumes: `apps-script/Code.gs`, `apps-script/Seed.gs`(로컬), 배포된 사이트
- 사용자 작업 필요: 구글 시트/Apps Script 설정, GitHub 빈 저장소 생성, Pages 활성화

- [ ] **Step 1: `docs/SETUP.md` 작성**

```markdown
# 창호미니 통장 설치 안내

## 1. 구글 시트와 Apps Script (한 번만)

1. [sheets.new](https://sheets.new)로 새 구글 시트를 만들고 이름을 `창호미니 통장`으로 바꿉니다.
2. 메뉴 **확장 프로그램 → Apps Script**를 엽니다.
3. 기본 `Code.gs` 내용을 지우고 이 저장소의 `apps-script/Code.gs` 내용을 붙여 넣습니다.
4. 왼쪽 **파일 +** → 스크립트 → 이름 `Seed` → 컴퓨터의 `apps-script/Seed.gs` 내용을 붙여 넣습니다.
   (이 파일은 저장소에 없습니다. `npm run seed`로 만든 로컬 파일이에요.)
5. 왼쪽 톱니바퀴 **프로젝트 설정 → 스크립트 속성 → 속성 추가**
   - 속성: `TOKEN`
   - 값: 추측하기 어려운 긴 문자열. PowerShell에서 `[guid]::NewGuid().ToString('N')` 실행 결과를 쓰면 됩니다.
6. 편집기 위쪽 함수 목록에서 `seed`를 고르고 **실행**합니다.
   - 처음엔 권한 요청이 나옵니다: 계정 선택 → "Google에서 확인하지 않은 앱" 화면에서 **고급 → (프로젝트 이름)(으)로 이동** → 허용.
   - 실행 로그에 `초기 데이터 299건을 넣었어요.`가 나오면 성공. 시트에 `거래`, `설정` 탭이 생깁니다.
   - `seed`는 한 번만 실행하세요. 이미 데이터가 있으면 아무것도 하지 않습니다. 이후 Seed 파일은 지워도 됩니다.
7. 오른쪽 위 **배포 → 새 배포** → 유형 **웹 앱**
   - 실행 계정: **나**
   - 액세스 권한: **모든 사용자**
   - 배포 → 나오는 **웹 앱 URL**(`https://script.google.com/macros/s/.../exec`)을 복사합니다.
8. 확인: 브라우저 주소창에 `웹앱URL?action=list&token=토큰값`을 넣으면 `{"status":"ok",...}`로 시작하는 글자가 보여야 합니다.

> Code.gs를 나중에 고치면: **배포 → 배포 관리 → 연필(수정) → 버전: 새 버전 → 배포**. URL은 그대로입니다.

## 2. 폰에 설치

1. 앱 주소(`https://<GitHub 아이디>.github.io/<저장소 이름>/`)를 폰에서 엽니다.
   - 아이폰: **Safari**로 열기 → 공유 버튼 → **홈 화면에 추가**
   - 안드로이드: **Chrome**으로 열기 → 메뉴(⋮) → **앱 설치** 또는 **홈 화면에 추가**
2. 홈 화면의 `통장` 아이콘으로 엽니다.
3. **입력** 탭 아래 **시트 연결**에 웹 앱 URL과 토큰을 넣고 **저장하고 불러오기**.
   폰마다(창호, 미니 각각) 한 번씩 하면 됩니다.

## 3. 쓰는 방법 요약

- 거래 입력·명세서 업로드 → 바로 구글 시트 `거래` 탭에 한 줄씩 추가됩니다.
- 잘못 입력한 거래: 거래내역에서 `×` → 삭제 (시트에서도 지워짐). 내용 수정은 시트에서 직접 하세요.
- 시트에서 직접 고친 뒤에는 앱에서 **⟳ 시트와 동기화**를 누르세요.
- 시트 `설정` 탭의 `시작잔액`은 2026년 1월 1일 기준 통장 잔액입니다.

## 보안 메모

- 토큰을 아는 사람은 가계부를 읽고 쓸 수 있습니다. 토큰은 가족끼리만 공유하세요.
- 토큰이 새었다면: 스크립트 속성 `TOKEN` 값을 바꾸고, 각 폰에서 새 토큰으로 다시 저장하세요.
- 예전 HTML에 들어 있던 토큰 `4832`와 예전 Apps Script 주소는 더 이상 쓰지 마세요 (예전 스크립트는 배포 관리에서 보관처리 권장).
```

`README.md`:
```markdown
# 창호미니 통장

구글 시트와 연동되는 가족 가계부 웹앱(PWA). 폰 홈 화면에 설치해서 씁니다.

- 설치: [docs/SETUP.md](docs/SETUP.md)
- 테스트: `npm test`
- 로컬 실행: `npm run serve` → http://localhost:8080
- 초기 데이터 생성(로컬 전용): `npm run seed` → `apps-script/Seed.gs` (git 제외)
```

- [ ] **Step 2: 비밀 정보가 커밋에 없는지 확인**

Run: `git log --all -p -- . ":(exclude)docs/superpowers" | grep -n -e "AKfycb" -e "<시작잔액 숫자>"`
Expected: 출력 없음. (실제 데이터·예전 Apps Script 주소가 커밋 이력에 없음. spec/plan 문서는 시작잔액 등을 설명하므로 제외. `docs/SETUP.md`의 `4832`는 폐기 안내라 검사 대상 아님.)
걸리는 것이 있으면 push 전에 멈추고 사용자에게 알린다 (이력 재작성 필요).

Run: `git status --short --ignored`
Expected: `!! apps-script/Seed.gs`, `!! reference/` (무시됨 표시)

- [ ] **Step 3: Commit**

```bash
git add docs/SETUP.md README.md
git commit -m "docs: 시트·Apps Script 설치와 폰 설치 안내

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: GitHub 저장소 연결 (사용자 작업 포함)**

사용자에게 요청: GitHub 웹에서 **New repository** → 이름(예: `passbook`) → **Public** → README 등 초기 파일 **추가하지 않음** → 생성 후 저장소 주소를 알려 달라고 한다.

받은 주소로:
```bash
git remote add origin https://github.com/<아이디>/<저장소>.git
git push -u origin main
```
Expected: push 성공 (처음이면 Git Credential Manager가 브라우저 로그인 창을 띄움 — 사용자가 로그인).

- [ ] **Step 5: GitHub Pages 켜기 (사용자 작업)**

사용자에게 안내: 저장소 **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `/ (root)` → Save**. 1~2분 후 주소 표시.

확인:
Run: `curl -s -o /dev/null -w "%{http_code}\n" https://<아이디>.github.io/<저장소>/`
Expected: `200`
Run: `curl -s -o /dev/null -w "%{http_code}\n" https://<아이디>.github.io/<저장소>/sw.js`
Expected: `200`

- [ ] **Step 6: 실제 연동 확인 (사용자와 함께)**

사용자가 SETUP.md 1장을 마친 뒤:
1. 배포된 앱에서 URL·토큰 저장 → "시트와 동기화했어요 · 거래 299건" 토스트.
2. 대시보드 2월 지출·8월 수입 합계가 예전 HTML 대시보드 수치와 같은지 확인.
3. 테스트 거래 1건 입력 → 시트 `거래` 탭 마지막 줄에 생김 → 앱 거래내역에서 `×`로 삭제 → 시트에서도 사라짐.
4. 폰에서 홈 화면에 추가 → 비행기 모드로 열어도 화면과 마지막 데이터가 보이고, 상단에 연결 실패 배너가 뜸.

---

## Self-Review 결과

- **Spec 커버리지:** 시트 구조(§1) → Task 6/7, API(§2) → Task 6, 초기 데이터(§3) → Task 7, 앱 구조·데이터 흐름·model 규칙(§4) → Task 1–5, 8, 9, 버그 수정 5개 → Task 1(날짜), 2(저축률 null), 9(esc, 월 제한 제거, 실제 저장 건수 토스트), 배포(§5) → Task 10, 테스트(§6) → 각 Task, 보안 메모 → Global Constraints + Task 10 Step 2.
- **Spec과 다른 점 (의도적):** `js/dates.js` 추가(날짜 로직 한 곳으로), 1월 `미상세분` 요약 줄 14개 추가(원본 1월 분류 합계 보존 — 원본 HTML의 1월 상세 내역이 분류 합계보다 적음), 거래 중복 표시(Review Focus 3).
- **타입 일관성:** Row 필드(`id,date,kind,name,cat,amount,summary`)가 Code.gs `normalizeSheetRow_`, model, app에서 동일. `validateRow_`/`appendRows_`/`txSheet_`/`writeSettings_` 이름이 Task 6과 Seed.gs 템플릿에서 동일.
