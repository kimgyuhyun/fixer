# 이슈 #21 — version이 오르면 신청이 재동의 대기가 된다

> GitHub: https://github.com/Ikara777/fixer/issues/21
> PRD: `docs/result/prd/application.md`
> 담당: B (김규현)
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 시그니처

### 관련 ADR

이 이슈는 **두 개를 새로 확정한다.** 나머지는 이미 내려진 결정을 따른다.

| ID / 문서              | 내용                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ADR-APP-2` **(확정)** | **공고 수정 트랜잭션 안에서 즉시 일괄 전환.** 지연 배치·조회 시점 판정은 `acceptedCount`를 거짓으로 만들거나 `PENDING_REACCEPT` 행 자체를 남기지 못해 기각               |
| `ADR-APP-3` **(확정)** | **`Application.previousStatus` 컬럼 하나.** 이력 테이블·상태 스택은 "직전 하나"에 과하고, 복귀를 `APPLIED`로 고정하는 안은 이미 뽑힌 사람을 다시 지원자로 되돌려서 기각  |
| `spec-fixed.md` §3.4   | 필수항목 6개가 바뀔 때만 `version`이 오른다. `appliedVersion < version`인 신청은 `PENDING_REACCEPT`로 전환되고 **신청 자체는 삭제되지 않는다**                           |
| `ADR-APP-1` (#18)      | 확정 인원은 `JobPost.acceptedCount` 비정규화(정규화된 원본 대신 계산 결과를 따로 들고 있는 것) 카운터다. 재동의로 내려간 `ACCEPTED`는 **이 카운터를 내려야** 빠진 것이다 |
| `ADR-JOB-2` (#15)      | 바뀐 필수항목 판정은 `changedRequiredFields` 한 곳에만 있다. 이 이슈는 그 결과를 **알림 문구로만** 쓴다 — 판정을 다시 하지 않는다                                        |
| `ADR-NOT-1` (#36)      | 알림은 포트(`NotificationPublisher`)로만 발행한다. 발행은 던지지 않으므로 알림 실패가 공고 수정을 되돌리지 않는다                                                        |

**정해진 값을 다시 정하지 않는다.** 상태 이름(`PENDING_REACCEPT`), 전이표의
`APPLIED → PENDING_REACCEPT`·`ACCEPTED → PENDING_REACCEPT`, `appliedVersion` 컬럼,
`version` 증가 규칙은 이미 있다. 이 이슈가 더하는 것은 **전환 한 덩어리, 컬럼 하나,
알림 종류 하나**다.

### 판단이 갈렸던 지점

**전환 조건에 플래그를 두지 않는다.** `applyUpdate`는 이미 `writeSnapshot`(버전이
올랐나)을 받고 있어 그것으로 분기할 수 있지만, 조건을 `appliedVersion < version`
하나로 두면 AC3("부가항목만 수정하면 상태 그대로")이 **분기가 아니라 조건 자체로**
지켜진다. 버전이 안 올랐으면 맞는 행이 하나도 없다.

**알림은 공고 도메인이 발행한다.** 무엇이 바뀌었는지(AC4)를 아는 것은 수정을 판정한
`JobPostService`뿐이다. 신청 도메인으로 넘기면 바뀐 필드 목록을 통째로 넘겨야 하고,
그러면 두 도메인이 같은 것을 알게 된다.

### 타입

```typescript
// packages/shared/src/job-post.ts

/** 버전을 올리는 필드 이름 */
export type JobPostRequiredField = (typeof JOB_POST_REQUIRED_FIELDS)[number];

/** 화면과 알림에 쓰는 필수항목 이름 (#21) */
export const JOB_POST_REQUIRED_FIELD_LABELS: Record<
  JobPostRequiredField,
  string
>;

/**
 * 재동의 대기 알림 본문 (#21 AC4).
 *
 * 값이 아니라 **바뀐 항목 이름**을 적는다. 값 대조는 #22의 diff 화면이 한다.
 */
export function describeRequiredChanges(
  changed: readonly JobPostRequiredField[],
): string;
```

```typescript
// packages/shared/src/application.ts

/** 재동의 대기로 내려가는 상태. 전이표에 `PENDING_REACCEPT`로 가는 줄이 있는 둘 */
export const REACCEPT_TARGET_STATUSES = ['APPLIED', 'ACCEPTED'] as const;

/** 구인자에게 보이는 상태. **`PENDING_REACCEPT`가 더해진다** (AC5) */
export const EMPLOYER_VISIBLE_STATUSES = [
  'APPLIED',
  'ACCEPTED',
  'REJECTED',
  'PENDING_REACCEPT', // ← #21
] as const;
```

```typescript
// packages/shared/src/notification.ts
export const NOTIFICATION_TYPES = [
  ...,
  /** 공고 조건이 바뀌어 재동의가 필요하다 (#21) */
  'APPLICATION_REACCEPT_REQUIRED',
] as const;
```

```typescript
// apps/api/src/job-post/job-post.service.ts

/** 버전이 올라 재동의 대기로 내려간 신청 한 건 (#21) */
export interface DemotedApplication {
  applicationId: string;
  applicantId: string;
  /** 내려가기 전 상태. #22의 "이전 상태로 복귀"가 이 값을 쓴다 (`ADR-APP-3`) */
  previousStatus: 'APPLIED' | 'ACCEPTED';
}

export interface JobPostStore {
  /**
   * 공고를 고친다. **버전 증가·스냅샷·잠금 조정에 재동의 전환이 더해진다.**
   *
   * `appliedVersion < nextVersion`인 `APPLIED`·`ACCEPTED` 신청을
   * `PENDING_REACCEPT`로 내리고 `previousStatus`를 함께 적는다. 내려간
   * `ACCEPTED` 수만큼 `acceptedCount`를 줄인다 (`ADR-APP-2`).
   */
  applyUpdate(input: {
    jobPostId: string;
    patch: Partial<JobPostRecord>;
    nextVersion: number;
    writeSnapshot: boolean;
    budgetDelta: number;
  }): Promise<
    | (JobPostRecord & { categoryName: string; demoted: DemotedApplication[] })
    | 'INSUFFICIENT'
  >;
}

class JobPostService {
  constructor(
    store: JobPostStore,
    addresses: MemberAddressReader,
    balances: BalanceReader,
    accepted: AcceptedCounter,
    /** 재동의 대기 알림을 신청자에게 보낸다 (#21 AC4) */
    notifications: NotificationPublisher,
  );

  /** 시그니처는 그대로. **커밋된 뒤 내려간 신청자에게 알림을 발행한다** */
  update(input: {
    employerId: string;
    jobPostId: string;
    patch: UpdateJobPostRequest;
  }): Promise<JobPostDetail>;
}
```

```prisma
// apps/api/prisma/schema.prisma
model Application {
  /// 재동의 대기로 내려가기 전 상태 (`ADR-APP-3`, #21).
  /// PENDING_REACCEPT인 동안에만 의미가 있다.
  previousStatus ApplicationStatus?
}

enum NotificationType {
  APPLICATION_REACCEPT_REQUIRED
}
```

### 에러 케이스

**이 이슈는 새 에러 코드를 더하지 않는다.** 재동의 전환은 공고 수정에 딸려 일어나는
일이라, 실패는 전부 #15가 이미 정한 코드로 나간다.

| 상황                            | 에러 코드                    | HTTP |
| ------------------------------- | ---------------------------- | ---- |
| 그런 공고가 없다                | `JOB_POST_NOT_FOUND`         | 404  |
| 본인 공고가 아니다              | `JOB_POST_NOT_OWNED`         | 403  |
| `OPEN`이 아니라 못 고친다       | `JOB_POST_NOT_EDITABLE`      | 409  |
| 예산이 늘었는데 잔액이 모자란다 | `POINT_INSUFFICIENT_BALANCE` | 400  |
| 알림 발행이 실패했다            | (없음 — 삼키고 로그만)       | 200  |

### 이 이슈에서 만들지 않는 것

| 항목                                                       | 이유                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 재동의·거절 API와 diff 화면                                | #22다. 이 이슈는 **내려놓는 것**까지고, 올라오는 길은 다음 이슈가 만든다                   |
| `PENDING_REACCEPT → CANCELLED_BY_VERSION_CHANGE` 전이 실행 | 같은 이유로 #22. 전이표에는 이미 있다                                                      |
| 재동의 기한 / 무응답 자동 취소                             | AC에 없고 `spec-fixed.md` §3.4에도 없다. 기한을 지금 정하면 #22가 그 값을 다시 정하게 된다 |
| 알림 이메일 병행                                           | #37이 포트 뒤에서 붙인다                                                                   |
| `acceptedCount`가 0이 된 공고를 다시 열기                  | 공고는 정원이 차도 자동으로 `CLOSED`가 되지 않는다 (`ADR-APP-1`). 되열 상태가 애초에 없다  |
| 구인자에게 "몇 명이 재동의 대기가 됐다" 응답               | AC에 없다. `JobPostDetail`의 `acceptedCount`가 이미 줄어든 수를 보여준다                   |

---

## 테스트 시나리오

### 무변화 시나리오를 쓰는 법

AC 셋("부가항목만 고치면 그대로")처럼 **아무 일도 안 일어나는 것**을 확인하는 시나리오는, 구현이 없는 Red에서도 그냥 통과한다 — 아무 일도 안 일어나는 것은 구현이 없을 때의 기본값이기 때문이다. 그런 테스트는 나중에 전환이 깨져도 초록불을 켠다.

그래서 **무변화는 변화와 짝지어 한 문장으로 단언한다.** "제목만 고쳤을 때 `ACCEPTED`, 그 뒤 보상금을 고쳤을 때 `PENDING_REACCEPT`"를 한 번에 확인하면, 전환이 없는 동안에는 뒤쪽이 어긋나 반드시 실패한다.

### 정상

- [ ] [정상] `describeRequiredChanges` — should name the changed required fields in Korean when the reward and the start time changed
- [ ] [정상] `describeRequiredChanges` — should keep the declared field order when several required fields changed at once
- [ ] [정상] `update` — should publish an APPLICATION_REACCEPT_REQUIRED notification to every demoted applicant when a required field changed
- [ ] [정상] `update` — should put the changed field names in the notification body
- [ ] [정상] `update` — should link the notification to the job post that changed
- [ ] [정상] `update` — should publish exactly one notification per applicant when a required-field change is followed by a title-only change
- [ ] [정상] `listForEmployer` — should list an applicant whose application is PENDING_REACCEPT

### 경계

- [ ] [경계] `EMPLOYER_VISIBLE_STATUSES` — should contain PENDING_REACCEPT so a demoted application stays visible to the employer
- [ ] [경계] `REACCEPT_TARGET_STATUSES` — should be exactly the statuses the transition table allows into PENDING_REACCEPT
- [ ] [경계] `update` — should publish only to the applicant whose appliedVersion is behind the new version
- [ ] [경계] `update` — should publish nothing to withdrawn or rejected applicants

### 통합 (실제 DB)

- [ ] [정상] `update` — should move an APPLIED application with appliedVersion 1 to PENDING_REACCEPT when the post becomes version 2
- [ ] [정상] `update` — should move an ACCEPTED application to PENDING_REACCEPT as well
- [ ] [정상] `update` — should decrease acceptedCount by the number of demoted ACCEPTED applications
- [ ] [정상] `update` — should record the pre-demotion status on every demoted application
- [ ] [정상] `update` — should keep every application row in the database after the demotion
- [ ] [정상] `update` — should write one notification row per demoted applicant
- [ ] [경계] `update` — should hold the application at ACCEPTED through a title-only change and demote it only when a required field changes
- [ ] [경계] `update` — should hold acceptedCount through a title-only change and lower it only when a required field changes
- [ ] [경계] `update` — should demote nobody on a second required-field change when everyone is already PENDING_REACCEPT
- [ ] [경계] `update` — should leave withdrawn and rejected applications untouched while demoting the applied one
- [ ] [예외] `update` — should keep the demotion out of the database when the raised budget exceeds the balance

---

## AC 대조

| AC                                                                                                              | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Given `appliedVersion=1`인 신청들, When 공고가 `version=2`가 되면, Then 그 신청들이 `PENDING_REACCEPT`로 바뀐다 | `[정상] update — APPLIED application moves to PENDING_REACCEPT`<br>`[정상] update — an ACCEPTED application moves as well`<br>`[경계] REACCEPT_TARGET_STATUSES — matches the transition table`<br>`[경계] update — publishes only to the applicant behind the new version`<br>`[경계] update — leaves withdrawn and rejected applications untouched`                                                                                |
| Given `ACCEPTED`였던 신청이 `PENDING_REACCEPT`가 되면, Then 확정 인원에서 빠진다                                | `[정상] update — decreases acceptedCount by the demoted ACCEPTED count`<br>`[경계] update — holds acceptedCount through a title-only change and lowers it after`<br>`[예외] update — keeps the demotion out of the database when the budget is unaffordable`                                                                                                                                                                        |
| Given 부가항목만 수정했을 때, Then 신청 상태는 그대로다                                                         | `[정상] update — exactly one notification per applicant across a title-only change`<br>`[경계] update — holds the application at ACCEPTED through a title-only change`<br>`[경계] update — holds acceptedCount through a title-only change`<br>`[경계] update — demotes nobody on a second required-field change`                                                                                                                   |
| Given 재동의 대기 신청, When 신청자가 알림을 보면, Then 무엇이 바뀌었는지 알 수 있다                            | `[정상] describeRequiredChanges — names the changed fields in Korean`<br>`[정상] describeRequiredChanges — keeps the declared field order`<br>`[정상] update — publishes APPLICATION_REACCEPT_REQUIRED to every demoted applicant`<br>`[정상] update — puts the changed field names in the body`<br>`[정상] update — links the notification to the job post`<br>`[정상] update — writes one notification row per demoted applicant` |
| Given 재동의 대기 상태, When 신청 목록을 보면, Then 신청이 **삭제되지 않고** 남아 있다                          | `[정상] listForEmployer — lists a PENDING_REACCEPT applicant`<br>`[경계] EMPLOYER_VISIBLE_STATUSES — contains PENDING_REACCEPT`<br>`[정상] update — keeps every application row in the database`<br>`[정상] update — records the pre-demotion status`                                                                                                                                                                               |

**AC에 없는데 추가한 시나리오**

- `[정상] update — records the pre-demotion status` — `ADR-APP-3`의 컬럼이 실제로 채워지는지. **비어 있으면 #22가 "이전 상태로 복귀"를 할 수 없고, 그동안 조용히 통과한다**
- `[경계] REACCEPT_TARGET_STATUSES — matches the transition table` — 전환 대상과 전이표가 갈리는 것을 막는다. 갈리면 표에 없는 전이가 저장소에서 조용히 일어난다
- `[경계] update — demotes nobody on a second required-field change` — 전환이 멱등한지(같은 요청을 두 번 보내도 결과가 한 번 보낸 것과 같은 성질). 두 번째에 또 내리면 `acceptedCount`가 두 번 깎인다
- `[예외] update — keeps the demotion out of the database when the budget is unaffordable` — 전환이 예산 조정과 **한 트랜잭션**인지. 나뉘면 수정은 실패했는데 지원자만 재동의 대기가 된다

**커버리지:** AC 5개 / 시나리오 22개 / 미커버 0개
