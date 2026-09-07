# 이슈 #20 — 수락 2시간 안에는 무상 취소된다

> GitHub: https://github.com/Ikara777/fixer/issues/20
> PRD: `docs/result/prd/application.md`
> 담당: B (김규현)
> 상태: 구현 완료 (Green)

---

## 시그니처

### 관련 ADR

이 이슈는 **새 ADR을 만들지 않는다.** 필요한 결정이 이미 셋 다 내려져 있다.

| 따르는 것                  | 내용                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec-fixed.md` §4.3       | **무상 취소 창 = 수락 시각 + 2시간.** 이 안에서는 구인자·구직자 양쪽 모두 무패널티. 창을 넘긴 취소는 `Penalty` 1건                                      |
| `ADR-APP-1` (#18)          | 확정 인원은 `JobPost.acceptedCount` 비정규화(정규화된 원본 대신 계산 결과를 따로 들고 있는 것) 카운터다. **#18은 올리기만 했고, 내리는 쪽이 이 이슈다** |
| `ADR-JOB-3` (#17·#18 경유) | 전이표에 없는 전이는 거부된다. `APPLIED → CANCELLED_*`가 표에 없으므로 **수락 전 취소가 여기서 막힌다** (그건 #17의 철회다)                             |
| `spec-fixed.md` §5         | `Penalty`는 건별 기록이고 **지우지 않는다.** 사유는 구직자 취소가 `LATE_CANCEL`, 구인자 취소가 `POSTER_CANCEL`                                          |

**정해진 값을 다시 정하지 않는다.** 상태 이름(`CANCELLED_FREE`/`CANCELLED_PENALTY`),
전이표, `Penalty` 모델과 `PenaltyReason` enum, `acceptedAt` 컬럼은 이미 있다. 이 이슈가
더하는 것은 **판정 함수 하나와 취소 트랜잭션 하나**뿐이다.

### 경계값 해석 (판단이 갈렸던 지점)

`spec-fixed.md` §4.3은 "무상 취소 창 = 수락 시각 +2시간, **이 안에서는** 무패널티",
상태머신은 "`CANCELLED_FREE` (수락 +2h **이내**)", "`CANCELLED_PENALTY` (2h **초과**)"라고 쓴다.

→ **정확히 2시간은 무상이다.** 창은 닫힌 구간이고, 넘긴 것만 경고다.

### 타입

```typescript
// packages/shared/src/application.ts

/** 무상 취소 창. 수락 시각 + 2시간 (`spec-fixed.md` §4.3) */
export const FREE_CANCEL_WINDOW_MS = 2 * 60 * 60 * 1000;

/** 취소가 무상인지 경고인지. **경계는 닫혀 있다 — 정확히 2시간은 무상** */
export function resolveCancelStatus(
  acceptedAt: Date,
  now: Date,
): 'CANCELLED_FREE' | 'CANCELLED_PENALTY';

/** 취소 요청. 회원 식별은 #17·#18과 같이 아직 본문으로 받는다 */
export const cancelApplicationRequestSchema = z.object({
  actorId: z.string().min(1, { error: '회원 정보가 없습니다.' }),
});
export type CancelApplicationRequest = z.infer<
  typeof cancelApplicationRequestSchema
>;
```

```typescript
// apps/api/src/application/application.service.ts

export interface ApplicationStore {
  /**
   * 수락된 신청을 취소한다. **한 트랜잭션이다.**
   *
   * 1. `Application SET status=nextStatus WHERE id=? AND status='ACCEPTED'`
   * 2. `JobPost SET acceptedCount-1 WHERE id=? AND acceptedCount > 0`
   * 3. `penalty`가 있으면 `Penalty` 1행
   */
  cancel(input: {
    applicationId: string;
    jobPostId: string;
    nextStatus: 'CANCELLED_FREE' | 'CANCELLED_PENALTY';
    penalty: { userId: string; reason: PenaltyReason } | null;
  }): Promise<ApplicationRecord | 'STALE'>;
}

class ApplicationService {
  /** 수락된 신청을 취소한다. 구직자·구인자 양쪽이 부른다 (#20) */
  cancel(input: {
    actorId: string;
    applicationId: string;
  }): Promise<ApplicationSummary>;
}
```

```typescript
// apps/api/src/application/application.controller.ts
// POST /applications/:id/cancel   body: { actorId }   → 200 ApplicationSummary
```

**응답에 `penalized` 같은 칸을 더하지 않는다.** 상태(`CANCELLED_FREE` /
`CANCELLED_PENALTY`)가 이미 그 사실을 말한다. 두 곳에 두면 어긋날 수 있다.

### 에러 케이스

| 상황                                  | 에러 코드                        | HTTP |
| ------------------------------------- | -------------------------------- | ---- |
| 그런 신청이 없다                      | `APPLICATION_NOT_FOUND`          | 404  |
| 공고가 없다 / 소프트 삭제됐다         | `JOB_POST_NOT_FOUND`             | 404  |
| 당사자가 아니다 (지원자도 구인자도 X) | `APPLICATION_NOT_PARTICIPANT`    | 403  |
| `ACCEPTED`가 아니다 (표에 없는 전이)  | `APPLICATION_INVALID_TRANSITION` | 409  |
| 우리가 읽은 뒤 상태가 바뀌었다        | `APPLICATION_INVALID_TRANSITION` | 409  |
| `actorId`가 없다                      | `VALIDATION_FAILED`              | 400  |

`APPLICATION_NOT_PARTICIPANT`가 **새로 더하는 유일한 코드**다. 기존 `NOT_OWNED`(본인
신청이 아님)와 `NOT_EMPLOYER`(그 공고 구인자가 아님)는 각각 한쪽만 보는데, 취소는
**둘 중 하나이기만 하면 된다.** 둘 중 아무 코드나 재사용하면 반대쪽 당사자에게 틀린
안내가 나간다.

### 이 이슈에서 만들지 않는 것

| 항목                               | 이유                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 취소 시 포인트 `RELEASE`           | 잠금은 **공고 단위**다. 남은 잠금은 #23의 완료 확인이 `잠금 − 지급`으로 되돌린다 — 자리 하나씩 풀면 같은 돈이 두 번 나갈 창이 생긴다 |
| 경고 5건 누적 시 `Suspension` 생성 | #25다. 여기서는 `Penalty` 행만 쌓는다                                                                                                |
| 당일 취소(`SAME_DAY_CANCEL`) 구분  | 근무 시각 기준 판정은 AC에 없다. 노쇼(#24)와 함께 다룬다                                                                             |
| 자리가 비었을 때 자동 재모집·알림  | PRD Out of Scope("부분 취소 시 대체 인원 자동 모집 — 구인자가 수동으로 다시 수락")                                                   |
| 취소 화면(웹)                      | 이슈 AC가 전부 서버 판정이다. 화면은 #22 묶음에서 함께 붙인다                                                                        |
| 거절(`REJECTED`) 흐름              | #19가 병렬로 만든다. 이 이슈는 손대지 않는다                                                                                         |

---

## 테스트 시나리오

### 정상

- [x] [정상] `resolveCancelStatus` — should return CANCELLED_FREE when 1 hour has passed since acceptance
- [x] [정상] `resolveCancelStatus` — should return CANCELLED_PENALTY when 3 hours have passed since acceptance
- [x] [정상] `cancel` — should move an ACCEPTED application to CANCELLED_FREE when the applicant cancels 1 hour after acceptance
- [x] [정상] `cancel` — should move to CANCELLED_PENALTY with one LATE_CANCEL penalty on the applicant when the applicant cancels 3 hours after acceptance
- [x] [정상] `cancel` — should move to CANCELLED_FREE when the employer cancels 1 hour after acceptance
- [x] [정상] `cancel` — should record one POSTER_CANCEL penalty on the employer when the employer cancels 3 hours after acceptance
- [x] [정상] `POST /applications/:id/cancel` — should answer 200 with the cancelled application when the applicant cancels

### 경계

- [x] [경계] `resolveCancelStatus` — should return CANCELLED_FREE when exactly 2 hours have passed
- [x] [경계] `resolveCancelStatus` — should return CANCELLED_PENALTY when 2 hours and 1 millisecond have passed
- [x] [경계] `cancel` — should decrease acceptedCount by 1 when an accepted application is cancelled
- [x] [경계] `cancel` — should let the employer accept another applicant when the cancellation freed the last seat
- [x] [경계] `cancel` — should decrease acceptedCount only once when two cancel requests race on the same application

### 예외

- [x] [예외] `cancel` — should throw APPLICATION_NOT_FOUND when the application does not exist
- [x] [예외] `cancel` — should throw APPLICATION_NOT_PARTICIPANT when someone who is neither the applicant nor the employer cancels
- [x] [예외] `cancel` — should throw APPLICATION_INVALID_TRANSITION when the application is still APPLIED
- [x] [예외] `cancel` — should throw APPLICATION_INVALID_TRANSITION when the application is already cancelled
- [x] [예외] `cancel` — should throw JOB_POST_NOT_FOUND when the job post was soft-deleted
- [x] [예외] `POST /applications/:id/cancel` — should answer 400 when actorId is missing

### 통합 (실제 DB)

- [x] [정상] `cancel` — should create exactly one Penalty row when the applicant cancels past the free window
- [x] [정상] `cancel` — should create no Penalty row when the applicant cancels inside the free window

---

## AC 대조

| AC                                                                                                     | 커버하는 시나리오                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Given 수락된 지 1시간 지난 신청, When 구직자가 취소하면, Then `CANCELLED_FREE`가 되고 경고가 안 쌓인다 | `[정상] resolveCancelStatus — 1 hour → CANCELLED_FREE`<br>`[정상] cancel — applicant cancels 1 hour after acceptance`<br>`[경계] resolveCancelStatus — exactly 2 hours`<br>`[정상] cancel — should create no Penalty row when cancelling inside the free window` |
| Given 수락된 지 3시간 지난 신청, When 구직자가 취소하면, Then `CANCELLED_PENALTY` + `Penalty` 1건      | `[정상] resolveCancelStatus — 3 hours → CANCELLED_PENALTY`<br>`[정상] cancel — LATE_CANCEL penalty on the applicant`<br>`[경계] resolveCancelStatus — 2 hours and 1 millisecond`<br>`[정상] cancel — should create exactly one Penalty row past the window`      |
| Given 수락된 지 1시간 지난 신청, When 구인자가 취소하면, Then 마찬가지로 무상 취소                     | `[정상] cancel — employer cancels 1 hour after acceptance`<br>`[정상] cancel — POSTER_CANCEL penalty when the employer cancels late`<br>`[예외] cancel — NOT_PARTICIPANT when a stranger cancels`                                                                |
| Given 취소된 신청, When 확정 인원을 보면, Then 1 줄어 있다                                             | `[경계] cancel — should decrease acceptedCount by 1`<br>`[경계] cancel — should decrease acceptedCount only once when two cancels race`                                                                                                                          |
| Given 취소로 자리가 빈 공고, When 다른 지원자를 수락하면, Then 성공한다                                | `[경계] cancel — should let the employer accept another applicant when the cancellation freed the last seat`                                                                                                                                                     |

**AC에 없는데 추가한 시나리오** — 전부 "취소를 아무나·아무 때나 할 수 없다"는 방어다.
AC는 정상 흐름만 적고 있어 이게 없으면 **id만 알면 남의 계약을 깰 수 있다.**

- `[예외] APPLICATION_NOT_FOUND` / `JOB_POST_NOT_FOUND` — 없는 것을 취소
- `[예외] APPLICATION_NOT_PARTICIPANT` — 제3자 취소
- `[예외] APPLICATION_INVALID_TRANSITION` ×2 — 수락 전 취소(그건 #17의 철회다), 중복 취소
- `[예외] POST .../cancel 400` — 회원 식별 누락
- `[정상] POST .../cancel 200` — HTTP 경계 배선

**커버리지:** AC 5개 / 시나리오 20개 / 미커버 0개
