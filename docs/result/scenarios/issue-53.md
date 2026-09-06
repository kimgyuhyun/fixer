# 이슈 #53 — 공고 잠금액 합산이 PAYOUT 행까지 세고 있다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/53
> PRD: `docs/result/prd/point-money.md`
> 담당: B-김규현
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 시그니처

### 관련 ADR

| 결정                                     | 이 이슈에 미치는 영향                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ADR-PAY-1` 잔액은 원장에서 계산한다     | 잠금 잔여도 예산 컬럼이 아니라 **원장 합산**으로 구한다. 캐시(`User.cachedBalance`)를 보지 않는다                                   |
| `ADR-PAY-7` lot 잔여를 원장에서 계산한다 | 같은 판단. #15가 예산을 고친 공고는 예산과 실제 잠금이 다르므로 예산에서 역산하지 않는다                                            |
| `#### PAYOUT은 구직자 + 행만 쓴다 (#23)` | **이 이슈의 핵심 근거.** 구인자의 `−` 행이 없으므로 지급분은 `HOLD`가 만든 잠금 풀에서 직접 빠져나간다 — `PAYOUT`은 잠금의 유출이다 |
| `ADR-PAY-2` 조건부 UPDATE로 막는다       | 호출부가 자기 트랜잭션 안에서 이 값을 읽어야 하므로 함수가 `tx`를 받는다                                                            |

### 결정 — 4안 (이슈 본문의 1·2·3안을 모두 기각)

**"공고 잠금 잔여"를 `잠금 흐름 유형(HOLD·RELEASE·PAYOUT)의 합`으로 정의하고, 그 정의를 함수 하나에 박는다.**

이슈가 제시한 1안(`type in (HOLD, RELEASE)`)과 2안(`userId = employerId`)은 **지금 식보다 더 틀린다.**
`point-money.md` §3의 채택안(충전 60,000 / 정원 6 / 보상 10,000 / 확정 3명) 기준, 완료 확인 **뒤** 원장은
`HOLD −60000` · `PAYOUT +10000 ×3` · `RELEASE +30000`이다.

| 식                              | 결과       | 판정                                      |
| ------------------------------- | ---------- | ----------------------------------------- |
| 지금 (`referenceId`만)          | **0**      | ✅ 잠긴 것이 없다 — 값 자체는 맞다        |
| 1안 `type in (HOLD, RELEASE)`   | **30,000** | ❌ 이미 나간 돈을 잠겼다고 보고한다       |
| 2안 `userId = employerId`       | **30,000** | ❌ 동일 (`PAYOUT`이 구직자 행이라 빠진다) |
| **4안 `type in 잠금 흐름 3종`** | **0**      | ✅ 오늘 숫자는 그대로, 정의가 식에 남는다 |

같은 절의 검산 열이 **전체 합 0 ✅**인 것이 이 판정의 근거다.

**따라서 결함은 숫자가 아니라 정의가 어디에도 안 적혀 있다는 것이다.** 4안이 바꾸는 것은 둘이다.

1. 같은 식이 두 파일에 복사돼 있던 것을 **함수 하나**로 모은다 (#24가 세 번째 사본을 만들지 못하게)
2. 잠금과 무관한 유형(`CHARGE`·`REFUND`·`EXCHANGE_*`, PRD가 예고한 `REJECT`)이 같은 `referenceId`를 달고
   들어와도 세지 않는다. 새 유형이 잠금 흐름이면 **목록에 넣는 판단을 하게 만드는 것**이 목적이다

### 타입

```typescript
// apps/api/src/point/job-post-lock.ts  (새 파일)
import type { Prisma } from '../generated/prisma/client';

/**
 * 공고 잠금에 드나드는 원장 유형.
 * HOLD가 넣고, RELEASE(구인자에게)와 PAYOUT(구직자에게)이 뺀다.
 */
export const LOCK_FLOW_TYPES = ['HOLD', 'RELEASE', 'PAYOUT'] as const;

/**
 * 그 공고에 아직 잠겨 있는 금액.
 *
 * 예산에서 다시 계산하지 않는다 — #15가 예산을 고친 공고는 예산과 실제 잠금이
 * 다르다. 호출부의 트랜잭션 안에서 읽어야 하므로 `tx`를 받는다.
 */
export function lockedAmountFor(
  tx: Prisma.TransactionClient,
  jobPostId: string,
): Promise<number>;
```

호출부 둘은 이 함수만 부른다.

```typescript
// apps/api/src/job-post/prisma-job-post.store.ts:272  cancelAndRelease (#16)
const released = await lockedAmountFor(tx, input.jobPostId);

// apps/api/src/application/prisma-application.store.ts:165  completeAndSettle (#23)
const locked = await lockedAmountFor(tx, input.jobPostId);
```

### 에러 케이스

**없다.** 이 함수는 던지지 않는다.

| 상황                            | 반환              | 왜                                                                                                                                           |
| ------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 그 공고의 원장 행이 하나도 없다 | `0`               | 아직 잠근 적이 없는 공고다. 오류가 아니다                                                                                                    |
| 푼 돈이 잠근 돈보다 많다        | 음수를 **그대로** | 원장이 깨진 것이라 여기서 판정하지 않는다. `ADR-PAY-1`의 대조 배치(#39)가 잡는다. 호출부 둘 다 `> 0` 가드가 있어 음수여도 돈이 나가지 않는다 |

### 형태를 이렇게 고른 이유

| 항목 | 결정                               | 대안과 기각 이유                                                                                                                                   |
| ---- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 위치 | `apps/api/src/point/`              | 원장 의미가 사는 곳. `auth`가 이미 `point`를 import한다. `job-post`에 두면 `application`이 남의 도메인을 참조하게 된다                             |
| 형태 | 평범한 함수 (Nest 프로바이더 아님) | 호출부가 **자기 트랜잭션 안에서** 불러야 한다. 주입된 저장소는 `this.prisma`를 쓰므로 그 트랜잭션에 못 낀다. `holdKeyFor`·`transition`과 같은 모양 |
| 반환 | `Promise<number>`                  | `{ locked: number }`로 감쌀 이유가 없다. 호출부가 바로 숫자로 쓴다                                                                                 |

### 이 이슈에서 만들지 않는 것

| 항목                                  | 이유                                                  |
| ------------------------------------- | ----------------------------------------------------- |
| `apps/api/src/exchange/`              | 다른 세션이 #31로 작업 중이다. 건드리지 않는다        |
| #24 노쇼, #29 FIFO 소진               | 이 함수를 **쓸** 곳이지 여기서 만들지 않는다          |
| 원장·캐시 대조 배치 (#39)             | 음수 잠금을 판정하는 책임이 그쪽에 있다               |
| `PointTransaction`에 컬럼·인덱스 추가 | 스키마 변경 없이 끝난다. 마이그레이션을 만들지 않는다 |

### 코드 외 산출물

이슈가 "결정 자체가 이 이슈의 산출물"이라고 했다. 결정은 두 군데에 남긴다.

| 산출물                                                                         | 단계  |
| ------------------------------------------------------------------------------ | ----- |
| 이 문서의 **결정 — 4안** 절                                                    | 1단계 |
| `docs/result/prd/point-money.md`에 `#### 공고 잠금 잔여는 어떻게 구하나 (#53)` | 3단계 |

형제 결정인 `#### PAYOUT은 구직자 + 행만 쓴다 (#23)` 바로 뒤에 붙인다.

---

## 테스트 시나리오

전부 **통합 테스트**다. 원장 합산은 진짜 Postgres의 `aggregate`가 하는 일이라 가짜 저장소로는 아무것도 증명되지 않는다.

`lockedAmountFor`는 `PointTransaction` 행만 읽으므로 `JobPost` 행 없이도 검증된다 —
`referenceId`는 문자열일 뿐이다. 그래서 함수 자체의 시나리오는 `apps/api/src/point/`의
기존 컨테이너를 재사용한다.

### 정상

- [x] [정상] `lockedAmountFor` — should return the whole held budget when only the HOLD row exists
- [x] [정상] `lockedAmountFor` — should return the remainder when part of the hold was already released
- [x] [정상] `lockedAmountFor` — should return 0 for a settled post because PAYOUT rows also leave the lock
- [x] [정상] `completeAndSettle` — should leave the job post's locked amount at 0 after the completion is confirmed
- [x] [정상] `cancelAndRelease` — should leave the job post's locked amount at 0 after the cancellation

### 경계

- [x] [경계] `lockedAmountFor` — should return 0 when the job post has no ledger row at all
- [x] [경계] `lockedAmountFor` — should ignore a CHARGE row that carries the same referenceId
- [x] [경계] `lockedAmountFor` — should ignore rows that reference a different job post
- [x] [경계] `completeAndSettle` — should leave the locked amount at 0 when every seat was filled and no RELEASE row is written
- [x] [경계] `cancelAndRelease` — should release the same amount when a CHARGE row carries the same referenceId
- [x] [경계] `completeAndSettle` — should return the employer the same amount when a CHARGE row carries the same referenceId

### 예외

- [x] [예외] `lockedAmountFor` — should return the negative sum as-is instead of throwing when releases exceed holds

### 마지막 세 개가 왜 필요한가

`CHARGE` 행이 공고 id를 `referenceId`로 다는 일은 오늘 코드에 없다. 그런데도 넣는다.

**두 호출부가 정말 같은 함수를 쓰는지 증명할 수 있는 유일한 시나리오이기 때문이다.**
4안은 오늘 숫자를 바꾸지 않으므로, 한쪽이 예전 식을 그대로 두고 있어도 다른 모든
테스트는 통과한다. 잠금 흐름 밖의 행을 하나 섞었을 때만 둘이 갈린다.

---

## AC 대조

이슈 #53에는 AC 체크박스가 없다. 본문의 **"확인 방법"** 두 줄과 **"무엇을 하면 되나"** 의
`결정 자체가 이 이슈의 산출물`을 AC로 삼아 대조한다.

| AC (이슈 본문)                                                                                                 | 커버하는 시나리오                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 완료 확인 뒤 같은 공고의 잠금 합을 다시 구하면 **무엇이 나와야 하는지 정하고**, 그것을 통합 테스트로 못 박는다 | 정한 값은 **0**.<br>`[정상] lockedAmountFor — settled post ... 0`<br>`[정상] completeAndSettle — locked amount at 0 after completion`<br>`[경계] completeAndSettle — 0 when every seat was filled`                      |
| `cancelAndRelease`와 `completeAndSettle`이 **같은 경로를 쓰는지** 확인한다                                     | `[경계] cancelAndRelease — same amount when a CHARGE row ...`<br>`[경계] completeAndSettle — same amount when a CHARGE row ...`<br>+ 구조 확인: `pointTransaction.aggregate`가 `apps/api/src` 전체에서 한 곳에만 남는다 |
| 어느 안으로 갈지 **결정 자체가 산출물**이다                                                                    | 테스트가 아닌 산출물. 이 문서의 **결정 — 4안** 절 + `point-money.md`의 `#### 공고 잠금 잔여는 어떻게 구하나 (#53)`                                                                                                      |

**AC에 없는데 추가한 시나리오** — 아래 넷은 "잠금 잔여"의 정의를 못 박기 위해 넣었다.
이슈가 정의를 정하라고 했으므로 범위 밖이 아니다.

- `[정상] lockedAmountFor — only the HOLD row` / `— part already released` (정의의 본체)
- `[경계] lockedAmountFor — no ledger row` / `— rows of a different job post` (합산 범위)
- `[예외] lockedAmountFor — negative sum as-is` (책임 경계: 원장 깨짐은 #39의 몫)

**커버리지:** AC 3개 / 시나리오 12개 / 미커버 0개
