# 창호미니 통장 PWA — 설계

작성일: 2026-09-29

## 목표

기존 단일 HTML 가계부(`창호미니 통장`)를 폰 홈 화면에 설치해 쓰는 웹앱(PWA)으로 만들고,
구글 시트를 유일한 데이터 원본으로 삼는다.

**성공 기준**
- 두 사람(창호, 미니)이 각자 폰 홈 화면에서 앱을 열어 같은 시트 데이터를 보고 입력할 수 있다.
- 앱 코드(공개 저장소)에는 실제 가계 데이터나 토큰이 들어 있지 않다.
- 오프라인에서도 앱이 열리고 마지막으로 불러온 데이터를 볼 수 있다.
- 기존 1~8월 데이터가 시트로 옮겨져 대시보드 수치가 유지된다.

**하지 않는 것 (YAGNI)**
- 앱 안에서 거래 수정 (시트에서 직접 수정)
- 오프라인 입력 대기열
- 구글 로그인/OAuth
- 스토어 배포

## 아키텍처

```
[폰: PWA (GitHub Pages, 정적 파일)]
      │  GET  ?action=list&token=…            (fetch)
      │  POST text/plain {action, token, …}   (fetch, CORS preflight 없음)
      ▼
[Apps Script 웹 앱 /exec]  ── 실행 계정: 소유자, 액세스: 모든 사용자
      │
      ▼
[구글 시트: `거래` 탭, `설정` 탭]
```

## 1. 시트 구조

### `거래` 탭 (1행 헤더)

| 열 | 이름 | 형식 | 설명 |
|---|---|---|---|
| A | id | 문자열 | `t_` + 무작위. 서버가 부여 |
| B | 날짜 | `YYYY-MM-DD` 텍스트 | 요일/한글 표기는 앱이 표시할 때만 생성 |
| C | 구분 | `수입` \| `지출` \| `이체` | 이체 = 저축/투자 이동 |
| D | 내역 | 문자열 | |
| E | 분류 | 문자열 | |
| F | 금액 | 양의 정수 | |
| G | 요약 | `Y` 또는 빈칸 | 분류별 월 합계 줄 표시 |
| H | 입력시각 | `YYYY-MM-DD HH:mm` | 서버가 기록 |

잔액 열은 두지 않는다. 앱이 계산한다.

### `설정` 탭 (A열 키, B열 값)

| 키 | 값 |
|---|---|
| 시작잔액 | (원본의 전년도 이월금) |
| 시작일 | 2026-01-01 |

## 2. Apps Script API (`apps-script/Code.gs`)

- 토큰은 Script Properties의 `TOKEN`. 코드에 없음.
- 모든 응답: `{status:"ok", …}` 또는 `{status:"error", message}` (ContentService JSON).
- 쓰기는 `LockService.getScriptLock()`으로 직렬화.

| 요청 | 입력 | 응답 |
|---|---|---|
| `GET ?action=list&token=` | — | `{status, settings:{startBalance, startDate}, rows:[{id,date,kind,name,cat,amount,summary}]}` |
| `POST {action:"add", token, rows:[{date,kind,name,cat,amount}]}` | 1건 이상 | `{status, ids:[…]}` |
| `POST {action:"delete", token, id}` | | `{status}` (없는 id → error) |

입력 검증(서버): 날짜 `^\d{4}-\d{2}-\d{2}$`, 구분 3종, 금액 양의 정수, 내역·분류 비어 있지 않음.
하나라도 틀리면 전체 요청 거부.

`kind` 값은 API에서 `income|expense|transfer`, 시트에는 `수입|지출|이체`로 저장.

## 3. 초기 데이터 이전 (`apps-script/Seed.gs`, git 제외)

- 기존 HTML의 하드코딩 데이터를 행으로 변환한 파일. `.gitignore`에 포함.
- 사용자가 Apps Script 편집기에 붙여 넣고 `seed()`를 한 번 실행.
- `거래` 탭에 헤더 외 행이 있으면 아무것도 하지 않음 (중복 방지). `설정` 탭도 생성.
- 1월: 상세 거래(약 100건)를 그대로. 기존 `-90000` 같은 문자열 음수 = 이체.
  "전년도 이월금" 행(금액 없음)은 시작잔액으로 대체하므로 제외.
- 2~8월: `incomeCats`/`expenseCats`의 0이 아닌 값마다 요약 행 1개
  (날짜 = 해당 월 말일, 내역 = `N월 <분류> 합계`, 요약 = `Y`),
  `totals.saving` 값마다 이체 요약 행 1개 (분류 `저축`).
- `Seed.gs`는 생성 스크립트(`tools/build-seed.mjs`)가 원본 HTML(`reference/original.html`, git 제외)에서 만든다.

## 4. 앱 구조

```
index.html            마크업 + CSS (기존 디자인 유지)
manifest.webmanifest  이름, start_url ".", display standalone, 아이콘
sw.js                 앱 셸 + CDN 라이브러리 캐시 (cache-first), API 요청은 캐시 안 함
icons/icon-192.png, icon-512.png, apple-touch-icon.png
js/api.js             설정(localStorage: url, token) + list/add/remove
js/model.js           순수 함수: 월별 합계, 분류별 합계, 누적 잔액, 저축률
js/parsers.js         엑셀(카드 명세서 / 날짜·항목·금액 3열), 하나카드 PDF → 후보 거래
js/categorize.js      가맹점 → 분류 (과거 거래 학습 + 키워드)
js/app.js             렌더링, 이벤트
tests/*.test.mjs      node --test
```

ES 모듈(`<script type="module">`). 빌드 도구 없음. Chart.js, SheetJS, pdf.js는 기존과 같은 cdnjs 주소.

### 데이터 흐름
1. 시작 시 localStorage의 마지막 응답(`cache_rows`)으로 즉시 렌더 → `list` 호출 → 성공하면 캐시 갱신 후 다시 렌더.
2. URL/토큰 미설정이면 설정 카드가 있는 `입력` 탭을 먼저 열고 안내.
3. 입력·일괄 등록: `add` 성공 후 반환 id로 로컬 목록에 추가하고 렌더. 실패 시 토스트, 입력값 유지.
4. 삭제: 거래내역 행 탭 → 확인 → `delete` → 성공 시 목록에서 제거.

### model.js 규칙
- 연도: 데이터가 있는 가장 최근 연도. 월 칩은 그 연도의 1월 ~ 데이터가 있는 마지막 달(최소 현재 달까지).
- 잔액(월 선택 시): 시작잔액 + 선택 달 말까지 수입 − 지출 − 이체.
- 저축률: 수입이 0인 달은 `null` (차트에서 빈칸).
- 거래내역 누적 잔액: 날짜순(같은 날짜는 시트 순서) 계산.

### 함께 고치는 버그
- 날짜 하루 밀림: `toISOString()` 대신 로컬 날짜로 `YYYY-MM-DD` 생성.
- 수입 0인 달의 저축률 `NaN`/`Infinity`.
- 가맹점명 등 외부 문자열을 HTML 이스케이프 후 출력.
- 1~8월 밖 날짜 차단 제거 (모든 달 입력 가능).
- 일괄 등록 건수 토스트는 실제 저장 성공 건수로.

## 5. 배포

1. 새 구글 시트 → 확장 프로그램 → Apps Script → `Code.gs`, `Seed.gs` 붙여넣기
   → 프로젝트 설정에서 스크립트 속성 `TOKEN` 추가 → `seed()` 1회 실행
   → 배포 → 새 배포 → 웹 앱 (실행: 나, 액세스: 모든 사용자) → `/exec` URL 복사.
   단계별 안내는 `docs/SETUP.md`.
2. GitHub 웹에서 빈 공개 저장소 생성 → 로컬에서 `git push` → Settings → Pages → main 브랜치 루트.
3. 폰: 아이폰 Safari 공유 → 홈 화면에 추가 / 안드로이드 Chrome → 앱 설치. 첫 실행 시 URL·토큰 입력.

## 6. 테스트

- `node --test`: model.js(합계, 잔액, 저축률 null), parsers.js(날짜 변환 — 한국 시간대에서 하루 밀림 없음, 3열 표, 카드 명세서 소계 제외), seed 변환(월별 합계 = 원본 합계, 기대값은 git 제외 원본에서 계산).
- 로컬 정적 서버로 화면 확인 (가짜 API 응답 모드 없이, 캐시 데이터 주입으로 렌더 확인).
- Apps Script는 배포 후 사용자가 `list` 호출 결과 확인.

## 보안 메모

- 공개 저장소: 코드에 토큰·URL·가계 데이터 없음. `reference/`, `apps-script/Seed.gs` git 제외.
- 토큰을 아는 사람은 읽기·쓰기 가능. 토큰은 추측하기 어려운 긴 문자열 사용 (SETUP.md에서 생성 방법 안내). 기존 토큰 `4832`와 기존 Apps Script 주소는 폐기 권장.
