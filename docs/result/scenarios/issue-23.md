# 이슈 #23 — 업무 완료를 확인하면 포인트가 지급된다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/23
> PRD: `docs/result/prd/application.md` · `docs/result/prd/point-money.md`
> 담당: B 김규현 · 선행 #18 #27
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 시그니처

### 관련 ADR

이 이슈가 **미결 ADR 두 개를 확정한다.** 확정문은 각 PRD에 적었다.

| ADR         | 결정                                                                    |
| ----------- | ----------------------------------------------------------------------- |
| `ADR-APP-5` | **구인자 확인.** 자동 완료도 양자 확인도 아니다                         |
| `ADR-PAY-4` | **한 트랜잭션.** 구인자의 `−`는 `HOLD`가 이미 실현했으므로 다시 안 쓴다 |

그리고 기존 결정 둘을 그대로 따른다.

- `ADR-PAY-2` — 조건부 UPDATE 한 문장. 별도 잠금을 쓰지 않는다
- `ADR-PAY-3` — 멱등은 DB 유니크 제약이 최후 방어선이다

### 판단 1 · `OPEN`에서도 완료 확인이 된다

`JOB_POST_TRANSITIONS`에 `{ from: 'OPEN', to: 'COMPLETED' }`를 더한다.

AC1이 요구하는 **확정 인원 3명·정원 6명 공고는 `CLOSED`가 될 수 없다.** #38이
"인원이 찼으면 `CLOSED`, 미달이면 `EXPIRED`"로 정해뒀고, 그 #38조차 아직 없어
`OPEN`을 `CLOSED`로 옮기는 코드가 저장소에 하나도 없다. `CLOSED`만 허용하면
**일을 마친 3명이 돈을 못 받는다.**

### 판단 2 · `PAYOUT`은 구직자 `+` 행만 쓴다

`spec-fixed.md` §6.1 표는 `PAYOUT: −(구인자) / +(구직자)`지만, **`HOLD` 시점에
이미 구인자 잔액에서 빠져나갔다.** 충전 60,000 / 정원 6 / 보상 10,000 / 확정
3명으로 세 안을 계산하면 이렇다.

| 안                      | 원장                                                                 | 구인자 최종 | 전체 합    |
| ----------------------- | -------------------------------------------------------------------- | ----------- | ---------- |
| **구직자 `+`만 (채택)** | `HOLD −60000` · `RELEASE +30000` · 구직자 `PAYOUT +10000 ×3`         | 30,000 ✅   | 0 ✅       |
| §6.1 문구 그대로        | 위 + 구인자 `PAYOUT −30000`                                          | 0 ❌        | −30,000 ❌ |
| 전액 반환 후 지급       | `HOLD −60000` · `RELEASE +60000` · 구인자 `−30000` · 구직자 `+30000` | 30,000 ✅   | 0 ✅       |

두 번째는 **돈이 사라진다.** 세 번째는 맞지만 AC1의 "3명분은 `RELEASE`"와
어긋난다 — 6명분이 `RELEASE`된다. 채택안은 §6.2의 "확정 인원분만 `PAYOUT`,
나머지는 `RELEASE`"와 문장이 같다.

### 타입

```typescript
// packages/shared/src/job-post.ts
JOB_POST_TRANSITIONS += { from: 'OPEN', to: 'COMPLETED' };
```

```typescript
// packages/shared/src/application.ts
export const completeJobPostRequestSchema = z.object({
  jobPostId: z.string().min(1, { error: '공고를 알 수 없습니다.' }),
  employerId: z.string().min(1, { error: '구인자를 알 수 없습니다.' }),
});
export type CompleteJobPostRequest = z.infer<
  typeof completeJobPostRequestSchema
>;

/** 완료 확인 결과. 화면이 "3명에게 30,000P 지급, 30,000P 반환"을 그린다 */
export const completionSummarySchema = z.object({
  jobPostId: z.string(),
  status: z.literal('COMPLETED'),
  paidCount: z.number().int().nonnegative(),
  paidTotal: z.number().int().nonnegative(),
  releasedTotal: z.number().int().nonnegative(),
});
export type CompletionSummary = z.infer<typeof completionSummarySchema>;
```

```typescript
// apps/api/src/application/application.service.ts
class ApplicationService {
  /** 구인자가 업무 완료를 확인한다. 확정 인원분 PAYOUT, 나머지 RELEASE (#23) */
  complete(input: CompleteJobPostRequest): Promise<CompletionSummary>;
}

interface ApplicationStore {
  /**
   * 완료 확인을 **한 트랜잭션으로** 확정한다 (ADR-PAY-4).
   *
   * 1. `JobPost SET COMPLETED WHERE id=? AND status=?`  → 0행이면 'STALE'
   * 2. `Application SET COMPLETED WHERE jobPostId=? AND status='ACCEPTED'`
   * 3. 확정 인원마다 구직자 `PAYOUT +rewardPerPerson`
   * 4. 남은 잠금액을 구인자에게 `RELEASE`
   *
   * 반환 잠금액은 예산을 다시 계산하지 않고 **그 공고를 참조하는 원장 행의 합**을
   * 쓴다 — #15가 예산을 고친 공고는 예산과 실제 잠금이 다르다
   * (`cancelAndRelease`와 같은 판단).
   */
  completeAndSettle(input: {
    jobPostId: string;
    employerId: string;
    expectedStatus: JobPostStatus;
    rewardPerPerson: number;
  }): Promise<SettlementResult | 'STALE'>;
}

/** 완료 확인이 실제로 옮긴 돈 */
interface SettlementResult {
  paidCount: number;
  paidTotal: number;
  releasedTotal: number;
}
```

### 멱등 키

`ADR-PAY-3` — 조건부 UPDATE가 1차 방어, DB 유니크 제약이 최후 방어선이다.

| 행               | 키                             |
| ---------------- | ------------------------------ |
| 구직자 `PAYOUT`  | `payout:{applicationId}`       |
| 구인자 `RELEASE` | `complete-release:{jobPostId}` |

### 에러 케이스

**새 에러 코드를 만들지 않는다.** AC에 없는 에러는 테스트로 검증되지 않는다.

| 상황                            | 에러 코드                     | HTTP |
| ------------------------------- | ----------------------------- | ---- |
| 공고 없음 (소프트 삭제 포함)    | `JOB_POST_NOT_FOUND`          | 404  |
| 그 공고 구인자가 아님           | `APPLICATION_NOT_EMPLOYER`    | 403  |
| 이미 `COMPLETED`·`CANCELLED` 등 | `JOB_POST_INVALID_TRANSITION` | 409  |

### 컴포넌트 Props

`ApplicantList`에 버튼 하나만 더한다. Props는 그대로다.

```typescript
// 조건: 공고가 완료 확인 가능한 상태일 때만 그린다
<button type="button" onClick={complete}>완료 확인</button>
```

### 이 이슈에서 만들지 않는 것

| 항목                      | 어디서                                                  |
| ------------------------- | ------------------------------------------------------- |
| 노쇼 인원 제외            | **#24.** "노쇼 처리된 인원분은 `RELEASE`"가 #24의 AC2다 |
| `EXPIRED → COMPLETED`     | #38이 `EXPIRED`를 만든 뒤                               |
| `OPEN → CLOSED` 자동 마감 | #38                                                     |
| 완료 알림                 | #36 배선은 있으나 이 이슈 AC에 없다                     |
| 환전 가능 7일 카운트      | #31                                                     |

---

## 테스트 시나리오

### 정상

- [ ] [정상] `complete` — should pay each accepted worker the reward per person when 3 of 6 are accepted
- [ ] [정상] `complete` — should release the 3 unmatched slots to the employer when 3 of 6 are accepted
- [ ] [정상] `complete` — should move the job post to COMPLETED
- [ ] [정상] `complete` — should move every ACCEPTED application to COMPLETED
- [ ] [정상] `complete` — should report paidCount 3, paidTotal 30000 and releasedTotal 30000
- [ ] [정상] `ApplicantList` — should show the 완료 확인 button to the employer
- [ ] [정상] `ApplicantList` — should reload the list after the completion succeeds

### 경계

- [ ] [경계] `complete` — should release the whole hold and pay nobody when no one was accepted
- [ ] [경계] `complete` — should release nothing when every seat is filled
- [ ] [경계] `complete` — should not pay an applicant who is still APPLIED
- [ ] [경계] `complete` — should release the locked sum from the ledger, not headcount times reward, when the budget was edited
- [ ] [경계] `complete` — should keep the total of every ledger row it wrote at zero

### 예외

- [ ] [예외] `complete` — should throw JOB_POST_NOT_FOUND when the post does not exist
- [ ] [예외] `complete` — should throw APPLICATION_NOT_EMPLOYER when someone else confirms
- [ ] [예외] `complete` — should throw JOB_POST_INVALID_TRANSITION when the post is already COMPLETED
- [ ] [예외] `complete` — should throw JOB_POST_INVALID_TRANSITION when the post was cancelled
- [ ] [예외] `complete` — should write nothing when the status changed under it

### 통합 (Testcontainers)

- [ ] [통합] `completeAndSettle` — should increase each worker's balance by the reward per person
- [ ] [통합] `completeAndSettle` — should leave the worker balance unchanged before completion
- [ ] [통합] `completeAndSettle` — should leave the employer holding only the released amount
- [ ] [통합] `completeAndSettle` — should write nothing more when the same post is completed twice
- [ ] [통합] `completeAndSettle` — should let exactly one of two concurrent completions settle
- [ ] [통합] `completeAndSettle` — should keep the cached balance equal to the ledger sum for employer and workers
- [ ] [통합] `completeAndSettle` — should leave the job post OPEN when the payout writes fail
- [ ] [통합] `complete` — should throw JOB_POST_NOT_FOUND when the post was soft deleted

---

## AC 대조

| #   | AC                                                      | 커버하는 시나리오                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 확정 3명·정원 6명 → 3명분 `PAYOUT`, 3명분 `RELEASE`     | `[정상] pay each accepted worker` · `[정상] release the 3 unmatched slots` · `[정상] report paidCount 3` · `[경계] release nothing when full` · `[경계] pay nobody when none accepted` · `[경계] not pay an APPLIED applicant` · **`[통합] leave the employer holding only the released amount`** |
| 2   | 완료 후 구직자 잔액이 보상금만큼 늘어 있다              | `[통합] increase each worker's balance` · `[통합] cached balance equals ledger sum`                                                                                                                                                                                                               |
| 3   | 완료 후 공고 상태가 `COMPLETED`다                       | `[정상] move the job post to COMPLETED` · `[정상] move every ACCEPTED application to COMPLETED`                                                                                                                                                                                                   |
| 4   | 이미 완료된 공고를 또 확인해도 지급이 두 번 되지 않는다 | `[예외] already COMPLETED` · `[예외] write nothing when the status changed` · `[통합] nothing more when completed twice` · `[통합] exactly one of two concurrent`                                                                                                                                 |
| 5   | 완료 확인 전에는 구직자 잔액이 아직 늘지 않았다         | `[통합] leave the worker balance unchanged before completion`                                                                                                                                                                                                                                     |

**커버리지: AC 5개 전부 커버 / 시나리오 25개 / 미커버 0개**

> **AC1의 산술은 통합 테스트가 지킨다.** 서비스 단위 테스트의 가짜 저장소는
> 지급·반환 계산을 스스로 하므로, 그 테스트들이 검증하는 것은 **배선**(주인
> 확인, 전이 판정, 요약 매핑)이지 금액 자체가 아니다. 진짜 원장 행은
> `[통합]`이 센다. #27에서 가짜 저장소가 항상 통과하는 테스트를 만든 적이
> 있어 여기에 적어 둔다.

> **`soft deleted`는 통합으로 옮겼다.** 소프트 삭제를 걸러내는 것은
> `PrismaJobPostReader`의 `WHERE deletedAt IS NULL`이라, 가짜 저장소로는
> `does not exist`와 똑같은 테스트가 된다.

### AC에 없는데 넣은 시나리오

돈이 걸린 이슈라 **원장이 어긋나는 경로**를 AC보다 넓게 잡았다.

| 시나리오                                            | 왜                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `[경계] keep the total of every ledger row at zero` | 판단 2에서 두 안이 산술적으로 틀렸다. 그 실수를 테스트가 잡게 한다                        |
| `[경계] release the locked sum from the ledger`     | #15가 예산을 고친 공고는 예산과 실제 잠금이 다르다. `cancelAndRelease`가 이미 겪은 문제다 |
| `[예외] NOT_EMPLOYER` · `[예외] soft deleted`       | id만 알면 남의 공고 돈을 움직일 수 있다. #18의 `mustOwn`이 같은 이유로 있다               |
| `[통합] leave the job post OPEN when payouts fail`  | `ADR-PAY-4`의 "한 트랜잭션"이 실제로 한 트랜잭션인지 확인한다                             |
| `ApplicantList` 2건                                 | 수직 슬라이스라 화면에서 눌러야 끝난다                                                    |
