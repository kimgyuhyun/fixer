---
name: tdd-auto-loop
description: 이슈를 사람에게 묻지 않고 순서대로 계속 만드는 자율 루프. 이슈 하나는 한 agent가 시나리오부터 PR까지 통째로 끝내고, 끝나면 다음 이슈로 바로 넘어간다. 담당 목록(docs/result/build-order.md)의 A 몫을 다 끝내면 B 몫으로 넘긴다. 막히면 사람에게 묻지 않고 이슈에 코멘트를 남기고 그 이슈만 건너뛴다. 사용자가 "/tdd-auto-loop", "/tdd-auto-loop 12", "쭉쭉 진행", "계속 만들어", "알아서 완주해줘", "무인으로 진행"이라고 할 때 사용한다. 번호를 주면 그 이슈부터, 안 주면 담당 목록의 다음 미완료 이슈부터 시작한다.
---

# TDD 자율 루프

**이슈를 순서대로 계속 만든다.** 하나 끝나면 묻지 않고 다음으로 간다.

```
docs/result/build-order.md 의 순서대로

  #3 ──→ #4 ──→ #5 ──→ #6 ──→ ... ──→ #16     A 몫 19개
                                          ↓  다 끝나면 넘긴다
  #17 ─→ #18 ─→ #19 ─→ ... ──────→ #33        B 몫 18개
```

**사용법**

```
/tdd-auto-loop        담당 목록의 다음 미완료 이슈부터 계속
/tdd-auto-loop 12     12번부터 계속
```

---

## 나누는 단위는 이슈다

**이슈 하나 안에서 역할을 나누지 않는다.** 한 agent가 시나리오부터 PR까지 통째로 끝낸다.

```
이슈 하나 = agent 하나

  0 precheck → 1 시나리오 → 2 Red → 3 Green
  → 4 AC검증 → 5 Refactor → 6 보안 → 7 PR
```

나누는 건 **이슈 목록**이다. A가 앞 절반을 순서대로 다 만들고, 그 다음 B가 뒤 절반을 이어서 만든다. 그러면 각자 자기가 만든 기능을 알고 있으니 그대로 맡아 유지보수하면 된다.

단계마다 사람을 갈아끼우면 인수인계만 여섯 번이다. 만드는 사람이 계속 바뀌면 아무도 그 기능을 모른다.

### 예외 하나 — AC 검증

4단계에서만 `ac-verifier`를 **따로 띄운다.** 자기가 짠 코드를 자기가 검증하면 통과시킬 이유를 찾기 때문이다.

교대가 아니다. 검사 한 번 받고 그 자리에서 이어서 하는 것이고, `ac-verifier`는 판정만 하고 코드를 고치지 않는다.

---

## 이 스킬을 부르는 것이 곧 승인이다

`CLAUDE.md`는 `git push`와 PR 생성에 확인을 요구한다. 이 루프는 묻지 않고 실행한다. 브랜치 생성·커밋·push·PR 생성·이슈 코멘트 전부가 승인 범위다.

승인 범위 **밖**: 강제 푸시, 브랜치·파일 삭제, 이력 조작, 의존성 대량 변경, 외부 서비스 실제 호출. 필요해지면 그 이슈를 **SKIP**한다.

---

## 메인이 하는 일

```
반복 {
  1. build-order.md 에서 다음 이슈를 고른다
  2. agent 하나 띄운다  (그 이슈를 통째로)
  3. JSON 받아 OK / SKIP 판정
  4. OK면 다음 이슈로. SKIP이면 이슈에 코멘트 남기고 다음 이슈로
}
A 몫이 끝나면 → B 몫으로 넘어간다
```

**메인은 코드 본문을 읽지 않는다.** 숫자와 상태만 본다.

**한 이슈가 막혀도 루프는 멈추지 않는다.** 그 이슈만 건너뛰고 다음으로 간다. 하나 막혔다고 나머지 36개를 세울 이유가 없다.

단, **선행 이슈가 SKIP된 이슈는 함께 건너뛴다.** 결과물이 없으니 어차피 막힌다.

### 재시도 한도 — 이게 없으면 무한히 돈다

**agent가 죽으면(사망·정지·오류) 그 이슈는 딱 한 번만 다시 띄운다. 두 번째로 죽으면 재시도하지 말고 `agent_died_2x`로 SKIP하고 사람에게 넘긴다.**

**이슈 하나에 90분을 넘기면 결과와 무관하게 멈추고 사람에게 넘긴다.**

실제로 이 한도가 없어서 이슈 #3 하나에 agent를 네 번 다시 띄웠고, 사용자가 자는 동안 밤새 돌았다. `green_failed_3x`는 **agent 안쪽** 한도지 메인이 몇 번 다시 띄우는지가 아니다. 그 빈칸을 메우는 규칙이다.

---

## 사람에게 묻는 유일한 경우

**문서에 답이 없는 결정을 만났을 때만.** 그 외에는 묻지 않는다.

묻기 전에 **반드시 이 순서로 먼저 찾는다.**

1. `docs/result/spec-fixed.md` — 제품 규칙
2. `docs/result/prd/{도메인}.md` §3 — 확정된 ADR
3. `docs/result/adr/{도메인}.md` — 3안 비교 원본
4. 이슈 본문의 AC
5. 같은 계층의 기존 코드

**여기 답이 있으면 그대로 쓴다. 다시 고르라고 묻지 않는다.**

실제로 있었던 실수: `spec-fixed.md` §2.4·§2.6이 "**모든** Refresh 토큰 무효화"라고 두 번 써서 토큰이 회원당 여럿임을 이미 정하고 있었는데, 그걸 못 보고 3안을 만들어 사용자에게 고르라고 했다. 문서를 먼저 뒤졌으면 안 물어도 됐다.

**ADR이 진짜로 TODO면** — 그건 물어야 한다. 자율 모드가 구조를 정하면 나중에 뜯는다. 그 이슈를 SKIP하고 다음 이슈로 넘어간 뒤, 루프가 다 끝났을 때 **막힌 ADR을 한 번에 모아** 사용자에게 가져간다. 한 건씩 끊어 묻지 않는다.

---

## 이슈 하나를 도는 agent 프롬프트

```
너는 이슈 {N} "{제목}"을 처음부터 끝까지 만든다.
아래 여덟 단계를 순서대로, 중간에 멈추지 말고 끝까지 수행하라.

  0. precheck
  1. .claude/skills/test-scenarios/SKILL.md 를 읽고 수행
  2. .claude/skills/tdd-red/SKILL.md        를 읽고 수행
  3. .claude/skills/tdd-green/SKILL.md      를 읽고 수행
  4. ac-verifier agent를 따로 띄워 AC 충족을 독립 검증받는다
  5. .claude/skills/tdd-refactor/SKILL.md   를 읽고 수행
  6. .claude/skills/security-review/SKILL.md 를 읽고 수행
  7. .claude/skills/create-pr/SKILL.md      를 읽고 수행

먼저 CLAUDE.md 를 읽어라. 그리고 구현 전에 아래를 반드시 읽어라.
  docs/result/spec-fixed.md 의 해당 절
  docs/result/prd/{도메인}.md §3 의 확정된 ADR

**거기 정해진 값을 네가 다시 정하지 마라.** 이미 정해져 있다.

브랜치: feat/{도메인}/issue-{N}  (base: main)

**단계마다 커밋하라. 마지막에 한 번만 커밋하지 마라.**
  1단계 끝 → docs: {제목}의 테스트 시나리오를 도출
  2단계 끝 → test: {제목}의 실패 테스트와 stub를 추가
  3단계 끝 → feat: {제목}   (본문에 closes #{N})
긴 작업은 중간에 죽는다. 커밋해 두지 않으면 그때까지 한 게 전부 날아간다.
commitlint 주의 — 제목을 대문자로 시작하면 거부된다 (subject-case).

시나리오는 AC당 4~6개를 목표로 한다. 경계값은 진짜 경계만 넣는다.

{자율 모드 블록}
{JSON 스키마}
```

### 0 · precheck

```bash
gh issue view {N} --json number,title,body,labels,state
git status --porcelain
docker info > /dev/null 2>&1
```

| 확인                 | 어긋나면 SKIP           |
| -------------------- | ----------------------- |
| AC 체크박스가 있는가 | `no_ac`                 |
| worktree가 깨끗한가  | `dirty_worktree`        |
| 선행 이슈가 닫혔는가 | `blocked_by_open_issue` |
| 대상 브랜치가 없는가 | `branch_exists`         |
| Docker가 켜져 있는가 | `docker_off`            |
| `gh` 인증됐는가      | `gh_unauthenticated`    |

### 진행 중 스스로 확인할 것

사람에게 묻지 않되, 어긋나면 SKIP한다. **승인 게이트가 아니라 사실 확인이다.**

| 경계  | 확인                                      | 어긋나면               |
| ----- | ----------------------------------------- | ---------------------- |
| 1 → 2 | 시나리오가 AC를 전부 덮었는가             | `ac_not_covered`       |
| 2 → 3 | 이번 이슈가 더한 테스트 수 == 시나리오 수 | `collect_mismatch`     |
| 2 → 3 | **Red에서 통과한 테스트가 0개인가**       | `red_has_passing_test` |
| 4     | AC가 전부 PASS인가                        | `ac_gap`               |
| 5     | 롤백 후에도 테스트가 깨져 있는가          | `refactor_broke_tests` |
| 6     | `blocking` 항목이 있는가                  | `security_blocking`    |
| 7     | commitlint · E2E · push                   | 각각 `*_failed`        |

Red 조건이 가장 중요하다. **구현이 없는데 통과했다는 건 그 테스트가 가짜라는 뜻이다.** 통과한 테스트가 있으면 그걸 고쳐서 실패시키는 게 아니라 SKIP한다.

AC 갭은 자동으로 메우지 않는다. 테스트를 더 쓰라고 시키면 통과할 때까지 쓰게 되고, 그건 AC 충족이 아니라 통과 조작이다.

Green이 실패하면 **agent 안에서 최대 3회** 재시도한다. 메인에게 돌아오지 않는다.

### 공유 개발 DB를 건드리지 마라

**`prisma migrate dev`를 그냥 돌리지 마라.** 개발 DB는 브랜치 전체가 하나를 공유하는데 브랜치마다 마이그레이션이 다르다. 다른 브랜치가 적용해 둔 마이그레이션이 DB에 남아 있으면 Prisma가 드리프트로 보고 **대화형으로 물어본다.** agent는 답할 수 없어 그대로 멈춘다 — 실제로 600초 정지 후 죽었다.

- 마이그레이션 SQL이 필요하면 `prisma migrate dev --create-only` 로 **파일만** 만든다
- **테스트는 Testcontainers가 격리된 새 DB를 띄운다.** 공유 개발 DB가 필요 없다
- 개발 DB를 실제로 맞추는 건 사람이 `pnpm dev`를 띄울 때 할 일이다

DB를 리셋해야 할 것 같으면 그건 SKIP 사유다. 지우지 마라.

### 단계마다 커밋한다 — 죽어도 안 날아가게

**긴 agent는 죽는다.** API 오류, 프로세스 종료 — 실제로 6개 중 3개가 죽었다. 마지막에 한 번만 커밋하면 24분째에 죽을 때 24분이 통째로 날아간다.

그래서 **각 단계가 끝날 때마다 커밋한다.** 세 번이다.

| 단계 끝    | 커밋                                       |
| ---------- | ------------------------------------------ |
| 1 시나리오 | `docs: {제목}의 테스트 시나리오를 도출`    |
| 2 Red      | `test: {제목}의 실패 테스트와 stub를 추가` |
| 3 Green    | `feat: {제목}` (본문에 `closes #{N}`)      |

5·6단계에서 고친 것이 있으면 그때도 커밋한다.

죽은 뒤에 이어받는 agent는 `git log`만 보면 어디까지 됐는지 안다. 커밋이 쪼개져 있으면 PR도 읽기 쉬워진다 — 시나리오 → 테스트 → 구현 순서가 그대로 보인다.

---

## 자율 모드 지시문

**모든 agent 프롬프트 끝에 그대로 붙인다.**

```
[자율 모드]
- 이 작업은 사람이 지켜보지 않는다. 스킬 안의 사용자 승인 게이트는 네가 판단해 통과시킨다.
- 사람에게 묻지 마라. 확인·승인·선택을 요청하지 마라.
- 맡은 이슈는 중간에 멈추지 말고 PR까지 끝까지 간다. 단계 사이에 보고하지 않는다.
- 결정이 필요하면 먼저 문서를 뒤져라 — spec-fixed.md, prd/{도메인}.md §3, adr/{도메인}.md,
  이슈 AC, 기존 코드. 거기 답이 있으면 그대로 쓴다.
- 문서에도 없고 추측하면 나중에 뜯을 구조 결정이면 SKIP한다. 묻지 말고 SKIP이다.
- 승인 범위 밖(강제 푸시, 삭제, 이력 조작, 의존성 대량 변경, 외부 서비스 실호출)이
  필요하면 SKIP한다.
- 출력은 맨 마지막에 JSON 한 블록만이다. 그 앞뒤로 설명·인사·요약을 쓰지 마라.
- 스키마의 키를 추가·제거·개명하지 마라. 값만 채운다.
- SKIP하더라도 JSON은 반드시 낸다. 끝낸 것은 채우고 못 간 것은 null로 둔다.
```

---

## 반환 JSON

```json
{
  "issue": 4,
  "status": "OK",
  "reason": null,
  "stopped_at": null,
  "domain": "auth-member",
  "branch": "feat/auth-member/issue-4",
  "commit": "2630bb5",
  "pr_url": "https://github.com/kimgyuhyun/fixer/pull/41",
  "scenario_count": 25,
  "ac_total": 4,
  "ac_passed": true,
  "ac_gaps": [],
  "tests_added": 25,
  "tests_total": 94,
  "tests_failed": 0,
  "red_tests_passed": 0,
  "coverage_pct": 75.4,
  "typecheck_errors": 0,
  "blocking": [],
  "recommended": [],
  "needs_decision": null,
  "e2e": "skipped_not_configured"
}
```

`status`는 `OK` 또는 `SKIP`. SKIP이면 `stopped_at`에 어느 단계였는지, `reason`에 사유 코드를 넣는다.

`tests_total`은 **저장소 전체 스위트**, `tests_added`는 **이번 이슈가 더한 개수**다. `scenario_count`와 대조하는 건 `tests_added`다. 둘을 구분하지 않으면 멀쩡한 결과를 `collect_mismatch`로 잘못 SKIP한다.

`needs_decision`은 문서에 답이 없어 막혔을 때만 채운다. 루프 끝에 모아서 사용자에게 가져간다.

```json
"needs_decision": {
  "id": "ADR-AUTH-2",
  "question": "카카오 주소 응답을 분해해 저장할지 통으로 둘지",
  "why": "관리자 화면이 시/도 → 시/군/구 필터를 요구한다"
}
```

**메인의 SKIP 판정:** `status == "SKIP"` · `ac_passed == false` · `red_tests_passed > 0` · `tests_added != scenario_count` · `tests_failed > 0` · `blocking` 비어있지 않음 · `pr_url` 없음

---

## 진행 표시

이슈 하나당 한 줄이다.

```
[#3]  OK   시나리오 22 · 테스트 +22 · PR #41
[#4]  OK   시나리오 25 · 테스트 +25 · PR #42
[#5]  SKIP ac_gap — AC 3이 검증되지 않음
[#6]  OK   시나리오 19 · 테스트 +19 · PR #43
```

---

## SKIP 처리

**멈추지 않는다.** 이슈에 코멘트를 남기고 다음 이슈로 간다.

```bash
gh issue comment {N} --body-file {리포트파일}
```

브랜치와 커밋은 그대로 둔다. 되돌리지 않는다 — 사람이 이어서 하거나 버릴지 판단할 몫이다.

선행이 SKIP된 이슈는 함께 건너뛰고 `blocked_by_skipped`로 기록한다.

---

## SKIP 사유 목록

| 사유                    | 뜻                                         |
| ----------------------- | ------------------------------------------ |
| `no_ac`                 | 이슈에 AC가 없다                           |
| `dirty_worktree`        | 커밋되지 않은 변경이 있다                  |
| `blocked_by_open_issue` | 선행 이슈가 열려 있다                      |
| `blocked_by_skipped`    | 선행 이슈가 이번 루프에서 SKIP됐다         |
| `branch_exists`         | 대상 브랜치가 이미 있다                    |
| `docker_off`            | Docker가 꺼져 있다                         |
| `gh_unauthenticated`    | `gh` 로그인이 안 되어 있다                 |
| `ac_not_covered`        | 시나리오가 AC를 다 덮지 못한다             |
| `red_has_passing_test`  | 구현이 없는데 통과한 테스트가 있다 (가짜)  |
| `collect_mismatch`      | 더한 테스트 수와 시나리오 수가 다르다      |
| `green_failed_3x`       | 3회 시도에도 통과하지 못했다               |
| `ac_gap`                | AC 충족이 확인되지 않았다                  |
| `refactor_broke_tests`  | 롤백 후에도 테스트가 깨져 있다             |
| `security_blocking`     | 즉시 수정이 필요한 항목이 있다             |
| `commitlint_failed`     | 커밋 메시지가 규칙을 어긴다                |
| `e2e_failed`            | E2E가 실패했다                             |
| `push_failed`           | push가 거부됐다                            |
| `adr_todo`              | 구조 결정이 필요한데 문서에 답이 없다      |
| `db_drift`              | 개발 DB가 브랜치와 어긋난다 (리셋 금지)    |
| `schema_violation`      | agent가 스키마를 어겼다 (복구 요청 후에도) |
| `agent_died_2x`         | agent가 두 번 죽었다. 재시도 금지, 사람에게 |
| `over_time_budget`      | 이슈 하나에 90분을 넘겼다                   |

---

## 스키마 위반 처리

**작업을 다시 시키지 않는다.** 코드와 커밋은 이미 나와 있고 없는 것은 보고서뿐이다. `SendMessage`로 같은 agent에게 JSON만 다시 요청한다. 1회 후에도 어긋나면 `schema_violation`으로 SKIP.

---

## 루프 리포트

담당 몫을 다 돌면 한 번 출력한다.

```
A 몫 19개 — 완료 16 · SKIP 3

  ✅ #3 #4 #5 #6 #7 #8 #27 #9 #10 #39 #28 #29 #30 #11 #12 #13
  ⏭️  #14 ac_gap · #15 adr_todo · #16 blocked_by_skipped

  ⚠️ 사람이 봐야 할 결정 2건
     ADR-JOB-2  공고 version 이력을 스냅샷으로 둘지 diff로 둘지
     ADR-AGR-1  서명 캔버스 좌표를 어디서 정규화할지

  ⚠️ security recommended 5건 · E2E 전부 미실행
```

**`⚠️`를 반드시 낸다.** 자율 실행은 "문제 없었다"가 아니라 "SKIP 조건에 안 걸렸다"는 뜻이다.

---

## 언제 쓰지 않나

| 상황                            | 대신                                      |
| ------------------------------- | ----------------------------------------- |
| ADR이 통째로 TODO인 도메인      | 먼저 ADR을 확정한다. 루프가 전부 SKIP한다 |
| 이슈 AC가 부실하다              | AC부터 보강한다. precheck에서 SKIP된다    |
| 한 이슈를 손으로 보며 하고 싶다 | `/tdd-loop {N}` — 게이트마다 멈춘다       |
