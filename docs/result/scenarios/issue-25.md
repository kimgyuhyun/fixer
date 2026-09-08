# 이슈 #25 — 경고가 5건 쌓이면 제재된다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/25
> PRD: `docs/result/prd/penalty-rating.md`
> 담당: B (김규현)
> 상태: 구현 완료 (Green)

---

## 시그니처

### 관련 ADR

PRD `penalty-rating.md` §3의 표는 아직 `TODO`다. **하지만 이 이슈가 쓰는 값과 구조는
`spec-fixed.md` §5가 이미 못 박아 두었다.** 여기서 다시 정하지 않는다.

| 따르는 것             | 내용                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `spec-fixed.md` §5    | **최근 180일 롤링 윈도우 내 5건 이상 → 5일 제재.** 집계는 쿼리로만 하고 배치는 없다                                           |
| `spec-fixed.md` §5    | 제재 발생 시 `Suspension` 레코드 생성(`startAt`, `endAt`) **+ 알림 발송**                                                     |
| `spec-fixed.md` §5    | 제재 중 차단은 **공고 등록·알바 신청 둘뿐.** 진행 중인 계약 이행·환전·조회는 계속 가능                                        |
| `spec-fixed.md` §5    | `Penalty` 레코드는 지우지 않는다 (분쟁 대응 근거)                                                                             |
| `spec-fixed.md` §5.1  | 유효 제재 판정 쿼리는 **`releasedAt IS NULL AND endAt > now()`**                                                              |
| `spec-fixed.md` §8.1  | **제재 해제는 잡이 아니다.** `endAt` 경과 여부를 조회 시점에 판정한다                                                         |
| `ADR-NOT-1` (#36)     | 도메인은 `NotificationPublisher` 포트만 본다. 발행 실패가 도메인 트랜잭션을 깨지 않는다                                       |
| #24 `issue-24.md`     | "노쇼 알림 — 알림은 §5의 **제재 발생 시**이고 그건 #25다." 이 이슈가 그 알림을 만든다                                         |
| #20 · #24 (`Penalty`) | 경고 행을 쓰는 곳은 이미 둘뿐이다 — `cancel`(`LATE_CANCEL`/`POSTER_CANCEL`)과 `markNoShow`(`NO_SHOW`). **판정을 여기 붙인다** |

### 이 이슈가 내리는 결정 세 가지

PRD §3의 `ADR-PEN-1`·`ADR-PEN-2`가 비어 있어 보이지만, **선택지는 이미 좁혀져 있다.**

**1. 판정 시점 — 경고가 쌓이는 그 트랜잭션 안에서 판정한다** (`ADR-PEN-1`)

AC1이 "5번째 경고가 **쌓이면** `Suspension`이 생긴다"이므로 조회 시점 지연 생성은 답이 아니고,
§8.1이 "제재 해제는 잡이 아니다"라고 배치를 이미 걷어냈다. 남은 것은 쓰기 시점 판정이다.

**경고 삽입과 같은 트랜잭션에 둔다.** 나누면 `Penalty` 5건은 커밋됐는데 `Suspension`이 없는
상태가 남고, **그걸 나중에 고쳐 줄 배치가 없다**(§5). 조용히 틀린 채로 영원히 남는 종류다.
매 요청 집계 비용은 문제가 되지 않는다 — 집계는 **경고가 쌓일 때만** 돌고, `Penalty`에는
`(userId, occurredAt)` 인덱스가 이미 있다.

**2. 차단 지점 — 서비스 계층이다** (`ADR-PEN-2`)

Nest Guard는 지금 쓸 수 없다. 회원 식별이 아직 토큰이 아니라 **본문·쿼리로** 오기 때문에
(#4 이전의 임시 방편, `issue-18.md`·`issue-24.md`에 같은 항목이 있다) 가드가 볼 주체가 없다.
DB 제약으로는 "180일·5건"이라는 시간 조건을 걸 수 없다. 차단 대상이 `JobPostService.create`와
`ApplicationService.apply` **둘뿐**이라 서비스 두 곳에 판정 한 줄씩이면 끝난다.

**3. `Suspension`에 해제 컬럼 세 개를 처음부터 넣는다** (`ADR-PEN-4`의 선택지 중 "컬럼 추가")

§5.1이 유효 제재 판정 쿼리를 **`releasedAt IS NULL AND endAt > now()`**라고 이미 적어 두었다.
그 쿼리를 쓰는 것이 이 이슈이므로, 컬럼 없이 만들면 #33이 판정 쿼리 자체를 다시 쓰게 된다.
비어 있어도 되는 nullable 컬럼 셋을 지금 넣는 편이 싸다. **관리자 해제 화면과 API는 #33이다.**

### 경계값 해석 (판단이 갈렸던 지점)

| 물음                                | 답                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| 정확히 180일 전 경고는 창 안인가    | **안이다.** `occurredAt >= now − 180일`. "최근 180일 내"는 닫힌 구간으로 읽는다           |
| 제재 종료일 **정각**은 제재 중인가  | **아니다.** §5.1이 `endAt > now()`라고 썼다. 정각이면 이미 끝난 것이다                    |
| 이미 제재 중인데 6번째 경고가 오면  | **두 번째 `Suspension`을 만들지 않는다.** 5건 → 5일 단일 규칙이다 (PRD Out of Scope 참조) |
| 제재가 끝난 뒤 창 안 경고가 또 오면 | 창 안이 여전히 5건 이상이면 **새 제재가 생긴다.** 유효 제재가 없으니 막을 이유가 없다     |

### 타입

```typescript
// packages/shared/src/penalty.ts  (새 파일)

/** 경고를 세는 롤링 윈도우. 180일 (`spec-fixed.md` §5) */
export const PENALTY_WINDOW_DAYS = 180;
/** 이 건수 이상이면 제재다 (§5) */
export const PENALTY_SUSPEND_THRESHOLD = 5;
/** 제재 기간. 5일 (§5) */
export const SUSPENSION_DAYS = 5;

/** 제재가 내는 에러 코드. 이슈 AC에 적힌 문자열 그대로다 */
export const PENALTY_ERRORS = {
  SUSPENDED: 'PENALTY_SUSPENDED',
} as const;
export type PenaltyErrorCode =
  (typeof PENALTY_ERRORS)[keyof typeof PENALTY_ERRORS];

/** 경고를 세기 시작하는 시각. 이 시각 **이상**이 창 안이다 */
export function penaltyWindowStart(now: Date): Date;

/** 창 안 경고가 이만큼이면 제재인가 */
export function shouldSuspend(recentPenaltyCount: number): boolean;

/** 제재 종료 시각. 시작 +5일 */
export function suspensionEndAt(startAt: Date): Date;

/**
 * 지금 유효한 제재인가. **§5.1의 `releasedAt IS NULL AND endAt > now()`를
 * 그대로 옮긴 것이다.** 판정이 두 군데로 갈라지지 않게 여기 한 곳에만 둔다.
 */
export function isSuspensionActive(
  suspension: { endAt: Date; releasedAt: Date | null },
  now: Date,
): boolean;
```

```typescript
// apps/api/src/penalty/penalty-transaction.ts  (새 파일)
// `point/job-post-lock.ts`와 같은 자리 — 남의 트랜잭션 안에서 도는 헬퍼다

/** 저장된 제재 한 건 */
export interface SuspensionRecord {
  id: string;
  userId: string;
  startAt: Date;
  endAt: Date;
  releasedAt: Date | null;
}

/**
 * 경고 1건을 쓰고, 그 자리에서 제재 여부를 판정한다 (§5).
 *
 * 호출부의 트랜잭션 안에서 돌아야 하므로 `tx`를 받는다 — 경고만 커밋되고
 * 제재가 빠지면 **그걸 고쳐 줄 배치가 없다.**
 *
 * 새로 만든 제재를 돌려준다. 창 안 건수가 모자라거나 이미 제재 중이면 `null`이다.
 */
export async function recordPenalty(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    reason: PenaltyReason;
    jobPostId: string | null;
    now: Date;
  },
): Promise<SuspensionRecord | null>;
```

```typescript
// apps/api/src/penalty/suspension.reader.ts  (새 파일)

/** 제재 중인지 묻는 포트. 공고 등록(#12)과 지원(#17)이 이것만 본다 */
export interface SuspensionReader {
  /** 지금 유효한 제재. 없으면 null (§5.1) */
  findActive(userId: string, now: Date): Promise<SuspensionRecord | null>;
}

@Injectable()
export class PrismaSuspensionReader implements SuspensionReader {}
```

```typescript
// apps/api/src/application/application.service.ts  (변경)

/**
 * 경고를 남기는 쓰기의 결과. **제재가 함께 생겼는지 알아야** 알림을 보낸다 (§5).
 */
export interface PenalizedApplication {
  application: ApplicationRecord;
  /** 이 트랜잭션이 새로 만든 제재. 없으면 null */
  suspension: SuspensionRecord | null;
}

export interface ApplicationStore {
  // 반환 타입만 바뀐다. 인자는 그대로다
  cancel(input: { ... }): Promise<PenalizedApplication | 'STALE'>;
  markNoShow(input: { ... }): Promise<PenalizedApplication | 'STALE'>;
}

class ApplicationService {
  // 생성자에 `SuspensionReader`가 하나 는다
  constructor(store, jobPosts, profiles, notifications, suspensions);
  /** 제재 중이면 `PENALTY_SUSPENDED`로 막힌다 (#25 AC4) */
  apply(input: ApplyRequest): Promise<ApplicationSummary>;
}
```

```typescript
// apps/api/src/job-post/job-post.service.ts  (변경)

class JobPostService {
  // 생성자에 `SuspensionReader`가 하나 는다
  constructor(store, addresses, balances, accepted, notifications, suspensions);
  /** 제재 중이면 `PENALTY_SUSPENDED`로 막힌다 (#25 AC3) */
  create(
    employerId: string,
    input: CreateJobPostRequest,
  ): Promise<JobPostSummary>;
}
```

```prisma
// apps/api/prisma/schema.prisma  (추가)

/// 경고 누적으로 발생한 이용 제한. (이슈 #25, `spec-fixed.md` §5)
model Suspension {
  id      String   @id @default(cuid())
  userId  String
  startAt DateTime @default(now())
  endAt   DateTime

  /// 관리자가 만료 전에 조기 종료한 시각 (#33). 판정은 이것이 null인 것만 본다
  releasedAt    DateTime?
  releasedBy    String?
  releaseReason String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// 유효 제재 판정이 이 순서로 훑는다 (§5.1)
  @@index([userId, endAt])
}
```

`NotificationType`에 `SUSPENSION_STARTED` 한 값을 더한다. `SUSPENSION_RELEASED`(#33)와 짝이다.

### 에러 케이스

| 상황                      | 에러 코드           | HTTP |
| ------------------------- | ------------------- | ---- |
| 제재 중에 공고를 등록한다 | `PENALTY_SUSPENDED` | 403  |
| 제재 중에 알바에 신청한다 | `PENALTY_SUSPENDED` | 403  |

**403이다.** 404(없는 척)는 본인 계정 상태를 감추는 것이 되어 왜 막혔는지 알 수 없고,
409(상태 충돌)는 "잠시 뒤 다시"를 뜻한다 — 제재는 며칠짜리라 다시 눌러도 소용없다.
**"당신은 지금 이 행동을 할 수 없다"가 정확히 403이다.**

### 이 이슈에서 만들지 않는 것

| 항목                         | 이유                                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| 관리자 제재 해제 API·화면    | #33이다. 여기서는 판정이 `releasedAt`을 **읽기만** 한다             |
| 블랙리스트 목록 화면 (§11.4) | #33이다                                                             |
| 제재 상태를 보여주는 웹 화면 | AC 6개가 전부 서버 판정이다 (#20·#24와 같은 판단)                   |
| 제재 발생 **이메일**         | #37이 포트 뒤에서 붙인다. 여기서는 `NotificationPublisher`만 부른다 |
| 가중 점수제·제재 단계별 차등 | PRD Out of Scope. 5건 → 5일 단일 규칙                               |
| 별점·평점 (`Rating`)         | #26이다. 같은 PRD지만 다른 이슈다                                   |
| 제재 이력 조회 API           | AC에 없다. 회원 상세(#32)가 읽을 때 만든다                          |

---

## 테스트 시나리오

### 정상

- [x] [정상] `penaltyWindowStart` — should return the moment 180 days before now
- [x] [정상] `suspensionEndAt` — should end 5 days after the suspension starts
- [x] [정상] `recordPenalty` — should create a suspension ending 5 days later when the 5th penalty inside the window is recorded
- [x] [정상] `markNoShow` — should notify the member with SUSPENSION_STARTED when the 5th penalty suspends them
- [x] [정상] `cancel` — should suspend the applicant when a late cancel makes their 5th penalty
- [x] [정상] `create` — should create the job post when the member's suspension already ended
- [x] [정상] `apply` — should accept the application when the member's suspension was released early
- [x] [정상] `complete` — should settle normally when the employer is suspended
- [x] [정상] `accept` — should accept an applicant normally when the employer is suspended
- [x] [정상] `request` — should create an exchange request while the member is suspended

### 경계

- [x] [경계] `shouldSuspend` — should be false when only 4 penalties are inside the window
- [x] [경계] `shouldSuspend` — should be true when exactly 5 penalties are inside the window
- [x] [경계] `isSuspensionActive` — should be false when now is exactly the end time
- [x] [경계] `isSuspensionActive` — should be true one millisecond before the end time
- [x] [경계] `isSuspensionActive` — should be false when the suspension was released early
- [x] [경계] `recordPenalty` — should not create a suspension when only 2 of the 5 penalties are inside the window
- [x] [경계] `recordPenalty` — should count a penalty that occurred exactly at the window start
- [x] [경계] `recordPenalty` — should ignore a penalty that occurred one millisecond before the window start
- [x] [경계] `recordPenalty` — should not create a second suspension when a 6th penalty arrives while one is active
- [x] [경계] `findActive` — should ignore a suspension whose end time has passed
- [x] [경계] `findActive` — should ignore a suspension that was released early

### 예외

- [x] [예외] `create` — should throw PENALTY_SUSPENDED when the employer is suspended
- [x] [예외] `apply` — should throw PENALTY_SUSPENDED when the applicant is suspended
- [x] [예외] `POST /job-posts` — should answer 403 with PENALTY_SUSPENDED when the employer is suspended
- [x] [예외] `POST /applications` — should answer 403 with PENALTY_SUSPENDED when the applicant is suspended

---

## AC 대조

| AC                                                                                                   | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Given 최근 180일 내 경고 4건, When 5번째 경고가 쌓이면, Then `Suspension`이 생기고 종료일은 5일 뒤다 | `[정상] recordPenalty — suspension ending 5 days later on the 5th penalty`<br>`[경계] shouldSuspend — false at 4`<br>`[경계] shouldSuspend — true at exactly 5`<br>`[정상] suspensionEndAt — 5 days after the start`<br>`[정상] cancel — late cancel makes the 5th penalty`<br>`[경계] recordPenalty — no second suspension on the 6th penalty` |
| Given 190일 전 경고 3건 + 최근 2건, When 판정하면, Then 롤링 윈도우 밖이므로 제재되지 않는다         | `[경계] recordPenalty — only 2 of 5 inside the window`<br>`[정상] penaltyWindowStart — 180 days before now`<br>`[경계] recordPenalty — exactly at the window start counts`<br>`[경계] recordPenalty — one millisecond before is ignored`                                                                                                        |
| Given 제재 중인 회원, When 공고를 등록하면, Then `PENALTY_SUSPENDED`로 막힌다                        | `[예외] create — PENALTY_SUSPENDED`<br>`[예외] POST /job-posts — 403 PENALTY_SUSPENDED`                                                                                                                                                                                                                                                         |
| Given 제재 중인 회원, When 알바에 신청하면, Then 막힌다                                              | `[예외] apply — PENALTY_SUSPENDED`<br>`[예외] POST /applications — 403 PENALTY_SUSPENDED`                                                                                                                                                                                                                                                       |
| Given 제재 중인 회원, When 진행 중인 계약을 이행하거나 환전하면, Then 정상 동작한다                  | `[정상] complete — settles while the employer is suspended`<br>`[정상] accept — accepts while the employer is suspended`<br>`[정상] request — exchange request while suspended`                                                                                                                                                                 |
| Given 제재 종료일이 지난 회원, When 공고를 등록하면, Then 성공한다                                   | `[정상] create — succeeds when the suspension already ended`<br>`[경계] isSuspensionActive — false exactly at the end time`<br>`[경계] isSuspensionActive — true one millisecond before`<br>`[경계] findActive — ignores an ended suspension`                                                                                                   |

**AC에 없는데 추가한 시나리오** — 셋 다 `spec-fixed.md`가 요구하는 것이고 AC 문장만 빠져 있다.

- `[정상] markNoShow — SUSPENSION_STARTED 알림` — §5의 "제재 발생 시 … + 알림 발송". #24가 이 이슈로 넘겼다
- `[경계] isSuspensionActive — 조기 해제` / `[경계] findActive — 조기 해제` — §5.1의 판정 쿼리가 `releasedAt IS NULL`을 포함한다. 이게 없으면 #33이 해제해도 계속 막힌다
- `[정상] apply — 조기 해제된 회원은 지원할 수 있다` — 위와 같은 이유의 서비스 쪽 확인

**커버리지:** AC 6개 / 시나리오 25개 / 미커버 0개

---

## AC 독립 검증 (`@ac-verifier`)

**AC 6개 전부 ✅.** 구현한 사람과 다른 눈으로 코드와 테스트를 읽고, 통합 테스트를
실제로 돌려(58건, 실제 Postgres) 확인했다. 지적된 구멍은 없다.

AC5("이행·환전은 정상 동작")는 목으로 흉내 낸 것이 아니라 `complete`·`accept`·
`ExchangeRequestService`에 **제재 판정 코드 자체가 없다는 사실**로 확인됐다.

---

### ⚠️ 배포 전 재판정 — 제재 차단이 보는 회원 id도 본문에서 온다

`/security-review 25`에서 나왔다. **🟡 권장 수정이고 이 이슈에서 고치지 않는다.**

`POST /job-posts`와 `POST /applications`는 회원 id를 **본문에서 그대로 받는다.**
제재 판정은 그 id로 `Suspension`을 찾으므로, **제재당한 회원이 남의 id를 적어
보내면 차단을 지나갈 수 있다.** 다만 그 요청은 남의 이름으로 공고를 올리거나
지원하는 것이 되어, 제재 우회 이전에 **신원 위조 자체가 문제**다.

원인은 #25가 아니다. #4의 토큰 주체 배선이 끝나기 전까지 #12 이후 모든
엔드포인트가 같은 임시 방편을 쓰고 있고, `issue-18.md`·`issue-19.md`·
`issue-24.md`에 같은 항목이 이미 남아 있다.

|                 |                                                                                |
| --------------- | ------------------------------------------------------------------------------ |
| **해소 조건**   | #4의 토큰 주체가 본문 id를 대체하면 사라진다                                   |
| **재판정 시점** | **첫 배포 직전.** `issue-18.md`·`issue-19.md`·`issue-24.md`의 같은 항목과 함께 |

> 새 위험이 생긴 것은 아니다. **이미 열린 문에 자물쇠를 하나 더 단 것**이고,
> 문을 닫는 것은 #4다.

### 동시성 — 5번째 경고가 동시에 두 건 오면

제재가 둘 생길 수 있다. 지금 방어는 트랜잭션 안의 `findFirst` 하나뿐이고 DB 제약은
없다. 부분 유니크 인덱스(`WHERE releasedAt IS NULL AND endAt > now()`)는 시간 조건이
들어가 만들 수 없고, Prisma 스키마로도 표현되지 않는다.

**지금은 수용한다.** 경고가 쌓이는 경로는 취소(#20)와 노쇼(#24) 둘뿐이고, 둘 다
사람이 버튼을 눌러야 하며 같은 신청에 대한 연타는 이미 조건부 UPDATE가 걸러낸다.
서로 다른 두 신청의 취소가 밀리초 단위로 겹쳐야 재현된다. 제재가 둘 생겨도
차단 판정은 `findFirst`라 **동작은 같고**, 기간이 겹쳐 보일 뿐이다.

### 의존성 점검

`pnpm audit` 9건 전부 `security-exceptions.md`에 이미 판정돼 있다
(`deepmerge-ts` 1 · `mysql2` 2 · `fast-uri` 4 · `qs` 2). **새로 추가된 항목은
없다** — 이 이슈는 `package.json`도 잠금 파일도 건드리지 않았다.

### 타입·빌드

`pnpm build` → `pnpm typecheck` → `pnpm lint` 순서로 돌려 **오류 0건**이다.
(`apps/web`의 경고 1건은 이 이슈가 건드리지 않은 파일의 기존 항목이다.)
비밀값 노출, `console.log` 개인정보 출력, `.env` 커밋은 이번 변경 범위에 없다.
