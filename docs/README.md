# 문서 구조

**방법론 / 입력 / 산출물**을 성격에 따라 나눈다. 파일명이 겹쳐 혼동되는 것을 막기 위함이다.

```
docs/
├── process/                 방법론 — "어떻게 하는가"
│   ├── interview.md         단계 1 절차
│   ├── prd.md               단계 2 절차
│   └── issues.md            단계 3 절차
│
├── features/                입력 — "무엇을 만들고 싶은가"
│   └── planner/planner.md   원본 요구사항
│
└── result/                  산출물 — "결정된 것"
    ├── spec-fixed.md        단계 1 결과 · 확정 사양 + 용어 정의
    ├── prd/                 단계 2 결과 · 도메인별 PRD 7개
    │   ├── README.md        PRD 색인 및 진행 현황
    │   ├── auth-member.md
    │   ├── agreement.md
    │   ├── job-post.md
    │   ├── application.md
    │   ├── penalty-rating.md
    │   ├── point-money.md
    │   └── notification.md
    ├── issues.md            단계 3 결과 · 이슈 34개 (수직 슬라이스 + AC)
    └── roadmap-and-split.md 팀 분담 및 스프린트 계획
```

## 어디를 봐야 하나

| 알고 싶은 것                 | 볼 곳                                        |
| ---------------------------- | -------------------------------------------- |
| 이 서비스가 무엇을 하는가    | `result/spec-fixed.md`                       |
| 용어가 정확히 무슨 뜻인가    | `result/spec-fixed.md` §0                    |
| 왜 이 구조로 만들었는가      | `result/prd/{도메인}.md` 의 "기술 결정(ADR)" |
| 이번에 만들지 않는 것        | `result/prd/{도메인}.md` 의 "Out of Scope"   |
| 지금 무엇을 만들면 되는가    | `result/issues.md`                           |
| 누가 무엇을 맡는가           | `result/roadmap-and-split.md`                |
| 이 절차 자체를 다시 돌리려면 | `process/*.md`                               |

## 진행 현황

| 단계               | 산출물                 | 상태                                 |
| ------------------ | ---------------------- | ------------------------------------ |
| 1. AI 인터뷰       | `result/spec-fixed.md` | ✅ 확정                              |
| 2. PRD + ADR       | `result/prd/*.md`      | 🟡 뼈대 7개 완료 / **ADR 33건 미완** |
| 3. 이슈 분해       | `result/issues.md`     | 🟡 34개 작성 / **[GATE] 확인 대기**  |
| 4. 테스트 시나리오 | —                      | ⬜                                   |
| 5. TDD 사이클      | 코드                   | ⬜                                   |

**코드는 5단계에서 처음 나온다.** 1~3단계는 전부 문서다.

## 용어 주의

`process/issues.md`와 `result/issues.md`는 **다른 문서**다.

- `process/issues.md` — 이슈를 **어떻게 자르는가** (방법론)
- `result/issues.md` — 실제로 **자른 이슈 34개** (산출물)

`prd`도 마찬가지다. `process/prd.md`는 절차, `result/prd/`는 결과물이다.
