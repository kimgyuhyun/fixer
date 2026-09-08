# 이슈 #38 — 모집 미달 3시간 전 알림이 오고 공고가 자동 마감된다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/38
> PRD: `docs/result/prd/notification.md`
> 담당: B (김규현) · 선행 #12 #36
> 상태: 구현 완료 (Green)

---

## 시그니처

### 관련 ADR

이 이슈는 **새 구조를 정하지 않는다.** 잡 두 개를 더할 뿐이고, 그 모양은
`spec-fixed.md` §8과 #39(개인정보 파기 배치)가 이미 정해 뒀다.

그대로 따르는 것:

| 출처                         | 따르는 것                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `spec-fixed.md` §8.1         | 스케줄 작업은 `@nestjs/schedule` Cron **1분 주기**. 모집 미달 알림 · 공고 마감 두 가지가 이 이슈 몫이다            |
| `spec-fixed.md` §8.2         | 중복 실행 방어는 **2중**이다 — 대상 행의 멱등 플래그(`IS NULL` 조건절) + `pg_try_advisory_lock(jobKey)`            |
| `spec-fixed.md` §3.3         | `OPEN` → `CLOSED`(정원 충족) / `OPEN` → `EXPIRED`(미달 상태로 시작 시각 경과)                                      |
| `prd/notification.md` §5     | 미달 알림 조건은 `OPEN && 시작 3시간 전 && 확정 인원 < 정원`. **미응답 시 기본값은 유지**                          |
| `ADR-NOT-1` (#36)            | 알림은 **직접 호출 + 포트**다. 잡은 `NotificationPublisher`만 보고, 인앱인지 메일인지 모른다                       |
| `ADR-NOT-3` (#36)            | **발행자가 문구를 만들어 넘긴다.** 템플릿 레지스트리 없음                                                          |
| `ADR-JOB-3`                  | 상태 전이는 `JOB_POST_TRANSITIONS` 표를 거친다. 표에 없는 전이는 거부된다                                          |
| `ADR-APP-1`                  | 확정 인원은 행을 세지 않고 `JobPost.acceptedCount` 컬럼을 읽는다                                                   |
| #39 (`retention/purge.*.ts`) | 잡의 파일 배치 — `*.job.ts`(언제 도는지) / `*.service.ts`(무엇을 하는지) / `prisma-*.store.ts`(어떻게 읽고 쓰는지) |

`JobLock`(advisory lock 포트)과 `PostgresJobLock`(구현)은 **#39가 만든 것을
그대로 쓴다.** 같은 락을 두 번 구현하면 키 관리가 두 곳으로 갈린다.

### 판단 1 · 잡을 둘로 나눈다. 락 키도 둘이다

`prd/notification.md` §5의 표는 「모집 미달 알림」과 「공고 자동 마감」을 **서로
다른 작업 두 개**로 적어 뒀고, 조건도 다르다(전자는 시작 **전**, 후자는 시작
**후**). 하나로 합치면 알림 쪽이 터졌을 때 마감까지 같이 멈춘다.

`spec-fixed.md` §8.2의 "잡 하나당 고정 정수 키"를 그대로 지켜 키를 둘 만든다.
값은 이슈 번호에서 끌어온다 — `#39`가 `39`를 쓴 것과 같은 방식이다.

### 판단 2 · 미달 알림은 **시작 전** 공고만 본다

조건을 `workStartAt <= now + 3시간`으로만 두면 **시작 시각이 이미 지난 공고도
걸린다.** 그러면 같은 1분 안에 "연장·삭제·유지를 고르세요" 알림이 가고 곧바로
그 공고가 `EXPIRED`가 된다. 고를 시간이 0초인 선택지를 보내는 셈이다.

그래서 창을 양쪽으로 닫는다 — `now < workStartAt <= now + 3시간`.
시작 시각을 지난 것은 마감 잡의 몫이다.

### 판단 3 · 알림 표시를 **먼저** 하고 발행한다

`markNotified`가 `underfilledNotifiedAt IS NULL`을 조건절에 건 조건부
UPDATE라, 두 프로세스가 락을 사이에 두고 엇갈려도 **행을 차지한 쪽 하나만**
발행한다. 표시를 나중에 하면 그 사이에 죽었을 때 다음 분에 또 나간다.

발행이 실패해도 표시는 되돌리지 않는다. `NotificationPublisher.publish`는
던지지 않기로 되어 있고(ADR-NOT-1), 중복 발송이 미발송보다 나쁘다는 것이
`prd/notification.md` §1의 실패 모드 판단이다.

### 판단 4 · `EXPIRED → COMPLETED`를 전이표에 더한다

**이 이슈가 만드는 회귀를 이 이슈가 막는 것이다.** 미달인 채로 시작 시각이
지나면 공고는 `EXPIRED`가 되는데, 확정 인원이 1명이라도 있으면 그 사람은 일을
하고 대금을 받아야 한다. 완료 확인(#23)은 `OPEN`·`CLOSED`에서만 되므로,
`EXPIRED`가 생기는 순간 **미달 공고의 수락자는 영영 돈을 못 받는다.**

#23이 `EXPIRED → COMPLETED`를 "#38이 `EXPIRED`를 만든 뒤"로 미뤄 둔 것이
이것이다 (`docs/result/scenarios/issue-23.md`).

### 타입

```typescript
// packages/shared/src/notification.ts
export const NOTIFICATION_TYPES = [
  // ... 기존 6종
  /** 시작 3시간 전인데 인원이 안 찼다 (#38) */
  'JOB_POST_UNDERFILLED',
] as const;

/**
 * 모집 미달 알림을 보내는 시점. 시작 **3시간** 전 (`spec-fixed.md` §8.1)
 *
 * 테스트는 이 값을 쓰지 않고 짧은 값을 주입한다 — #39의 `RETENTION`과 같다.
 */
export const UNDERFILL_NOTICE_LEAD_MS = 3 * 60 * 60 * 1000;
```

```typescript
// packages/shared/src/retention.ts — ADVISORY_LOCK_KEYS가 사는 곳
export const ADVISORY_LOCK_KEYS = {
  PURGE_PERSONAL_INFO: 39,
  /** 모집 미달 알림 (#38) */
  NOTIFY_UNDERFILLED_JOB_POST: 3801,
  /** 공고 자동 마감 (#38) */
  CLOSE_STARTED_JOB_POST: 3802,
} as const;
```

```typescript
// packages/shared/src/job-post.ts
JOB_POST_TRANSITIONS += { from: 'EXPIRED', to: 'COMPLETED' };
```

```typescript
// apps/api/src/notification/job-post-schedule.service.ts

/** 미달 알림 대상 공고 하나. 문구를 만드는 데 필요한 것만 담는다 */
export interface UnderfilledJobPost {
  id: string;
  employerId: string;
  title: string;
  headcount: number;
  acceptedCount: number;
  workStartAt: Date;
}

/** 시작 시각이 지난 `OPEN` 공고 하나. 마감은 인원 수만 보면 된다 */
export interface StartedJobPost {
  id: string;
  headcount: number;
  acceptedCount: number;
}

export interface JobPostScheduleStore {
  /** `OPEN` · 미달 · 아직 안 알림 · `after < workStartAt <= until` */
  findUnderfilled(after: Date, until: Date): Promise<UnderfilledJobPost[]>;
  /**
   * 알림 보냄 표시. **이미 표시돼 있으면 `false`** — 조건부 UPDATE 한 문장이라
   * 두 실행이 엇갈려도 한쪽만 `true`를 받는다 (`spec-fixed.md` §8.2 1차)
   */
  markNotified(jobPostId: string, notifiedAt: Date): Promise<boolean>;
  /** 시작 시각이 지난 `OPEN` 공고 */
  findStarted(now: Date): Promise<StartedJobPost[]>;
  /** `OPEN`일 때만 옮긴다. 이미 누가 옮겼으면 `false` */
  close(jobPostId: string, to: 'CLOSED' | 'EXPIRED'): Promise<boolean>;
}

/** 미달 알림 한 번의 결과 */
export interface UnderfillNoticeReport {
  notifiedJobPostIds: string[];
  /** 락을 못 잡아 아무것도 하지 않았다. **오류가 아니다** */
  skippedByLock: boolean;
}

/** 자동 마감 한 번의 결과 */
export interface AutoCloseReport {
  /** 정원이 찬 채로 시작 시각이 지났다 */
  closedJobPostIds: string[];
  /** 미달인 채로 시작 시각이 지났다 */
  expiredJobPostIds: string[];
  skippedByLock: boolean;
}

@Injectable()
export class JobPostScheduleService {
  constructor(
    store: JobPostScheduleStore,
    notifications: NotificationPublisher,
    lock: JobLock,
  );

  notifyUnderfilled(
    now: Date,
    leadMs: number,
    lockKey: number,
  ): Promise<UnderfillNoticeReport>;

  closeStarted(now: Date, lockKey: number): Promise<AutoCloseReport>;
}
```

```typescript
// apps/api/src/notification/job-post-schedule.job.ts
@Injectable()
export class JobPostScheduleJob {
  /** 1분 주기 (`spec-fixed.md` §8.1) */
  @Cron(CronExpression.EVERY_MINUTE) notifyUnderfilled(): Promise<void>;
  @Cron(CronExpression.EVERY_MINUTE) closeStarted(): Promise<void>;
}
```

```prisma
// apps/api/prisma/schema.prisma
model JobPost {
  // ...
  /// 모집 미달 알림을 보낸 시각. null이면 아직 안 보냈다 (#38).
  /// 이 컬럼의 `IS NULL`이 중복 발송을 막는 1차 방어다 (`spec-fixed.md` §8.2)
  underfilledNotifiedAt DateTime?
}

enum NotificationType {
  // ...
  /// 시작 3시간 전인데 인원이 안 찼다 (#38)
  JOB_POST_UNDERFILLED
}
```

### 알림 문구 (ADR-NOT-3 — 발행자가 만든다)

| 항목      | 값                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `type`    | `JOB_POST_UNDERFILLED`                                                                                      |
| `title`   | `모집 인원이 아직 다 차지 않았습니다`                                                                       |
| `body`    | `{제목} — 시작 3시간 전인데 {확정}/{정원}명입니다. 연장·삭제·유지 중에서 고르세요. 그대로 두면 유지됩니다.` |
| `linkUrl` | `/job-posts/{id}`                                                                                           |

**"연장·삭제·유지"를 본문에 적는 것이 AC1이 요구하는 전부다.** 세 가지를
실행하는 화면은 이미 있다 — 연장·삭제는 공고 수정(#15)과 취소(#16)이고,
유지는 아무것도 안 하는 것이다(AC5).

### 에러 케이스

**새 에러 코드를 만들지 않는다.** 잡에는 요청자가 없어 4xx를 돌려줄 상대가 없다.

| 상황                      | 무엇을 하나                                               |
| ------------------------- | --------------------------------------------------------- |
| 락을 못 잡았다            | `skippedByLock: true`로 조용히 반환. 다른 인스턴스가 돈다 |
| 알림 발행이 실패했다      | 삼킨다 (`NotificationPublisher`의 계약, ADR-NOT-1)        |
| 이미 다른 실행이 마감했다 | `close`가 `false`. 보고에서 빠질 뿐이다                   |
| 저장소가 던졌다           | 던지되 **락은 반드시 푼다**. 안 풀면 다음 실행이 막힌다   |

### 컴포넌트 Props

**없다.** 이 이슈에는 화면이 없다. 발행된 알림은 #36이 만든 헤더 벨과 알림
목록에 그대로 뜬다.

### 이 이슈에서 만들지 않는 것

| 항목                                    | 왜 / 어디로                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 연장·삭제·유지 **전용 화면·엔드포인트** | AC에 없다. 연장은 #15(수정), 삭제는 #16(취소), 유지는 무동작(AC5)                                 |
| 이메일 병행 발송                        | **#37.** 포트 뒤라 이 잡은 고칠 것이 없다                                                         |
| `EXPIRED` 공고의 잠긴 예산 자동 반환    | 문서에 정해진 바가 없다. 구인자가 완료 확인(#23)을 하면 `RELEASE`된다 — 판단 4의 전이가 그 길이다 |
| `@@index([status, workStartAt])`        | 인덱스는 재기 전에 넣지 않는다(`index-measurement` 스킬). 필요해지면 EXPLAIN을 근거로 따로 넣는다 |
| 잡 실패 재시도 큐                       | `ADR-NOT-4` 미결. 1분 뒤 다음 실행이 같은 대상을 다시 집는다                                      |
| `DRAFT` 공고 정리                       | AC는 `OPEN`만 말한다. `DRAFT`는 돈이 안 잠겨 있어 급하지 않다                                     |

### 기존 파일 변경 예고

| 파일                                               | 무엇이 바뀌나                                      |
| -------------------------------------------------- | -------------------------------------------------- |
| `apps/api/prisma/schema.prisma`                    | `JobPost.underfilledNotifiedAt` + enum 값 1개      |
| `packages/shared/src/notification.ts`              | `JOB_POST_UNDERFILLED`, `UNDERFILL_NOTICE_LEAD_MS` |
| `packages/shared/src/retention.ts`                 | `ADVISORY_LOCK_KEYS` 두 개 추가                    |
| `packages/shared/src/job-post.ts`                  | `JOB_POST_TRANSITIONS`에 `EXPIRED → COMPLETED`     |
| `apps/api/src/notification/notification.module.ts` | 잡·서비스·저장소 배선 + `ScheduleModule.forRoot()` |

---

## 테스트 시나리오

### 정상

- [x] [정상] `notifyUnderfilled` — should publish a JOB_POST_UNDERFILLED notification to the employer when an OPEN post starts within the lead time and is under-filled
- [x] [정상] `notifyUnderfilled` — should tell the employer the 연장·삭제·유지 choices and link to the post
- [x] [정상] `notifyUnderfilled` — should publish nothing on a second run over the same post
- [x] [정상] `notifyUnderfilled` — should leave the notified post OPEN and undeleted so no answer means keeping it
- [x] [정상] `notifyUnderfilled` — should report skippedByLock and publish nothing when the lock is held elsewhere
- [x] [정상] `notifyUnderfilled` — should release the lock when it finishes
- [x] [정상] `closeStarted` — should close a post whose seats are full when its start time has passed
- [x] [정상] `closeStarted` — should expire an under-filled post when its start time has passed
- [x] [정상] `closeStarted` — should report skippedByLock and change no status when the lock is held elsewhere
- [x] [정상] `PrismaJobPostScheduleStore.findUnderfilled` — should return only the OPEN, under-filled, unnotified posts inside the window from the real database
- [x] [정상] `PrismaJobPostScheduleStore.close` — should write CLOSED and EXPIRED to the real database

### 경계

- [x] [경계] `notifyUnderfilled` — should notify a post whose start is exactly the lead time away
- [x] [경계] `notifyUnderfilled` — should not notify a post whose start is one second beyond the lead time
- [x] [경계] `notifyUnderfilled` — should not notify a post whose seats are already full
- [x] [경계] `notifyUnderfilled` — should publish nothing when another runner claimed the post first
- [x] [경계] `notifyUnderfilled` — should report the post as notified without closing or expiring it
- [x] [경계] `closeStarted` — should close a post exactly at its start time
- [x] [경계] `closeStarted` — should leave a post OPEN one second before its start time
- [x] [경계] `closeStarted` — should expire a post nobody was accepted for
- [x] [경계] `closeStarted` — should expire a notified post that got no response once its start time passes
- [x] [경계] `canTransition` — should allow EXPIRED to COMPLETED so accepted workers can still be paid
- [x] [경계] `PostgresJobLock` — should refuse the second runner while the first holds the job key
- [x] [경계] `PrismaJobPostScheduleStore.markNotified` — should hand the post to only one of two runs

### 예외

- [x] [예외] `notifyUnderfilled` — should keep publishing to the rest when one publish fails
- [x] [예외] `closeStarted` — should release the lock even when the store throws

---

## AC 대조

| AC                                                                                                                      | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1** Given `OPEN`이고 시작 3시간 전이며 인원 미달인 공고, When 잡이 돌면, Then 구인자에게 연장/삭제/유지 알림이 간다 | `[정상] notifyUnderfilled — should publish a JOB_POST_UNDERFILLED …`<br>`[정상] notifyUnderfilled — should tell the employer the 연장·삭제·유지 choices …`<br>`[경계] notifyUnderfilled — exactly the lead time away`<br>`[경계] notifyUnderfilled — one second beyond the lead time`<br>`[경계] notifyUnderfilled — seats already full`<br>`[정상] PrismaJobPostScheduleStore.findUnderfilled — …from the real database` |
| **AC2** Given 알림을 이미 보낸 공고, When 잡이 다시 돌면, Then 두 번 보내지 않는다                                      | `[정상] notifyUnderfilled — should publish nothing on a second run …`<br>`[경계] notifyUnderfilled — another runner claimed the post first`<br>`[경계] PrismaJobPostScheduleStore.markNotified — only one of two runs`<br>`[예외] notifyUnderfilled — should keep publishing to the rest when one publish fails`                                                                                                          |
| **AC3** Given 시작 시각이 지난 `OPEN` 공고, When 잡이 돌면, Then 인원이 찼으면 `CLOSED`, 미달이면 `EXPIRED`가 된다      | `[정상] closeStarted — full seats → CLOSED`<br>`[정상] closeStarted — under-filled → EXPIRED`<br>`[경계] closeStarted — exactly at its start time`<br>`[경계] closeStarted — one second before its start time`<br>`[경계] closeStarted — nobody was accepted`<br>`[정상] PrismaJobPostScheduleStore.close — …to the real database`                                                                                        |
| **AC4** Given 잡이 동시에 두 번 실행되면, Then advisory lock으로 하나만 진행된다                                        | `[정상] notifyUnderfilled — skippedByLock …`<br>`[정상] closeStarted — skippedByLock …`<br>`[정상] notifyUnderfilled — should release the lock when it finishes`<br>`[예외] closeStarted — should release the lock even when the store throws`<br>`[경계] PostgresJobLock — should refuse the second runner …`                                                                                                            |
| **AC5** Given 구인자가 미응답이면, Then 공고는 그대로 유지된다 (기본값)                                                 | `[정상] notifyUnderfilled — should leave the notified post OPEN and undeleted …`<br>`[경계] notifyUnderfilled — should report the post as notified without closing or expiring it`<br>`[경계] closeStarted — should expire a notified post that got no response once its start time passes`                                                                                                                               |

### AC에 없는데 추가한 시나리오

| 시나리오                                                              | 왜 넣었나                                                                                                                                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[경계] canTransition — EXPIRED → COMPLETED`                          | **이 이슈가 만드는 회귀를 이 이슈가 막는다** (판단 4). `EXPIRED`가 생기는 순간, 미달 공고의 수락자가 대금을 받을 길이 사라진다. #23이 여기로 미뤄 둔 것이다                |
| `[예외] notifyUnderfilled — one publish fails`                        | 잡은 여러 건을 한 번에 돈다. 한 건이 터졌다고 나머지가 안 나가면 **한 사람 때문에 다른 구인자들이 알림을 못 받는다**. `publish`는 안 던지기로 되어 있으나 계약을 못 박는다 |
| `[정상] notifyUnderfilled — should release the lock when it finishes` | 안 풀면 **다음 실행이 영원히 막힌다.** #39가 같은 이유로 둔 테스트다                                                                                                       |
| `[경계] PostgresJobLock — 두 번째 러너를 거절한다`                    | AC4는 "advisory lock으로 하나만"이라고 말하는데, 가짜 락으로는 **진짜 분산락인지** 증명이 안 된다. 다른 연결에서 잡아 봐야 한다                                            |

### AC에 있는데 시나리오가 없는 것

없다.

**커버리지:** AC 5개 / 시나리오 25개 / 미커버 0개

### 파일 배치

| 파일                                                              | 시나리오 수 |
| ----------------------------------------------------------------- | ----------- |
| `apps/api/src/notification/job-post-schedule.service.test.ts`     | 20          |
| `apps/api/src/notification/job-post-schedule.integration.test.ts` | 4           |
| `packages/shared/src/job-post.test.ts` (추가)                     | 1           |
