import { parseDateFlexible } from './dates.js';

const toNum = v => {
  const n = Number(String(v ?? '').replace(/[,\s원₩]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const cellText = v => String(v ?? '').trim();

export function parseTableRows(rows, defaultYear, today) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map(cellText);
    const d = row.indexOf('날짜'), c = row.indexOf('항목'), a = row.indexOf('금액');
    if (d !== -1 && c !== -1 && a !== -1) {
      return { format: 'simple', items: parseSimple(rows, i, d, c, a, defaultYear, today) };
    }
  }
  return { format: 'card', items: parseCard(rows, defaultYear, today) };
}

function parseSimple(rows, headerIdx, dateCol, catCol, amtCol, year, today) {
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const cat = cellText(row[catCol]);
    const amount = Math.abs(Math.round(toNum(row[amtCol])));
    const date = parseDateFlexible(row[dateCol], year, today);
    if (!cat || !amount || !date) continue;
    out.push({ date, name: cat, amount, cat });
  }
  return out;
}

function parseCard(rows, year, today) {
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
    const date = parseDateFlexible(row[dateCol], year, today);
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

export function parsePdfLines(lines, defaultYear, today) {
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
    const date = parseDateFlexible(`${mm}/${dd}`, defaultYear, today);
    if (!name || amount <= 0 || !date) continue;
    out.push({ date, name, amount });
  }
  return out;
}
