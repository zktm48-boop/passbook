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
