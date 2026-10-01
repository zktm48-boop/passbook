import { listTransactions, addTransactions, deleteTransaction, loadConfig, saveConfig, validateConfig, loadCache, saveCache } from './api.js';
import { pickYear, monthRange, latestDataMonth, monthlyTotals, categoryTotals, endOfMonth, balanceAt, savingRates, ledgerForMonth, isDuplicate, withBalances, searchRows } from './model.js';
import { buildMerchantMap, guessCategory, CATEGORY_KEYWORDS, DEFAULT_CATEGORY } from './categorize.js';
import { parseTableRows, parsePdfLines, extractPdfLines } from './parsers.js';
import { formatKoreanDate, localISODate } from './dates.js';
import { DEFAULT_CONFIG } from './config.js';

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
  config: loadConfig() || (validateConfig(DEFAULT_CONFIG) ? null : { ...DEFAULT_CONFIG }),
  settings: { startBalance: 0, startDate: '' },
  rows: [],
  loaded: false,
  year: today.getFullYear(),
  month: today.getMonth() + 1,
  tab: 'dash',
  catKind: 'expense',
  catOpen: null, // 카테고리 탭에서 펼친 항목 이름
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
    $('settingsCard').open = true;
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
  $('settingsCard').open = true;
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
const SORT_KEY = 'passbook_ledger_desc';
let ledgerDesc = (() => { try { return localStorage.getItem(SORT_KEY) !== '0'; } catch { return true; } })();
let ledgerQuery = '';

function renderLedger() {
  const card = $('ledgerCard');
  const summary = $('searchSummary');
  $('ledgerSort').textContent = ledgerDesc ? '최신순 ↓' : '오래된순 ↑';
  let items;
  if (ledgerQuery.trim()) {
    // 검색 중: 선택한 달과 상관없이 전체 거래에서 찾는다
    items = searchRows(withBalances(state.rows, state.settings.startBalance), ledgerQuery);
    const sum = kind => items.filter(r => r.kind === kind).reduce((a, r) => a + r.amount, 0);
    summary.textContent = `검색 결과 ${items.length}건 · 수입 ${won(sum('income'))} · 지출 ${won(sum('expense'))} · 이체 ${won(sum('transfer'))}`;
    summary.hidden = false;
  } else {
    items = ledgerForMonth(state.rows, state.settings.startBalance, state.year, state.month);
    summary.hidden = true;
  }
  if (!items.length) {
    card.innerHTML = ledgerQuery.trim()
      ? `<div class="empty"><p><b>"${esc(ledgerQuery.trim())}"에 맞는 거래가 없어요</b></p></div>`
      : `<div class="empty"><div class="empty-mark">帳</div>
      <p><b>${state.month}월 거래가 아직 없어요</b></p>
      <p>입력 탭에서 기록하거나 명세서를 올려 보세요.</p></div>`;
    return;
  }
  if (ledgerDesc) items = items.slice().reverse();
  const showYear = ledgerQuery.trim() && new Set(items.map(r => r.date.slice(0, 4))).size > 1;
  let html = '';
  let lastDay = null;
  for (const r of items) {
    if (r.date !== lastDay) {
      html += `<div class="ledger-day">${showYear ? r.date.slice(0, 4) + '년 ' : ''}${formatKoreanDate(r.date)}</div>`;
      lastDay = r.date;
    }
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
  if (!confirm(`"${row.name}" ${won(row.amount)}원 (${KIND_LABEL[row.kind]})을 삭제할까요?\n구글 시트(거래 탭과 연도 탭)에서도 지워져요.`)) return;
  try {
    const { warnings } = await deleteTransaction(state.config, id);
    state.rows = state.rows.filter(r => r.id !== id);
    persist();
    renderAll();
    showToast(warnings.length ? '삭제했어요. 다만 ' + warnings.join(' / ') : '삭제했어요', warnings.length ? 5000 : 2400);
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
  const prefix = `${state.year}-${String(state.month).padStart(2, '0')}`;
  const cls = state.catKind === 'income' ? 'in' : 'out';
  const sign = state.catKind === 'income' ? '+' : '-';
  list.innerHTML = entries.map(([name, val]) => {
    const open = state.catOpen === name;
    let detail = '';
    if (open) {
      const items = state.rows
        .filter(r => r.kind === state.catKind && r.cat === name && r.date.startsWith(prefix))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      detail = `<div class="cat-detail">${items.map(r => `<div class="cat-tx">
          <span class="cat-tx-date">${formatKoreanDate(r.date)}</span>
          <span class="cat-tx-name">${esc(r.name)}${r.summary ? '<span class="sum-badge">월 합계</span>' : ''}</span>
          <span class="cat-tx-amt ${cls}">${sign}${won(r.amount)}</span>
        </div>`).join('')}</div>`;
    }
    return `<div class="cat-item${open ? ' open' : ''}" data-cat="${esc(name)}">
      <div class="cat-top"><span class="nm"><span class="cat-caret">▸</span>${esc(name)}</span><span class="amt">${won(val)}</span></div>
      <div class="cat-bar-bg"><div class="cat-bar-fill" style="width:${(val / max * 100).toFixed(0)}%;${fill}"></div></div>
      <div class="cat-pct">${state.month}월 전체의 ${(val / total * 100).toFixed(1)}%</div>
      ${detail}
    </div>`;
  }).join('');
}

/* ---------- 입력 ---------- */
function categoryNames(kind) {
  const seen = new Set(state.rows.filter(r => r.kind === kind).map(r => r.cat));
  for (const c of BASE_CATS[kind]) seen.add(c);
  return [...seen];
}

// 같은 내용을 다시 보내면 같은 requestId를 써서 서버가 중복 저장하지 않게 한다
let lastAdd = null;
function requestIdFor(rows) {
  const key = JSON.stringify(rows);
  if (lastAdd && lastAdd.key === key) return lastAdd.id;
  const id = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
  lastAdd = { key, id };
  return id;
}

async function saveRows(rows) {
  const { ids, warnings } = await addTransactions(state.config, rows, undefined, requestIdFor(rows));
  lastAdd = null;
  const known = new Set(state.rows.map(r => r.id));
  rows.forEach((r, i) => { if (!known.has(ids[i])) state.rows.push({ ...r, id: ids[i], summary: false }); });
  persist();
  // 앱·거래 탭에는 저장됐지만 기존 연도 탭 기록이 실패한 경우 (성공 토스트 뒤에 보여줌)
  if (warnings.length) setTimeout(() => showToast('저장은 됐어요. 다만 ' + warnings.join(' / '), 5000), 2500);
  return ids;
}

function reportSaveError(e, keepMsg) {
  if (e.uncertain) {
    showToast('저장됐는지 확인하지 못했어요. 시트에서 다시 불러올게요 — 다시 눌러도 중복 저장되지 않아요', 5000);
    sync({ quiet: true });
  } else {
    showToast('저장 실패: ' + e.message + ' ' + keepMsg, 4000);
  }
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
    await saveRows([row]);
    if (Number(date.slice(0, 4)) === state.year) state.month = Number(date.slice(5, 7));
    $('inName').value = ''; $('inCat').value = ''; $('inAmt').value = '';
    populateCatOptions();
    renderAll();
    showToast('통장과 시트에 기록했어요 ✓');
  } catch (e) {
    reportSaveError(e, '(입력값은 그대로 있어요)');
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
      items = parsePdfLines(await extractPdfLines(buf, window.pdfjsLib), year, today);
    } else {
      if (!window.XLSX) throw new Error('엑셀 라이브러리를 불러오지 못했어요 (인터넷 연결 확인)');
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      items = parseTableRows(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }), year, today).items;
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
    const ids = await saveRows(rows);
    state.pending = [];
    $('previewCard').style.display = 'none';
    $('inStatementFile').value = '';
    renderAll();
    showToast(`${ids.length}건을 통장과 시트에 등록했어요 ✓`);
  } catch (e) {
    reportSaveError(e, '(아무것도 저장되지 않았어요)');
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
  if ($('banner').hidden) $('settingsCard').open = false;
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
    state.catOpen = null;
    renderCatList();
  }));
  $('catList').addEventListener('click', e => {
    const item = e.target.closest('.cat-item');
    if (!item) return;
    state.catOpen = state.catOpen === item.dataset.cat ? null : item.dataset.cat;
    renderCatList();
  });
    $('ledgerSearch').addEventListener('input', e => { ledgerQuery = e.target.value; renderLedger(); });
  $('ledgerSort').addEventListener('click', () => {
    ledgerDesc = !ledgerDesc;
    try { localStorage.setItem(SORT_KEY, ledgerDesc ? '1' : '0'); } catch {}
    renderLedger();
  });
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
