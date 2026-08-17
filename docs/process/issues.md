# 이슈 분해 — issues.md

> 단계 3 프로세스 가이드. (단계 1: `interview.md`, 단계 2: `prd.md`)
> 이 문서는 **절차 정의**이며, 실제 산출물은 `docs/result/issues.md`에 따로 생성한다.
> 아래 "입력 / 산출물"의 `docs/features/{name}/` 경로는 강의 원문 표기이며,
> 우리 프로젝트의 실제 경로는 문서 하단 "이 프로젝트에서의 적용 메모"를 따른다.

## 목적

PRD를 실행 가능한 작업 단위(GitHub Issues)로 변환한다. 각 이슈는 독립적으로 TDD 사이클을 돌릴 수 있어야 한다.

## 입력

- `docs/features/{name}/prd.md`
- GitHub 프로젝트 보드

## 핵심 활동

### 수직 슬라이싱 원칙

> **"이 이슈만 완료하면 사용자에게 보여줄 수 있는 동작이 있는가?"**
> → 이런 원리로 테스트코드를 처음부터 짠다면 데모로 딱 보여주고 범위가 정해짐

- **Yes** → 수직 슬라이스. TDD 사이클을 돌릴 수 있다.
- **No** → 다른 이슈와 합치거나 다시 나눈다.

**수평 슬라이싱(레이어별: API → Context → UI)은 금지.**
마지막 이슈까지 완료해야 동작이 나오므로 TDD 사이클을 이슈 단위로 돌릴 수 없다.

### 이슈 크기

- 반나절~하루 안에 TDD 사이클(Red→Green→Refactor) 완료 가능한 것
- 너무 크면 피드백 루프가 느려짐, 너무 작으면 PR 오버헤드가 초과

### 의존성 순서

- 앞 이슈의 결과가 다음 이슈의 입력이 되도록 배치
- 역방향 개발 금지

### Acceptance Criteria — Given-When-Then 형식

```markdown
## Acceptance Criteria
- [ ] Given [사전 조건], When [행동], Then [기대 결과]
- [ ] Given [사전 조건], When [행동], Then [기대 결과]
```

각 이슈에 반드시 AC를 포함한다. AC는 다음 단계(`/test-scenarios`)에서 테스트 시나리오의 씨앗이 된다.

```
[GATE] 사용자가 이슈 목록을 읽고 수직 슬라이스 기준 충족을 확인할 때까지 대기
```

### GitHub 등록

```bash
gh issue create --title "이슈 제목" --body "설명 + AC + 의존성"
```

```bash
gh project item-add <PROJECT_NUMBER> --owner <OWNER> --url <ISSUE_URL>
```

## 산출물

- `docs/features/{name}/issues.md`
- GitHub Issues (각 이슈에 AC 포함)
- 프로젝트 칸반 보드 Todo 컬럼에 배치

---

## 승인 게이트 요약 (전 단계 통합)

| 지점 | 확인 내용 |
|---|---|
| 단계 1 후 | `spec-fixed.md` — 모호성 제거, 용어 확정 |
| 단계 2-2 후 | 3가지 안 비교 — 사용자가 안을 선택함 |
| 단계 2-4 후 | Out of Scope — 범위 확정 |
| 단계 3 후 | 이슈 목록 — 수직 슬라이스, AC 구체성, 의존성 순서 |

이 게이트들이 없으면 AI가 판단 없이 끝까지 달려버린다. 스킬에 반드시 `[GATE]`로 명시해야 한다.

---

## 이 프로젝트에서의 적용 메모

> 아래는 원문이 아니라, 우리 프로젝트 상황에 맞춰 덧붙인 실행 메모다.

### 우리 프로젝트의 실제 경로

강의는 기능별 폴더(`docs/features/{name}/`)에 입력과 산출물을 함께 둔다.
우리는 **방법론 / 입력 / 산출물**을 성격에 따라 나눴다. 파일명이 겹쳐 혼동되는 것을 막기 위함이다.

```
docs/
├── process/                 방법론 (강의에서 온 절차)
│   ├── interview.md         단계 1
│   ├── prd.md               단계 2
│   └── issues.md            단계 3  ← 이 문서
├── features/
│   └── planner/planner.md   입력 (원본 요구사항)
└── result/                  산출물
    ├── spec-fixed.md        단계 1 결과
    ├── prd/*.md             단계 2 결과 (7개 도메인)
    ├── issues.md            단계 3 결과 (34개 이슈)
    └── roadmap-and-split.md 팀 분담 및 스프린트
```

| 강의 원문 표기 | 우리 경로 |
|---|---|
| `docs/features/{name}/spec-fixed.md` | `docs/result/spec-fixed.md` (프로젝트 전체 1장) |
| `docs/features/{name}/prd.md` | `docs/result/prd/{도메인}.md` |
| `docs/features/{name}/issues.md` | `docs/result/issues.md` |

### 단계 3은 여전히 기획이다

산출물이 `issues.md` + GitHub Issues이며 **코드는 나오지 않는다.** 실제 구현은 `/test-scenarios` 이후 TDD 사이클에서 시작된다.

"데모로 딱 보여주고"라는 표현은 **이슈를 쪼개는 기준**이지, 이 단계에서 데모를 만든다는 뜻이 아니다. "이 이슈를 구현하면 보여줄 게 있는가"를 묻는 자다.

### 전체 파이프라인

| 단계 | 산출물 | 성격 |
|---|---|---|
| 1. AI 인터뷰 | `spec-fixed.md` | 기획 — 무엇을 |
| 2. PRD + ADR | `prd/*.md` | 기획 — 어떤 구조로, 왜 |
| 3. 이슈 분해 | `issues.md` + GitHub Issues | 기획 — 어떤 순서로, 얼마씩 |
| 4. test-scenarios | (미확보) | 구현 준비 — AC → 테스트 시나리오 |
| 5. TDD 사이클 | **코드** | 구현 |

### 수직 슬라이스 예시 (우리 도메인 기준)

| 나쁨 (수평) | 좋음 (수직) |
|---|---|
| "공고 테이블 및 Prisma 스키마 작성" | "구인자가 공고를 등록하면 목록에 뜬다" |
| "공고 API 엔드포인트 5개 구현" | "구인자가 필수항목을 고치면 version이 오른다" |
| "공고 목록 UI 컴포넌트" | "구직자가 카테고리로 공고를 걸러 본다" |

왼쪽은 셋을 다 해야 보여줄 게 생긴다. 오른쪽은 하나만 해도 데모가 된다.

### 이 프로젝트의 예외: Sprint 0

`roadmap-and-split.md`의 Sprint 0(모노레포 골격, Docker, CI, CSS 토큰, 공통 컴포넌트)은 **수직 슬라이스가 불가능하다.** 사용자에게 보여줄 동작이 없기 때문이다.

이것은 원칙 위반이 아니라 **범위 밖**이다. Sprint 0은 이슈로 쪼개지 않고 셋업 체크리스트로 처리하며, 이슈 분해는 Sprint 1부터 적용한다.
