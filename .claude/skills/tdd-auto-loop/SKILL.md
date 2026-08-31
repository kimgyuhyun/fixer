---
name: tdd-auto-loop
description: 이슈 하나를 TDD 8단계로 사람에게 묻지 않고 끝까지 완주하는 자율 루프. A가 앞 절반(0~3 precheck·시나리오·Red·Green)을 한 번에 끝내고, B가 뒤 절반(4~7 AC검증·Refactor·보안·PR)을 받아서 한 번에 끝낸다. 인수인계는 딱 한 번이고 메인은 코드 본문을 보지 않는다. AC 검증은 만든 A가 아니라 B가 한다. STOP 조건에 걸리면 사람에게 묻지 않고 이슈에 코멘트를 남기고 종료한다. 사용자가 "/tdd-auto-loop 12", "12번 자동으로 끝까지", "오토루프 돌려줘", "알아서 완주해줘", "무인으로 진행"이라고 할 때만 사용한다. 확인을 받으며 진행하고 싶으면 /tdd-loop을 쓴다.
---

# TDD 자율 루프 — 반반 2교대

사람의 개입 없이 이슈 하나를 끝까지 완주한다. 8단계를 **넷씩 반반** 나눈다.

```
/tdd-auto-loop {N}

  A  0 precheck → 1 scenarios → 2 red → 3 green      ← subagent 하나, 통째로
                        ↓  한 번만 넘긴다
  B  4 ac_verify → 5 refactor → 6 security → 7 pr    ← subagent 하나, 통째로
```

A는 만들어서 넘긴다. B는 받아서 끝낸다. **그게 전부다.**

**사용법:** `/tdd-auto-loop 12` (GitHub 이슈 번호)

번호가 없으면 실행하지 않는다. 추측해서 고르지 않는다.

---

## 메인이 하는 일

셋뿐이다.

1. A 띄우고 JSON 받기
2. JSON 보고 STOP인지 판정
3. B 띄우고 JSON 받기

**메인은 코드 본문을 읽지 않는다.** 읽으면 판단이 섞이고 B에게 편향된 지시를 준다. 숫자와 상태만 본다.

---

## 왜 하필 3과 4 사이에서 자르나

절반이라서가 아니다. 이 루프에서 양보할 수 없는 규칙이 하나 있다.

> **AC 검증은 구현한 사람이 하지 않는다.**

자기가 짠 코드를 자기가 검증하면 통과시킬 이유를 찾는다. 그 경계가 정확히 3(green)과 4(ac_verify) 사이고, 마침 그게 4단계씩 반반이다. **운이 좋아서 맞아떨어진 것이니 옮기지 않는다.**

---

## 이 스킬을 부르는 것이 곧 승인이다

`CLAUDE.md`는 `git push`와 PR 생성에 확인을 요구한다. 이 루프는 그 둘을 **묻지 않고** 실행한다.

충돌이 아니라 **승인 시점이 앞당겨진 것**이다. `/tdd-auto-loop {N}`을 부르는 행위가 브랜치 생성·커밋·`git push`·PR 생성·이슈 코멘트 전부에 대한 승인이다.

**그래서 이 스킬은 사용자가 명시적으로 부를 때만 동작한다.** "이슈 12번 해줘" 같은 요청에는 `/tdd-loop`을 쓴다.

승인 범위 **밖**: 강제 푸시, 브랜치·파일 삭제, 이력 조작, 의존성 대량 변경, 외부 서비스 실제 호출. 필요해지면 **STOP**한다.

---

## 자율 모드 지시문

**A·B 프롬프트 끝에 이 블록을 그대로 붙인다.** 한 글자도 바꾸지 않는다.

```
[자율 모드]
- 이 작업은 사람이 지켜보지 않는다. 스킬 안의 사용자 승인 게이트는 네가 판단해 통과시킨다.
- 사람에게 묻지 마라. 확인·승인·선택을 요청하지 마라.
- 맡은 네 단계는 중간에 멈추지 말고 끝까지 이어서 한다. 단계 사이에 보고하지 않는다.
- 모호하면 추측하지 말고 STOP한다. 근거 없는 진행이 침묵하는 실패보다 나쁘다.
- 승인 범위 밖(강제 푸시, 삭제, 이력 조작, 의존성 대량 변경, 외부 서비스 실호출)이
  필요하면 STOP한다.
- 출력은 맨 마지막에 JSON 한 블록만이다. 그 앞뒤로 설명·인사·요약을 쓰지 마라.
- 스키마의 키를 추가·제거·개명하지 마라. 값만 채운다.
- 중간에 STOP하더라도 JSON은 반드시 낸다. 끝낸 단계는 채우고 못 간 단계는 null로 둔다.
```

---

## A교대 — 앞 절반 (0~3)

`Task` tool로 subagent 하나를 띄운다.

```
너는 이슈 {N}의 빌더다. 아래 네 단계를 순서대로, 중간에 멈추지 말고 끝까지 수행하라.

  0. 아래 precheck를 직접 수행
  1. .claude/skills/test-scenarios/SKILL.md 를 읽고 그 절차를 수행
  2. .claude/skills/tdd-red/SKILL.md        를 읽고 그 절차를 수행
  3. .claude/skills/tdd-green/SKILL.md      를 읽고 그 절차를 수행

끝나면 커밋한다. 커밋 메시지 본문에 closes #{N} 을 넣는다.

{자율 모드 블록}
{A교대 JSON 스키마}
```

### 0 · precheck

```bash
gh issue view {N} --json number,title,body,labels,state
git status --porcelain
docker info > /dev/null 2>&1
```

| 확인                        | STOP 조건                                                              |
| --------------------------- | ---------------------------------------------------------------------- |
| 이슈에 AC 체크박스가 있는가 | 0개면 STOP (`no_ac`)                                                   |
| `git status`가 깨끗한가     | 변경이 남아 있으면 STOP (`dirty_worktree`)                             |
| 선행 이슈가 닫혔는가        | 열려 있으면 STOP (`blocked_by_open_issue`)                             |
| 대상 브랜치가 이미 있는가   | 있으면 STOP (`branch_exists`) — 자율 모드에서 덮어쓸지 판단하지 않는다 |
| Docker가 켜져 있는가        | 꺼져 있으면 STOP (`docker_off`) — 테스트가 중간에 죽는다               |
| `gh` 인증이 되어 있는가     | 안 되어 있으면 STOP (`gh_unauthenticated`)                             |

통과하면 브랜치를 만든다. 도메인은 이슈 라벨에서 가져오고, base는 `main`이다.

```bash
git switch -c feat/{domain}/issue-{N}
```

### 1~3 진행 중 스스로 확인할 것

사람에게 묻지 않되, 어긋나면 STOP한다. **승인 게이트가 아니라 사실 확인이다.**

| 경계  | 확인                            | 어긋나면                    |
| ----- | ------------------------------- | --------------------------- |
| 1 → 2 | 시나리오가 AC를 전부 덮었는가   | STOP `ac_not_covered`       |
| 2 → 3 | 수집된 테스트 수 == 시나리오 수 | STOP `collect_mismatch`     |
| 2 → 3 | **통과한 테스트가 0개인가**     | STOP `red_has_passing_test` |

마지막 조건이 가장 중요하다. **구현이 없는데 통과했다는 건 그 테스트가 가짜라는 뜻이다.** 여기서 넘어가면 이후 전부가 무의미하다. 통과한 테스트가 있으면 그걸 고쳐서 실패시키는 게 아니라 **STOP한다** — 무엇이 가짜인지는 사람이 봐야 한다.

green이 실패하면 **A교대 안에서 최대 3회** 재시도한다. 메인에게 돌아오지 않는다.

### A교대 반환 JSON

```json
{
  "phase": "A",
  "status": "OK",
  "reason": null,
  "stopped_at": null,
  "issue": 1,
  "domain": "auth-member",
  "branch": "feat/auth-member/issue-1",
  "commit": "e4f5g6h",
  "ac_total": 5,
  "scenario_file": "docs/result/scenarios/issue-1.md",
  "scenario_count": 28,
  "ac_uncovered": [],
  "tests_total": 28,
  "tests_passed": 28,
  "tests_failed": 0,
  "red_tests_passed": 0,
  "coverage_pct": 100,
  "files_changed": ["apps/api/src/auth/email-verification.service.ts"]
}
```

`status`는 `OK` 또는 `STOP`. STOP이면 `stopped_at`에 `precheck` · `scenarios` · `red` · `green` 중 하나를 넣는다.

`red_tests_passed`는 **2단계에서 통과한 테스트 수**다. 0이 아니면 가짜 테스트다.

**메인의 STOP 판정:**

| 조건                            | 사유                   |
| ------------------------------- | ---------------------- |
| `status == "STOP"`              | 그 `reason` 그대로     |
| `ac_uncovered`가 비어 있지 않음 | `ac_not_covered`       |
| `red_tests_passed > 0`          | `red_has_passing_test` |
| `tests_total != scenario_count` | `collect_mismatch`     |
| `tests_failed > 0`              | `green_failed_3x`      |
| `commit`이 없음                 | `nothing_committed`    |

---

## 인수인계 — 딱 한 번

메인이 A의 JSON을 검사하고 통과하면 B를 띄운다. **A를 이어서 쓰지 않는다.** 새 subagent다.

넘기는 것은 **A의 JSON과 브랜치 이름뿐**이다. A가 쓴 설명·판단·변명은 넘기지 않는다. B는 코드를 직접 본다.

```
[handoff] A → B   branch feat/auth-member/issue-1 · commit e4f5g6h · tests 28/28
```

---

## B교대 — 뒤 절반 (4~7)

`Task` tool로 subagent 하나를 띄운다. **A와 다른 subagent다.**

```
너는 이슈 {N}의 마감자다. 다른 사람이 구현을 마치고 너에게 넘겼다.
아래 네 단계를 순서대로, 중간에 멈추지 말고 끝까지 수행하라.

  4. .claude/agents/ac-verifier.md           의 기준으로 AC 충족을 독립 검증
  5. .claude/skills/tdd-refactor/SKILL.md    를 읽고 그 절차를 수행
  6. .claude/skills/security-review/SKILL.md 를 읽고 그 절차를 수행
  7. .claude/skills/create-pr/SKILL.md       를 읽고 그 절차를 수행

브랜치: {branch}
빌더가 넘긴 것: {A교대 JSON}

{자율 모드 블록}
{B교대 JSON 스키마}
```

**넘겨받은 JSON의 숫자를 믿지 마라. 코드를 직접 봐라.** 만든 사람이 아닌 네가 보는 것이 이 교대의 존재 이유다.

### 4 · AC 검증

`ac_passed == false`면 **STOP한다.** 갭을 자동으로 메우지 않는다.

테스트를 더 쓰라고 시키면 통과할 때까지 쓰게 되고, 그건 AC 충족이 아니라 통과 조작이다. "여기가 빈다"고 말해주는 것이 이 단계의 전부다.

### 5 · 리팩토링

안 해도 되는 작업이다. **판단이 서지 않으면 `changes: []`로 그냥 넘어가는 것이 정답이다.** 넘겨받은 코드라 구조가 눈에 덜 들어오는 것은 자연스럽다.

롤백 후에도 테스트가 깨져 있으면 STOP `refactor_broke_tests`.

### 6 · 보안

`blocking`에 들어가는 것: 타입 오류, 코드에 박힌 비밀값, 시크릿에 `NEXT_PUBLIC_`, **운영 코드 경로의 critical·high 취약점**. 빌드·CLI 전용 취약점은 `ignored`다. 판정 기준은 `docs/result/security-exceptions.md`를 따른다.

### 7 · PR

PR 본문에 `Closes #{N}`을 반드시 포함한다. **E2E가 실패하면 E2E를 고쳐서 통과시키지 않는다.**

### B교대 반환 JSON

```json
{
  "phase": "B",
  "status": "OK",
  "reason": null,
  "stopped_at": null,
  "ac_passed": true,
  "ac_results": [
    {
      "ac": 1,
      "verdict": "PASS",
      "evidence": "apps/api/src/auth/email-verification.service.test.ts:102"
    }
  ],
  "ac_gaps": [],
  "refactor_changes": [
    {
      "file": "apps/api/src/auth/email-verification.service.ts",
      "criterion": "매직 넘버",
      "summary": "1시간을 HOUR_MS 상수로"
    }
  ],
  "rolled_back": [],
  "tests_passed": 28,
  "tests_failed": 0,
  "typecheck_errors": 0,
  "blocking": [],
  "recommended": [
    { "item": "console.log에 이메일", "file": "apps/api/src/auth/x.ts:42" }
  ],
  "ignored": [
    { "item": "deepmerge-ts<8", "reason": "빌드·CLI 전용. 예외 대장 등재" }
  ],
  "pr_url": "https://github.com/kimgyuhyun/fixer/pull/40",
  "commitlint": "pass",
  "e2e": "skipped_not_configured"
}
```

`verdict`는 `PASS` · `PARTIAL` · `FAIL` 셋 중 하나. `ac_passed`는 전부 `PASS`일 때만 `true`.
`e2e`는 `passed` · `failed` · `skipped_not_configured` 셋 중 하나.

`status`가 STOP이면 `stopped_at`에 `ac_verify` · `refactor` · `security` · `pr` 중 하나를 넣는다.

**메인의 STOP 판정:**

| 조건                        | 사유                   |
| --------------------------- | ---------------------- |
| `status == "STOP"`          | 그 `reason` 그대로     |
| `ac_passed == false`        | `ac_gap`               |
| `tests_failed > 0`          | `refactor_broke_tests` |
| `blocking`이 비어 있지 않음 | `security_blocking`    |
| `commitlint != "pass"`      | `commitlint_failed`    |
| `e2e == "failed"`           | `e2e_failed`           |
| `pr_url`이 없음             | `push_failed`          |

---

## 스키마 위반 처리

교대가 스키마를 어긴 JSON이나 JSON이 아닌 것을 반환하면, **작업을 다시 시키지 않는다.** 코드와 커밋은 이미 나와 있고, 없는 것은 보고서뿐이다.

`SendMessage`로 **같은 교대에게 이어서** JSON만 다시 요청한다. 무엇이 어긋났는지를 담는다 — "다시 해라"만으로는 같은 것이 반복된다.

```
JSON 스키마를 어겼다. 어긋난 곳: {구체적으로}.
작업은 다시 하지 마라. 이미 한 일의 결과를 스키마대로 JSON 한 블록으로만 다시 내라.
```

**1회 요청 후에도 어긋나면 STOP** (`schema_violation`). 교대를 처음부터 다시 돌리지 않는다 — 이미 만들어진 커밋 위에 같은 작업이 겹친다.

---

## 진행 표시

세 줄이다. 그 외 출력을 하지 않는다.

```
[A] OK  시나리오 28 · 테스트 28/28 · 커밋 e4f5g6h
[handoff] A → B
[B] STOP(ac_gap)
```

형식: `[A] OK` 또는 `[A] STOP({사유})`. **인수인계가 한 번뿐이라 중간이 안 보이므로**, 교대가 끝날 때 요약 숫자는 뒤에 붙인다.

---

## STOP 처리

**사람에게 묻지 않는다.** 순서대로 셋을 하고 끝낸다.

**1. 메인 로그에 STOP 리포트**

```
❌ STOP — [B] ac_gap

  이슈: #1 이메일로 인증 코드를 받고 검증한다
  브랜치: feat/auth-member/issue-1

  A: 완료 (시나리오 28 · 테스트 28/28 · 커밋 e4f5g6h)
  B: ac_verify에서 중단

  갭:
    AC 4 — PARTIAL: 쿨다운 경계(정확히 60초) 테스트 없음
    AC 5 — FAIL: 시간당 5회 제한을 검증하는 테스트 없음

  다음: 시나리오를 보강하고 /tdd-loop 1 로 다시
```

**어느 교대에서 멈췄는지를 반드시 적는다.** A에서 멈추면 만들다 만 것이고, B에서 멈추면 만들어진 것에 문제가 있다는 뜻이다. 사람이 할 일이 다르다.

**2. 이슈에 코멘트**

```bash
gh issue comment {N} --body-file {리포트파일}
```

작업 흔적이 이슈에 남아야, 다음 사람이 브랜치만 보고 "이게 왜 여기서 멈췄지"를 되짚지 않는다.

**3. 종료**

**브랜치와 커밋은 그대로 둔다.** 되돌리지 않는다 — 사람이 이어서 하거나 버릴지 판단할 몫이다.

---

## STOP 사유 목록

| 사유                    | 교대 | 뜻                                               |
| ----------------------- | ---- | ------------------------------------------------ |
| `no_ac`                 | A    | 이슈에 AC가 없다                                 |
| `dirty_worktree`        | A    | 커밋되지 않은 변경이 있다                        |
| `blocked_by_open_issue` | A    | 선행 이슈가 열려 있다                            |
| `branch_exists`         | A    | 대상 브랜치가 이미 있다                          |
| `docker_off`            | A    | Docker Desktop이 꺼져 있다                       |
| `gh_unauthenticated`    | A    | `gh` 로그인이 안 되어 있다                       |
| `ac_not_covered`        | A    | 시나리오가 AC를 다 덮지 못한다                   |
| `red_has_passing_test`  | A    | 구현이 없는데 통과한 테스트가 있다 (가짜 테스트) |
| `collect_mismatch`      | A    | 테스트 수와 시나리오 수가 다르다                 |
| `green_failed_3x`       | A    | 3회 시도에도 통과하지 못했다                     |
| `nothing_committed`     | A    | 커밋을 남기지 않았다                             |
| `ac_gap`                | B    | AC 충족이 확인되지 않았다                        |
| `refactor_broke_tests`  | B    | 롤백 후에도 테스트가 깨져 있다                   |
| `security_blocking`     | B    | 즉시 수정이 필요한 항목이 있다                   |
| `commitlint_failed`     | B    | 커밋 메시지가 규칙을 어긴다                      |
| `e2e_failed`            | B    | E2E가 실패했다                                   |
| `push_failed`           | B    | push가 거부됐다                                  |
| `schema_violation`      | A·B  | 교대가 스키마를 어겼다 (복구 요청 후에도)        |

---

## 완주 리포트

둘 다 통과하면 JSON 둘을 모아 한 번 출력한다.

```
✅ 완주 — 이슈 #1

  브랜치: feat/auth-member/issue-1 → main
  PR: https://github.com/kimgyuhyun/fixer/pull/40

  A  시나리오 28 · 테스트 28/28 · 커버리지 100%
  B  AC 5/5 PASS · 리팩토링 1건 · 보안 blocking 0 (recommended 1)
     E2E: 미설정으로 건너뜀

  ⚠️ 사람이 확인할 것
    - security recommended 1건 (console.log에 이메일)
    - E2E가 돌지 않았음
```

**`⚠️` 항목을 반드시 낸다.** 자율 실행은 "아무 문제 없었다"가 아니라 "STOP 조건에 안 걸렸다"는 뜻이다. 사람이 나중에 볼 것을 남기지 않으면 자율 모드가 판단을 대신한 것처럼 보인다.

---

## 언제 쓰지 않나

| 상황                     | 대신                                                    |
| ------------------------ | ------------------------------------------------------- |
| 처음 해보는 도메인       | `/tdd-loop` — 게이트에서 방향을 잡을 수 있다            |
| ADR이 아직 TODO인 도메인 | 먼저 ADR을 확정한다. 자율 모드는 구조를 결정하지 못한다 |
| 이슈 AC가 부실하다       | AC부터 보강한다. A의 precheck에서 어차피 STOP된다       |
| 여러 이슈를 연달아       | 하나씩. 실패 지점이 흐려진다                            |

**자율 루프는 길이 잘 닦인 이슈에 쓴다.** 반반으로 나눈 대가로 **중간 관측점이 하나뿐**이다. 잘 닦인 이슈면 이득이지만, 흔들리는 이슈에서는 A가 네 단계를 잘못된 방향으로 완주한 뒤에야 알게 된다. 그럴 것 같으면 `/tdd-loop`을 쓴다.
