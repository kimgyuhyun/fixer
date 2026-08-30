# 이 프로젝트에서의 적용

`feature-planner` 스킬을 이 저장소(fixer)에서 실행할 때의 경로 규약과, 한 바퀴 돌려본 실제 사례.

---

## 경로 규약

강의 원문은 기능별 폴더(`docs/features/{name}/`)에 입력과 산출물을 함께 둔다.
우리는 **방법론 / 입력 / 산출물**을 성격에 따라 나눴다. 파일명이 겹쳐 혼동되는 것을 막기 위함이다.

```
docs/
├── process/                 방법론 — "어떻게 하는가"
│   ├── interview.md         단계 1 절차
│   ├── prd.md               단계 2 절차
│   └── issues.md            단계 3 절차
│
├── features/                입력 — "무엇을 만들고 싶은가"
│   └── planner/planner.md   원본 요구사항 (= spec-original)
│
└── result/                  산출물 — "결정된 것"
    ├── spec-fixed.md        단계 1 결과
    ├── prd/{도메인}.md      단계 2 결과
    ├── adr/{도메인}.md      단계 2-2 · 3안 비교 원본
    ├── issues.md            단계 3 결과
    └── roadmap-and-split.md 팀 분담 및 스프린트 계획
```

| 강의 원문 표기 | 우리 경로 |
|---|---|
| `docs/features/{name}/spec-original.md` | `docs/features/planner/planner.md` |
| `docs/features/{name}/spec-fixed.md` | `docs/result/spec-fixed.md` (프로젝트 전체 1장) |
| `docs/features/{name}/prd.md` | `docs/result/prd/{도메인}.md` |
| `docs/features/{name}/issues.md` | `docs/result/issues.md` |

**주의:** `docs/process/issues.md`(방법론)와 `docs/result/issues.md`(산출물)는 다른 문서다.

---

## 기준 6이 참조하는 "기존 패턴"

ADR 비교의 6번 기준(기존 패턴과의 일관성)은 **실제 파일을 가리켜야** 판단에 쓸모가 있다.
이 저장소의 기존 관습:

| 패턴 | 어디에 있나 | 내용 |
|---|---|---|
| API 작성 | `apps/api/src/health/health.controller.ts` | Nest 컨트롤러가 응답을 zod 스키마로 `parse`해서 반환 |
| 타입 공유 | `packages/shared/src/health.ts` | zod 스키마 **하나가** API 검증과 웹 타입을 동시에 책임짐 |
| DB 접근 | `apps/api/src/prisma/prisma.service.ts` | Prisma 7 드라이버 어댑터 방식. 생성물은 `src/generated/prisma` |
| CSS | `apps/web/src/app/globals.css` + `*.module.css` | 토큰은 `globals.css`에만, 화면별 스타일은 CSS 모듈 |

---

## 이 프로젝트에 나온 기술 용어

SKILL.md의 용어 표기 규칙(`용어(한 줄 설명)`)에 쓸 수 있는 사전.
문서를 쓰다 처음 등장하는 용어가 있으면 여기서 설명을 가져다 쓰고, 없으면 새로 쓴 뒤 여기에 추가한다.

| 용어 | 한 줄 설명 |
|---|---|
| TypeScript | JavaScript에 타입을 붙인 언어. 잘못된 값이 들어가면 실행 전에 오류로 잡힌다 |
| Next.js | React로 웹 화면을 만드는 프레임워크. 서버에서 미리 그려 보내는 기능이 있다 |
| Nest.js | TypeScript로 서버(API)를 만드는 프레임워크. 구조가 정해져 있어 규칙이 흐트러지지 않는다 |
| Prisma | TypeScript에서 DB를 다루는 도구. 스키마 파일 하나로 테이블과 타입을 함께 만든다 |
| zod | 런타임에 데이터 모양을 검사하고 TypeScript 타입까지 만들어주는 라이브러리 |
| 스키마(schema) | 데이터가 어떤 모양이어야 하는지 적어둔 것. DB 테이블 정의 또는 zod 검증 규칙 |
| 마이그레이션 | DB 구조 변경을 파일로 기록해 순서대로 적용하는 것. 되돌리기와 재현이 가능해진다 |
| 모노레포 | 프론트·백·공용 코드를 한 저장소에 두고 함께 관리하는 방식 |
| pnpm | 패키지 설치 도구. 모노레포에서 여러 앱의 의존성을 함께 다룬다 |
| ORM | 코드의 객체와 DB 테이블을 이어주는 도구. Prisma가 여기 해당한다 |
| 트랜잭션 | 여러 DB 작업을 하나로 묶는 것. 중간에 실패하면 전부 없던 일이 된다 |
| 원장(ledger) | 잔액을 직접 고치지 않고 증감 내역만 쌓는 방식. 잔액은 그 합계다 |
| 멱등성 | 같은 요청을 두 번 보내도 결과가 한 번 보낸 것과 같은 성질 |
| advisory lock | PostgreSQL이 제공하는 잠금. 여러 서버가 같은 작업을 동시에 하지 않게 막는다 |
| 조건부 UPDATE | `WHERE`에 조건을 넣은 갱신문. 조건이 깨지면 0행이 바뀌어 동시 요청을 걸러낸다 |
| 낙관적 잠금 | 미리 잠그지 않고, 저장할 때 "그동안 안 바뀌었는지" 확인하는 방식 |
| 소프트 삭제 | 행을 지우지 않고 "삭제됨" 표시만 하는 것. 이력과 참조가 살아 있다 |
| 상태머신 | 가능한 상태와 상태 간 이동 규칙을 정해둔 것. 이상한 전이를 막는다 |
| 수직 슬라이싱 | 기능을 레이어가 아니라 "사용자가 볼 수 있는 동작" 단위로 자르는 것 |
| AC (Acceptance Criteria) | "이걸 만족하면 완료"라고 미리 정한 조건. Given-When-Then으로 쓴다 |
| TDD | 테스트를 먼저 쓰고(실패), 통과시키고(구현), 정리하는(리팩토링) 개발 방식 |
| Red / Green / Refactor | TDD의 세 단계. 실패하는 테스트 → 최소 구현 → 구조 개선 |
| Vitest | JavaScript·TypeScript용 테스트 실행 도구 |
| Testcontainers | 테스트할 때 진짜 DB를 컨테이너로 잠깐 띄워주는 도구 |
| E2E 테스트 | 브라우저를 실제로 조작해 사용자 흐름 전체를 검증하는 테스트 |
| 웹훅(webhook) | 외부 서비스가 "일이 끝났다"고 우리 서버를 먼저 호출해주는 방식 |
| 커버링 인덱스 | 필요한 컬럼이 인덱스 안에 다 있어서 테이블을 안 봐도 되는 인덱스 |
| 오프셋 페이징 | "몇 개 건너뛰고 몇 개" 방식. 전체 건수를 셀 수 있다 |
| 키셋(커서) 페이징 | "이 값 다음부터" 방식. 깊은 페이지에서도 빠르지만 전체 건수를 못 센다 |
| ADR | Architecture Decision Record. 무엇을 왜 골랐고 무엇을 버렸는지 남기는 기록 |
| PRD | Product Requirements Document. 기능의 목적·범위·기술 결정을 모은 단일 기준 문서 |
| Ubiquitous Language | 코드·문서·대화에서 같은 것을 같은 단어로 부르기로 정한 용어 집합 |

---

## 한 바퀴 돌린 실제 사례

이 저장소에서 나온 산출물이 그대로 예시다. 새 기능을 기획할 때 형식을 참고한다.

| 단계 | 파일 | 규모 |
|---|---|---|
| 1 | `docs/result/spec-fixed.md` | 12개 섹션, 용어 20여 개 확정 |
| 2-1 | `docs/result/prd/*.md` | 도메인 7개 |
| 2-2 | `docs/result/adr/job-post.md` | ADR 5건 × 3안 × 7기준 |
| 2-3 | `docs/result/prd/job-post.md` §3 | ADR 4요소로 확정 |
| 3 | `docs/result/issues.md` | 이슈 39개, 전부 AC 포함 |
| 3 | GitHub Issues #1~#39 | 라벨 = 담당 3종 + 도메인 7종 |

### 이 프로젝트에서 실제로 겪은 함정

- **인터뷰 중 코드를 미리 짜서 되돌린 적이 있다.** "구조를 정하려면 코드가 있어야 한다"는 판단은 제안까지만 하고 별도 확인을 받아야 한다.
- **원문의 "H2로 테스트"는 그대로 못 쓴다.** 자바 전용 DB라 Prisma에서 연결이 안 된다. 원문을 검토 없이 따르면 나중에 드러난다.
- **이슈 번호에 구멍이 있었다.** `#27`, `#28`이 비어 있어 그대로 등록했으면 GitHub 번호와 2씩 어긋날 뻔했다. 등록 전에 1..N 연속으로 맞춰야 한다.
- **`process/issues.md`와 `result/issues.md`를 헷갈렸다.** 방법론과 산출물의 파일명이 겹치면 반드시 혼동이 생긴다.
