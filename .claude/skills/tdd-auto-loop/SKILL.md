---
name: tdd-auto-loop
description: 이슈 하나를 TDD 7단계로 사람에게 묻지 않고 끝까지 완주하는 자율 루프. 각 단계를 격리된 subagent로 띄우고 정해진 JSON만 받아 다음으로 넘긴다. 메인은 코드 본문을 직접 보지 않으며, AC 검증은 Green과 반드시 다른 agent가 한다. STOP 조건에 걸리면 사람에게 묻지 않고 이슈에 코멘트를 남기고 종료한다. 사용자가 "/tdd-auto-loop 12", "12번 자동으로 끝까지", "오토루프 돌려줘", "알아서 완주해줘", "무인으로 진행"이라고 할 때만 사용한다. 확인을 받으며 진행하고 싶으면 /tdd-loop을 쓴다.
---

# TDD 자율 루프

사람의 개입 없이 이슈 하나를 끝까지 완주한다.

```
/tdd-auto-loop {N}
  0 precheck   → 1 scenarios → 2 red → 3 green
  → 4 ac_verify → 5 refactor → 6 security → 7 pr
```

**사용법:** `/tdd-auto-loop 12` (GitHub 이슈 번호)

번호가 없으면 실행하지 않는다. 추측해서 고르지 않는다.

---

## 이 스킬을 부르는 것이 곧 승인이다

`CLAUDE.md`는 `git push`와 PR 생성에 확인을 요구한다. 이 루프는 그 둘을 **묻지 않고** 실행한다.

충돌이 아니라 **승인 시점이 앞당겨진 것**이다. `/tdd-auto-loop {N}`을 부르는 행위가 다음 전부에 대한 승인이다.

- 브랜치 생성과 커밋
- `git push`
- PR 생성, 이슈 코멘트

**그래서 이 스킬은 사용자가 명시적으로 부를 때만 동작한다.** "이슈 12번 해줘" 같은 요청에는 `/tdd-loop`을 쓴다. 자율 실행은 사용자가 그 단어를 직접 꺼냈을 때만이다.

승인 범위 **밖**인 것: 강제 푸시, 브랜치·파일 삭제, 이력 조작, 의존성 대량 변경, 외부 서비스 실제 호출. 이런 것이 필요해지면 **STOP**한다.

---

## 격리 원칙

| 원칙                                    | 이유                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------- |
| **메인은 코드 본문을 직접 읽지 않는다** | 메인이 코드를 보면 판단이 섞이고, 다음 단계 subagent에게 편향된 지시를 준다 |
| **각 단계는 별도 subagent**             | 앞 단계의 맥락이 새어들어가지 않는다                                        |
| **AC 검증은 Green과 반드시 다른 agent** | 자기가 짠 코드를 자기가 검증하면 통과시킬 이유를 찾는다                     |
| **subagent는 JSON만 반환**              | 메인이 자유 텍스트를 해석하기 시작하면 판정이 흔들린다                      |

메인이 하는 일은 셋뿐이다. **JSON 받기 → 스키마 검증 → 다음 단계 띄우기.**

---

## 자율 모드 지시문

**모든 subagent 프롬프트 끝에 이 블록을 그대로 붙인다.** 한 글자도 바꾸지 않는다.

```
[자율 모드]
- 이 작업은 사람이 지켜보지 않는다. 스킬 안의 사용자 승인 게이트는 네가 판단해 통과시킨다.
- 사람에게 묻지 마라. 확인·승인·선택을 요청하지 마라.
- 모호하면 추측하지 말고 STOP한다. 근거 없는 진행이 침묵하는 실패보다 나쁘다.
- 승인 범위 밖(강제 푸시, 삭제, 이력 조작, 의존성 대량 변경, 외부 서비스 실호출)이
  필요하면 STOP한다.
- 출력은 아래 JSON 한 블록만이다. 그 앞뒤로 설명·인사·요약을 쓰지 마라.
- 스키마의 키를 추가·제거·개명하지 마라. 값만 채운다.
```

---

## 0단계 · precheck

메인이 직접 수행한다. subagent를 쓰지 않는다 — 코드를 안 보고 환경만 확인하기 때문이다.

```bash
gh issue view {N} --json number,title,body,labels,state
git status --porcelain
git branch --show-current
docker info > /dev/null 2>&1
```

확인 항목과 STOP 조건:

| 확인                        | STOP 조건                                                              |
| --------------------------- | ---------------------------------------------------------------------- |
| 이슈에 AC 체크박스가 있는가 | 0개면 STOP (`no_ac`)                                                   |
| `git status`가 깨끗한가     | 변경이 남아 있으면 STOP (`dirty_worktree`)                             |
| 선행 이슈가 닫혔는가        | 열려 있으면 STOP (`blocked_by_open_issue`)                             |
| 대상 브랜치가 이미 있는가   | 있으면 STOP (`branch_exists`) — 자율 모드에서 덮어쓸지 판단하지 않는다 |
| Docker가 켜져 있는가        | 꺼져 있으면 STOP (`docker_off`) — 3·5단계가 중간에 죽는다              |
| `gh` 인증이 되어 있는가     | 안 되어 있으면 STOP (`gh_unauthenticated`)                             |

통과하면 브랜치를 만든다. 도메인은 이슈 라벨에서 가져온다.

```bash
git switch -c feat/{domain}/issue-{N}
```

base는 `main`이다. 선행 이슈가 닫혔으므로 그 결과물은 이미 `main`에 있다.

```json
{
  "stage": "precheck",
  "status": "OK",
  "reason": null,
  "issue": 1,
  "domain": "auth-member",
  "branch": "feat/auth-member/issue-1",
  "base": "main",
  "ac_count": 5,
  "blocked_by": []
}
```

---

## 1~7단계 · subagent 실행

각 단계는 `Task` tool로 subagent를 띄운다. 프롬프트 구성은 항상 같다.

```
{스킬 경로}를 읽고 이슈 {N}에 대해 그 절차를 수행하라.
브랜치: {branch}
{자율 모드 블록}
{해당 단계의 JSON 스키마}
```

### 1 · scenarios — `/test-scenarios {N}`

내부 게이트 2개(시그니처·시나리오)를 subagent가 스스로 통과시킨다.

```json
{
  "stage": "scenarios",
  "status": "OK",
  "reason": null,
  "file": "docs/result/scenarios/issue-1.md",
  "scenario_count": 28,
  "ac_total": 5,
  "ac_covered": 5,
  "ac_uncovered": []
}
```

**STOP:** `ac_covered < ac_total` → `ac_not_covered`

### 2 · red — `/tdd-red {N}`

```json
{
  "stage": "red",
  "status": "OK",
  "reason": null,
  "test_files": ["apps/api/src/auth/email-verification.service.test.ts"],
  "stub_files": ["apps/api/src/auth/email-verification.service.ts"],
  "tests_total": 28,
  "tests_failed": 28,
  "tests_passed": 0
}
```

**STOP 조건 둘:**

- `tests_passed > 0` → `red_has_passing_test`. **구현이 없는데 통과했다는 건 그 테스트가 가짜라는 뜻이다.** 자율 모드에서 이걸 넘기면 이후 전부가 무의미해진다
- `tests_total != scenario_count` → `collect_mismatch`. 테스트가 수집되지 않았다

### 3 · green — `/tdd-green {N}`

**최대 3회 재시도.** 실패 JSON을 다음 시도의 입력으로 넘긴다.

```json
{
  "stage": "green",
  "status": "OK",
  "reason": null,
  "attempt": 1,
  "tests_total": 28,
  "tests_passed": 28,
  "tests_failed": 0,
  "coverage_pct": 100,
  "files_changed": ["apps/api/src/auth/email-verification.service.ts"]
}
```

**STOP:** 3회째도 `tests_failed > 0` → `green_failed_3x`

### 4 · ac_verify — `@ac-verifier {N}`

**반드시 3단계와 다른 subagent다.** Green을 수행한 agent를 재사용하지 않는다.

```json
{
  "stage": "ac_verify",
  "status": "OK",
  "reason": null,
  "ac_passed": true,
  "results": [
    {
      "ac": 1,
      "verdict": "PASS",
      "evidence": "apps/api/src/auth/email-verification.service.test.ts:102"
    }
  ],
  "gaps": []
}
```

`verdict`는 `PASS` · `PARTIAL` · `FAIL` 셋 중 하나다. `ac_passed`는 전부 `PASS`일 때만 `true`.

**STOP:** `ac_passed == false` → `ac_gap`

갭을 자동으로 메우지 않는다. **테스트를 더 쓰라고 시키면 통과할 때까지 쓰게 되고, 그건 AC 충족이 아니라 통과 조작이다.**

### 5 · refactor — `/tdd-refactor {N}`

```json
{
  "stage": "refactor",
  "status": "OK",
  "reason": null,
  "changes": [
    {
      "file": "apps/api/src/auth/email-verification.service.ts",
      "criterion": "매직 넘버",
      "summary": "1시간을 HOUR_MS 상수로"
    }
  ],
  "rolled_back": [],
  "tests_passed": 28,
  "tests_failed": 0
}
```

**STOP:** 롤백 후에도 `tests_failed > 0` → `refactor_broke_tests`

리팩토링은 안 해도 되는 작업이다. **판단이 서지 않으면 `changes: []`로 그냥 넘어가는 것이 정답이다.**

### 6 · security — `/security-review {N}`

```json
{
  "stage": "security",
  "status": "OK",
  "reason": null,
  "typecheck_errors": 0,
  "blocking": [],
  "recommended": [
    { "item": "console.log에 이메일", "file": "apps/api/src/auth/x.ts:42" }
  ],
  "ignored": [
    { "item": "deepmerge-ts<8", "reason": "빌드·CLI 전용. 예외 대장 등재" }
  ]
}
```

**STOP:** `blocking`이 비어 있지 않으면 → `security_blocking`

`blocking`에 들어가는 것: 타입 오류, 코드에 박힌 비밀값, 시크릿에 `NEXT_PUBLIC_`, **운영 코드 경로의 critical·high 취약점**.

빌드·CLI 전용 취약점은 `ignored`다. 판정 기준은 `docs/result/security-exceptions.md`를 따른다.

### 7 · pr — `/create-pr`

```json
{
  "stage": "pr",
  "status": "OK",
  "reason": null,
  "pr_url": "https://github.com/kimgyuhyun/fixer/pull/40",
  "base": "main",
  "closes": 1,
  "commitlint": "pass",
  "e2e": "skipped_not_configured"
}
```

`e2e`는 `passed` · `failed` · `skipped_not_configured` 셋 중 하나다.

**STOP 조건:**

- `commitlint != "pass"` → `commitlint_failed`
- `e2e == "failed"` → `e2e_failed`. **E2E를 고쳐서 통과시키지 않는다**
- push 실패 → `push_failed`

PR 본문에 `Closes #{N}`을 반드시 포함한다.

---

## 스키마 위반 처리

subagent가 **스키마를 어긴 JSON**이나 JSON이 아닌 것을 반환하면:

| 단계       | 처리                                        |
| ---------- | ------------------------------------------- |
| green      | 재시도 횟수에 포함 (최대 3회)               |
| 그 외 전부 | **1회 재시도 후 STOP** (`schema_violation`) |

재시도 프롬프트에는 **무엇이 어긋났는지**를 담는다. "다시 해라"만으로는 같은 것이 반복된다.

---

## 진행 표시

한 단계당 **한 줄**이다. 그 외 출력을 하지 않는다.

```
[precheck] OK
[scenarios] OK
[red] OK
[green] OK
[ac_verify] STOP(ac_gap)
```

형식: `[단계명] OK` 또는 `[단계명] STOP({사유})`

---

## STOP 처리

**사람에게 묻지 않는다.** 순서대로 셋을 하고 루프를 끝낸다.

**1. 메인 로그에 STOP 리포트를 남긴다**

```
❌ STOP — [ac_verify] ac_gap

  이슈: #1 이메일로 인증 코드를 받고 검증한다
  브랜치: feat/auth-member/issue-1
  완료: precheck, scenarios, red, green
  중단: ac_verify

  갭:
    AC 4 — PARTIAL: 쿨다운 경계(정확히 60초) 테스트 없음
    AC 5 — FAIL: 시간당 5회 제한을 검증하는 테스트 없음

  다음: 시나리오를 보강하고 /tdd-loop 1 로 다시
```

**2. 이슈에 코멘트를 남긴다**

```bash
gh issue comment {N} --body-file {리포트파일}
```

작업 흔적이 이슈에 남아야, 다음 사람이 브랜치만 보고 "이게 왜 여기서 멈췄지"를 되짚지 않는다.

**3. 루프를 종료한다**

**브랜치와 커밋은 그대로 둔다.** 되돌리지 않는다 — 사람이 이어서 하거나 버릴지 판단할 몫이다.

---

## STOP 사유 목록

| 사유                    | 단계 | 뜻                                               |
| ----------------------- | ---- | ------------------------------------------------ |
| `no_ac`                 | 0    | 이슈에 AC가 없다                                 |
| `dirty_worktree`        | 0    | 커밋되지 않은 변경이 있다                        |
| `blocked_by_open_issue` | 0    | 선행 이슈가 열려 있다                            |
| `branch_exists`         | 0    | 대상 브랜치가 이미 있다                          |
| `docker_off`            | 0    | Docker Desktop이 꺼져 있다                       |
| `gh_unauthenticated`    | 0    | `gh` 로그인이 안 되어 있다                       |
| `ac_not_covered`        | 1    | 시나리오가 AC를 다 덮지 못한다                   |
| `red_has_passing_test`  | 2    | 구현이 없는데 통과한 테스트가 있다 (가짜 테스트) |
| `collect_mismatch`      | 2    | 테스트 수와 시나리오 수가 다르다                 |
| `green_failed_3x`       | 3    | 3회 시도에도 통과하지 못했다                     |
| `ac_gap`                | 4    | AC 충족이 확인되지 않았다                        |
| `refactor_broke_tests`  | 5    | 롤백 후에도 테스트가 깨져 있다                   |
| `security_blocking`     | 6    | 즉시 수정이 필요한 항목이 있다                   |
| `commitlint_failed`     | 7    | 커밋 메시지가 규칙을 어긴다                      |
| `e2e_failed`            | 7    | E2E가 실패했다                                   |
| `push_failed`           | 7    | push가 거부됐다                                  |
| `schema_violation`      | 1~7  | subagent가 스키마를 어겼다                       |

---

## 완주 리포트

7단계를 다 통과하면 각 단계의 JSON을 모아 한 번 출력한다.

```
✅ 완주 — 이슈 #1

  브랜치: feat/auth-member/issue-1 → main
  PR: https://github.com/kimgyuhyun/fixer/pull/40

  시나리오 28 · 테스트 28/28 · 커버리지 100%
  AC 5/5 PASS
  리팩토링 1건 · 보안 blocking 0 (recommended 1)
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
| 이슈 AC가 부실하다       | AC부터 보강한다. 0단계에서 어차피 STOP된다              |
| 여러 이슈를 연달아       | 하나씩. 실패 지점이 흐려진다                            |

**자율 루프는 길이 잘 닦인 이슈에 쓴다.** 판단이 필요한 이슈에 쓰면 STOP만 반복하고, 그 STOP을 읽는 시간이 직접 하는 시간보다 길어진다.
