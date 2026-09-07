# 이슈 #24 — 노쇼를 기록한다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/24
> PRD: `docs/result/prd/application.md`, `docs/result/prd/penalty-rating.md`
> 담당: B (김규현)
> 상태: 구현 완료 (Green)

---

## 시그니처

### 관련 ADR

이 이슈는 **새 ADR을 만들지 않는다.** 필요한 결정이 이미 넷 다 내려져 있다.

| 따르는 것            | 내용                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec-fixed.md` §4.3 | **무단 불참은 `NO_SHOW`로 별도 기록되며 마찬가지로 `Penalty` 1건.** 취소(#20)와 같은 무게다                                                                      |
| `spec-fixed.md` §5   | `Penalty`는 건별 기록이고 **지우지 않는다.** 사유 enum에 `NO_SHOW`가 이미 있다                                                                                   |
| `ADR-APP-1` (#18)    | 확정 인원은 `JobPost.acceptedCount` 비정규화(정규화된 원본 대신 계산 결과를 따로 들고 있는 것) 카운터다. **#20이 취소에서 내렸고, 노쇼도 같은 방식으로 내린다**  |
| `ADR-APP-5` (#23)    | 완료 확인은 구인자가 공고 단위로 하고 **`ACCEPTED`만 지급한다.** "노쇼로 표시된 인원을 지급에서 빼는 것은 #24가 이어받는다"라고 그 ADR이 이미 이 이슈를 지목했다 |
| `ADR-JOB-3` 경유     | 전이표에 없는 전이는 거부된다. `ACCEPTED → NO_SHOW`는 이미 표에 있고, 그 밖의 상태에서 노쇼로 가는 줄은 없다                                                     |

**정해진 값을 다시 정하지 않는다.** 상태 이름(`NO_SHOW`), 전이표의 `ACCEPTED → NO_SHOW`,
`PenaltyReason.NO_SHOW`, `Penalty` 모델, `JobPost.workStartAt` 컬럼은 이미 있다.
**마이그레이션이 필요 없다.** 이 이슈가 더하는 것은 **판정 함수 하나와 노쇼 트랜잭션 하나**뿐이다.

### 경계값 해석 (판단이 갈렸던 지점)

AC3은 "근무 시작 **전**에 노쇼로 표시하면 막힌다"이다. 근무 시작 시각 정각은 어느 쪽인가.

→ **정각은 허용이다.** "전"은 열린 구간이므로, `now >= workStartAt`이면 근무가 시작된 것으로 본다.
#20의 무상 취소 창(`resolveCancelStatus`)과 같이 **경계를 한 곳에만** 두고 순수 함수로 뺀다.

### 판단이 갈렸던 지점 — 노쇼도 자리를 비우는가

**비운다.** `acceptedCount`는 "지금 확정된 인원"이고 노쇼는 더 이상 확정 인원이 아니다.
#20이 취소에서 카운터를 내리는 것과 같은 이유다 — 자리가 빈 채로 카운터가 남으면
구인자가 대체 인원을 수동으로 다시 수락할 수 없다(PRD Out of Scope가 "자동 모집은 없고
구인자가 수동으로 다시 수락"이라고 못박았다).

지급 금액은 이 카운터를 보지 않는다. `completeAndSettle`은 `ACCEPTED` 행 수로 지급하고
잠금 잔여를 `RELEASE`하므로, 카운터를 내려도 돈은 어긋나지 않는다.

### 타입

```typescript
// packages/shared/src/application.ts

/** 신청이 내는 에러 코드에 한 줄을 더한다 */
export const APPLICATION_ERRORS = {
  // ...
  /** 근무가 아직 시작되지 않았다 (#24 AC3) */
  WORK_NOT_STARTED: 'APPLICATION_WORK_NOT_STARTED',
} as const;

/**
 * 근무가 시작됐나 (#24 AC3).
 *
 * **경계는 열려 있다 — 시작 시각 정각은 시작된 것이다.**
 */
export function hasWorkStarted(workStartAt: Date, now: Date): boolean;

/** 노쇼 표시 요청. 회원 식별은 #17·#18과 같이 아직 본문으로 받는다 */
export const markNoShowRequestSchema = z.object({
  employerId: z.string().min(1, { error: '구인자를 알 수 없습니다.' }),
});
export type MarkNoShowRequest = z.infer<typeof markNoShowRequestSchema>;
```

```typescript
// apps/api/src/application/application.service.ts

/** 신청 판정에 필요한 공고 정보. #24가 근무 시작 시각을 더한다 */
export interface JobPostForApplication {
  // ...
  /** 근무 시작 시각 (#24). 노쇼는 이 시각 전에는 표시할 수 없다 */
  workStartAt: Date;
}

export interface ApplicationStore {
  /**
   * 수락된 신청을 노쇼로 표시한다. **한 트랜잭션이다** (#24).
   *
   * 1. `Application SET NO_SHOW WHERE id=? AND status='ACCEPTED'`
   * 2. `JobPost SET acceptedCount-1 WHERE id=? AND acceptedCount > 0`
   * 3. `Penalty` 1행 (`reason='NO_SHOW'`)
   */
  markNoShow(input: {
    applicationId: string;
    jobPostId: string;
    penalty: { userId: string; reason: PenaltyReason };
  }): Promise<ApplicationRecord | 'STALE'>;
}

class ApplicationService {
  /** 구인자가 노쇼를 기록한다 (#24) */
  markNoShow(input: {
    employerId: string;
    applicationId: string;
  }): Promise<ApplicationSummary>;
}
```

```typescript
// apps/api/src/application/application.controller.ts
// POST /applications/:id/no-show   body: { employerId }   → 200 ApplicationSummary
```

**응답에 `penalized` 같은 칸을 더하지 않는다.** 상태(`NO_SHOW`)가 이미 그 사실을 말한다.
#20이 같은 이유로 그 칸을 뺐다.

### 에러 케이스

| 상황                                 | 에러 코드                        | HTTP |
| ------------------------------------ | -------------------------------- | ---- |
| 그런 신청이 없다                     | `APPLICATION_NOT_FOUND`          | 404  |
| 공고가 없다 / 소프트 삭제됐다        | `JOB_POST_NOT_FOUND`             | 404  |
| 그 공고의 구인자가 아니다            | `APPLICATION_NOT_EMPLOYER`       | 403  |
| 근무가 아직 시작되지 않았다 (AC3)    | `APPLICATION_WORK_NOT_STARTED`   | 409  |
| `ACCEPTED`가 아니다 (표에 없는 전이) | `APPLICATION_INVALID_TRANSITION` | 409  |
| 우리가 읽은 뒤 상태가 바뀌었다       | `APPLICATION_INVALID_TRANSITION` | 409  |
| `employerId`가 없다                  | `VALIDATION_FAILED`              | 400  |

`APPLICATION_WORK_NOT_STARTED`가 **새로 더하는 유일한 코드**다. `INVALID_TRANSITION`으로
갈음하지 않는 이유는, 상태는 맞고 **시각만 이른 것**이라 구인자가 조금 뒤 다시 누르면
되기 때문이다. 두 경우를 한 코드로 묶으면 화면이 "지금은 할 수 없습니다"밖에 말하지 못한다.

### 이 이슈에서 만들지 않는 것

| 항목                               | 이유                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 경고 5건 누적 시 `Suspension` 생성 | #25다. 여기서는 `Penalty` 행만 쌓는다                                                                  |
| 노쇼 알림                          | AC에 없다. 알림은 §5의 **제재 발생 시**이고 그건 #25다                                                 |
| 노쇼 취소·이의제기                 | PRD Out of Scope("노쇼 이의제기 / 분쟁 조정 프로세스 — 관리자 제재 해제로 갈음")                       |
| 당일 취소(`SAME_DAY_CANCEL`) 구분  | AC에 없다. #20이 이미 `LATE_CANCEL`로 판정하고 있고, 사유를 쪼개는 것은 판정 규칙 변경이라 이슈가 없다 |
| 노쇼 표시 화면(웹)                 | 이슈 AC가 전부 서버 판정이다. 화면은 #22 묶음에서 함께 붙인다 (#20과 같은 판단)                        |
| 노쇼 인원의 자리 자동 재모집       | PRD Out of Scope. 구인자가 수동으로 다시 수락한다                                                      |

---

## 테스트 시나리오

### 정상

- [x] [정상] `hasWorkStarted` — should return true when the work start time has already passed
- [x] [정상] `markNoShow` — should move an ACCEPTED application to NO_SHOW when the employer marks it after work started
- [x] [정상] `markNoShow` — should record one NO_SHOW penalty on the applicant when the employer marks a no-show
- [x] [정상] `complete` — should pay only the applications that are still ACCEPTED when one member was marked NO_SHOW
- [x] [정상] `complete` — should return the no-show member's share to the employer as RELEASE
- [x] [정상] `POST /applications/:id/no-show` — should answer 200 with the NO_SHOW application when the employer marks it

### 경계

- [x] [경계] `hasWorkStarted` — should return true when now is exactly the work start time
- [x] [경계] `hasWorkStarted` — should return false when now is one millisecond before the work start time
- [x] [경계] `markNoShow` — should decrease acceptedCount by 1 when an accepted application is marked NO_SHOW
- [x] [경계] `markNoShow` — should record only one penalty when two no-show requests race on the same application
- [x] [경계] `complete` — should release the whole locked amount when every accepted member was marked NO_SHOW

### 예외

- [x] [예외] `markNoShow` — should throw APPLICATION_WORK_NOT_STARTED when the work has not started yet
- [x] [예외] `markNoShow` — should throw APPLICATION_NOT_FOUND when the application does not exist
- [x] [예외] `markNoShow` — should throw APPLICATION_NOT_EMPLOYER when someone other than the employer marks it
- [x] [예외] `markNoShow` — should throw APPLICATION_INVALID_TRANSITION when the application is still APPLIED
- [x] [예외] `markNoShow` — should throw APPLICATION_INVALID_TRANSITION when the application is already NO_SHOW
- [x] [예외] `markNoShow` — should throw JOB_POST_NOT_FOUND when the job post was soft-deleted
- [x] [예외] `POST /applications/:id/no-show` — should answer 400 when employerId is missing

### 통합 (실제 DB)

- [x] [정상] `markNoShow` — should create exactly one Penalty row with reason NO_SHOW
- [x] [정상] `complete` — should leave the no-show member's balance unchanged while the employer gets their share back

---

## AC 대조

| AC                                                                                        | 커버하는 시나리오                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Given `ACCEPTED` 신청, When 구인자가 노쇼로 표시하면, Then `NO_SHOW`가 되고 `Penalty` 1건 | `[정상] markNoShow — ACCEPTED → NO_SHOW`<br>`[정상] markNoShow — one NO_SHOW penalty on the applicant`<br>`[경계] markNoShow — decrease acceptedCount by 1`<br>`[경계] markNoShow — only one penalty when two requests race`<br>`[정상] markNoShow — exactly one Penalty row (DB)` |
| Given 노쇼 처리된 인원, When 완료 확인하면, Then 그 인원분은 지급되지 않고 `RELEASE`된다  | `[정상] complete — pay only the still-ACCEPTED applications`<br>`[정상] complete — return the no-show share as RELEASE`<br>`[경계] complete — release the whole locked amount when everyone no-showed`<br>`[정상] complete — no-show balance unchanged (DB)`                       |
| Given 근무 시작 전, When 노쇼로 표시하면, Then 막힌다                                     | `[예외] markNoShow — APPLICATION_WORK_NOT_STARTED before work starts`<br>`[정상] hasWorkStarted — true after the start time`<br>`[경계] hasWorkStarted — exactly the start time`<br>`[경계] hasWorkStarted — one millisecond before`                                               |

**AC에 없는데 추가한 시나리오** — 전부 "노쇼를 아무나·아무 상태에나 찍을 수 없다"는 방어다.
AC는 정상 흐름만 적고 있어 이게 없으면 **id만 알면 남의 계약자에게 경고를 심을 수 있다.**

- `[예외] APPLICATION_NOT_FOUND` / `JOB_POST_NOT_FOUND` — 없는 것을 표시
- `[예외] APPLICATION_NOT_EMPLOYER` — 제3자·구직자 본인이 표시
- `[예외] APPLICATION_INVALID_TRANSITION` ×2 — 수락 전 표시, 중복 표시
- `[예외] POST .../no-show 400` — 회원 식별 누락
- `[정상] POST .../no-show 200` — HTTP 경계 배선

**커버리지:** AC 3개 / 시나리오 20개 / 미커버 0개

---

### ⚠️ 배포 전 재판정 — 노쇼 표시도 `employerId`를 본문에서 그대로 받는다

`/security-review 24`에서 나왔다. **🟡 권장 수정이고 이 이슈에서 고치지 않는다.**

`POST /applications/:id/no-show`는 `employerId`를 **본문에서 그대로 받는다.**
소유 확인(`mustOwn`)은 그 값과 공고 주인을 비교할 뿐이라, **남의 `employerId`와
`applicationId`를 알면 그 사람 공고의 근무자에게 경고를 심을 수 있다.**

원인은 #24가 아니다. #4의 토큰 주체 배선이 끝나기 전까지 #12 이후 모든
엔드포인트가 같은 임시 방편을 쓰고 있고, `issue-18.md`·`issue-19.md`에 같은
항목이 이미 남아 있다. 다만 이 엔드포인트는 **다른 사람의 제재 이력에 행을
남긴다**는 점에서 거절(#19)보다 회복이 번거롭다 — 원본 `Penalty`는 지우지
않는 것이 §5의 규칙이라, 잘못 찍힌 경고는 #25의 관리자 해제로만 무마된다.

|                 |                                                                                   |
| --------------- | --------------------------------------------------------------------------------- |
| **해소 조건**   | #4의 토큰 주체가 `employerId`를 대체하면 사라진다                                 |
| **재판정 시점** | **첫 배포 직전.** `issue-18.md`·`issue-19.md`의 같은 항목과 함께 한 번에 판정한다 |

> 새 위험이 생긴 것은 아니다. **이미 열린 문에 손잡이가 하나 더 달린 것**이고,
> 문을 닫는 것은 #4다.

### 의존성 점검

`pnpm audit` 9건 전부 `security-exceptions.md`에 이미 판정돼 있다
(`deepmerge-ts` 1 · `mysql2` 2 · `fast-uri` 4 · `qs` 2). **새로 추가된 항목은
없다** — 이 이슈는 의존성을 하나도 건드리지 않았다.

### 타입·빌드

`pnpm build` → `pnpm typecheck` 순서로 돌려 **오류 0건**이다. 비밀값 노출,
`console.log` 개인정보 출력, `.env` 커밋은 이번 변경 범위에 없다.
