# 이슈 #17 — 공고에 지원하고 철회한다

> GitHub: https://github.com/Ikara777/fixer/issues/17
> PRD: `docs/result/prd/application.md`
> 담당: B (김규현)
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 시그니처

### 관련 ADR

**`application` PRD의 ADR 5개는 아직 TODO다.** #17의 범위(지원·철회)는 그중 어느 것도
건드리지 않는다 — 정원 동시성(`ADR-APP-1`)은 #18, 재동의 전환(`ADR-APP-2`·`3`)은 #21,
완료 트리거(`ADR-APP-5`)는 #23에서 필요해진다.

그래서 이번 이슈는 **비어 있는 ADR을 채우지 않고**, 그 결정들이 나중에 어떻게 나든
충돌하지 않는 선까지만 만든다. 대신 이미 확정된 두 문서를 따른다.

| 따르는 것            | 내용                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| `spec-fixed.md` §4.2 | 상태 10개와 전이 (PRD 본문의 "상태 8개"는 다이어그램과 어긋난다 — 다이어그램이 맞다) |
| `spec-fixed.md` §4.5 | 중복 신청 방지는 유니크 제약으로                                                     |
| `ADR-JOB-3`          | **전이표에 없으면 거부한다.** job-post가 쓰는 방식을 신청에도 그대로 쓴다            |

`ADR-JOB-3`을 빌려오는 이유가 있다. AC5("`ACCEPTED`는 철회할 수 없다")는 결국
"그 전이가 표에 있느냐"는 질문이다. 메서드마다 `if (status === 'ACCEPTED')`를 흩뿌리면
#20이 취소를, #21이 재동의를 넣을 때 같은 분기를 각자 다시 쓰게 된다.

### 타입

```typescript
// packages/shared/src/application.ts

/** 신청 상태. (`spec-fixed.md` §4.2) */
export const APPLICATION_STATUSES = [
  /** 지원함. 아직 수락 전이라 자유롭게 철회할 수 있다 */
  'APPLIED',
  /** 구인자가 승인했다. **이 순간이 계약 체결** */
  'ACCEPTED',
  /** 구인자가 거절했다 (#19) */
  'REJECTED',
  /** 수락 전에 본인이 철회했다. **무패널티** (#17) */
  'WITHDRAWN',
  /** 공고 버전이 올라 재확인이 필요하다 (#21) */
  'PENDING_REACCEPT',
  /** 업무 완료 확인됨. PAYOUT 실행됨 (#23) */
  'COMPLETED',
  /** 무상 취소 창(수락 +2시간) 안의 취소 (#20) */
  'CANCELLED_FREE',
  /** 창을 넘긴 취소. Penalty 1건 (#20) */
  'CANCELLED_PENALTY',
  /** 바뀐 조건을 거절했다. **본인 잘못이 아니라 무패널티** (#22) */
  'CANCELLED_BY_VERSION_CHANGE',
  /** 무단 불참. Penalty 1건 (#24) */
  'NO_SHOW',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * 허용된 상태 전이. **표에 없는 전이는 거부된다** (`ADR-JOB-3`과 같은 방식).
 *
 * #17이 실제로 쓰는 것은 `APPLIED → WITHDRAWN`과 `WITHDRAWN → APPLIED`
 * 둘뿐이지만 표는 통째로 선언한다. 나머지 열 줄이 여기 있는 이유는 AC5
 * 때문이다 — "`ACCEPTED`는 철회할 수 없다"는 금지 규칙이고, 금지는 **표에
 * 없다는 사실**로 표현될 때만 한 곳에서 관리된다.
 *
 * `WITHDRAWN → APPLIED`가 **`spec-fixed.md` §4.2에 원래 없던 줄이다.**
 * 잘못 눌러 철회한 사람이 같은 공고에 다시 지원할 길을 막지 않기로 정하면서
 * 추가했고, 그 결정에 맞춰 §4.2의 다이어그램도 함께 고쳤다.
 */
export const APPLICATION_TRANSITIONS = [
  { from: 'APPLIED', to: 'ACCEPTED' },
  { from: 'APPLIED', to: 'REJECTED' },
  { from: 'APPLIED', to: 'WITHDRAWN' }, // ← #17
  { from: 'WITHDRAWN', to: 'APPLIED' }, // ← #17. 재지원 (§4.2 개정)
  { from: 'APPLIED', to: 'PENDING_REACCEPT' },
  { from: 'ACCEPTED', to: 'COMPLETED' },
  { from: 'ACCEPTED', to: 'CANCELLED_FREE' },
  { from: 'ACCEPTED', to: 'CANCELLED_PENALTY' },
  { from: 'ACCEPTED', to: 'NO_SHOW' },
  { from: 'ACCEPTED', to: 'PENDING_REACCEPT' },
  { from: 'PENDING_REACCEPT', to: 'APPLIED' },
  { from: 'PENDING_REACCEPT', to: 'ACCEPTED' },
  { from: 'PENDING_REACCEPT', to: 'CANCELLED_BY_VERSION_CHANGE' },
] as const satisfies readonly {
  from: ApplicationStatus;
  to: ApplicationStatus;
}[];

/** 이 전이가 표에 있나 */
export function canApplicationTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean;

/** 신청이 내는 에러 코드 */
export const APPLICATION_ERRORS = {
  /** 이미 지원한 공고다 (AC2 — 이슈에 적힌 문자열 그대로) */
  ALREADY_APPLIED: 'APPLICATION_ALREADY_APPLIED',
  /** 본인이 올린 공고다 (AC3) */
  OWN_JOB_POST: 'APPLICATION_OWN_JOB_POST',
  /** 공고가 모집 중이 아니다 */
  JOB_POST_NOT_OPEN: 'APPLICATION_JOB_POST_NOT_OPEN',
  /** 그런 신청이 없다 */
  NOT_FOUND: 'APPLICATION_NOT_FOUND',
  /** 본인 신청이 아니다 */
  NOT_OWNED: 'APPLICATION_NOT_OWNED',
  /** 표에 없는 상태 전이다. AC5의 서버 쪽 방어가 여기다 */
  INVALID_TRANSITION: 'APPLICATION_INVALID_TRANSITION',
  /** 그런 공고가 없다. **job-post의 코드를 재사용한다** */
  JOB_POST_NOT_FOUND: 'JOB_POST_NOT_FOUND',
} as const;

export type ApplicationErrorCode =
  (typeof APPLICATION_ERRORS)[keyof typeof APPLICATION_ERRORS];

export const applyRequestSchema = z.object({
  applicantId: z.string().min(1, { error: '지원자를 알 수 없습니다.' }),
  jobPostId: z.string().min(1, { error: '공고를 알 수 없습니다.' }),
});
export type ApplyRequest = z.infer<typeof applyRequestSchema>;

export const applicationSummarySchema = z.object({
  id: z.string(),
  jobPostId: z.string(),
  applicantId: z.string(),
  status: z.enum(APPLICATION_STATUSES),
  /**
   * 지원 시점의 공고 버전 (AC1). **화면용 숫자가 아니다** —
   * #21이 "내가 동의한 조건이 그 뒤에 바뀌었나"를 이 값으로 판정한다.
   */
  appliedVersion: z.number().int().min(1),
  createdAt: z.iso.datetime(),
});
export type ApplicationSummary = z.infer<typeof applicationSummarySchema>;
```

```typescript
// apps/api/src/application/application.service.ts

/** 신청이 던지는 도메인 에러 */
export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    readonly detail?: Record<string, number | string>,
  ) { ... }
}

/** 저장된 신청 한 건 */
export interface ApplicationRecord {
  id: string;
  jobPostId: string;
  applicantId: string;
  status: ApplicationStatus;
  appliedVersion: number;
  createdAt: Date;
}

export interface ApplicationStore {
  /**
   * 신청을 `APPLIED`로 만든다.
   *
   * 유니크 제약에 걸리면 `'DUPLICATE'`다 — 예외로 던지지 않는 이유는
   * **이것이 경합의 정상적인 결과**이기 때문이다. 지원 버튼을 연타하면
   * 서비스의 사전 조회는 둘 다 통과하고, 실제로 한 건만 살아남는 것은
   * 여기다 (§4.5).
   */
  create(input: {
    jobPostId: string;
    applicantId: string;
    appliedVersion: number;
  }): Promise<ApplicationRecord | 'DUPLICATE'>;

  findById(applicationId: string): Promise<ApplicationRecord | null>;

  /** 그 사람이 그 공고에 낸 신청. 없으면 null */
  findByApplicant(
    jobPostId: string,
    applicantId: string,
  ): Promise<ApplicationRecord | null>;

  /**
   * 상태를 옮긴다.
   *
   * **`expectedStatus`를 `WHERE`에 걸어 다시 확인한다.** 서비스의 조회와
   * 이 쓰기는 다른 트랜잭션이라, 그 사이에 구인자가 수락했을 수 있다.
   * 어긋나면 `'STALE'`이고 덮어쓰지 않는다 (#16과 같은 이유).
   */
  updateStatus(input: {
    applicationId: string;
    expectedStatus: ApplicationStatus;
    nextStatus: ApplicationStatus;
  }): Promise<ApplicationRecord | 'STALE'>;

  /**
   * 철회한 신청을 되살린다. `WITHDRAWN → APPLIED` (§4.2 개정).
   *
   * **`updateStatus`로 갈음할 수 없다.** 되살리면서 `appliedVersion`을
   * 지금 버전으로 다시 찍어야 하기 때문이다 — 철회한 뒤 공고가 바뀌었는데
   * 옛 버전이 남으면, 그 사람은 본 적 없는 조건에 동의한 것이 된다.
   * 상태와 버전이 **한 문장 안에서** 함께 바뀌어야 그 창이 안 생긴다.
   *
   * `WHERE status = 'WITHDRAWN'`이라 동시 재지원 2건 중 하나는 `'STALE'`이다.
   */
  reapply(input: {
    applicationId: string;
    appliedVersion: number;
  }): Promise<ApplicationRecord | 'STALE'>;
}

/**
 * 공고를 읽는 포트. **셋만 필요하다** — 상태·버전·주인.
 *
 * `JobPostService`를 통째로 주입하지 않는 이유는, 그러면 신청 도메인이
 * 공고의 등록·수정·취소에까지 닿게 되기 때문이다.
 */
export interface JobPostReader {
  /** 소프트 삭제된 공고는 **못 찾은 것으로 다룬다** (#14) */
  findForApplication(jobPostId: string): Promise<{
    id: string;
    employerId: string;
    status: JobPostStatus;
    version: number;
  } | null>;
}

/**
 * 지원과 철회. (이슈 #17, `spec-fixed.md` §4)
 *
 * 이 도메인이 "누가 누구와 무엇을 약속했는가"의 진실을 갖는다. #17은 그중
 * **약속이 생기는 순간과 수락 전에 무르는 순간**까지만 다룬다.
 */
@Injectable()
export class ApplicationService {
  constructor(
    private readonly store: ApplicationStore,
    private readonly jobPosts: JobPostReader,
  ) {}

  apply(input: ApplyRequest): Promise<ApplicationSummary>;

  /** 수락 전 철회. **경고가 쌓이지 않는다** (AC4) */
  withdraw(input: {
    applicantId: string;
    applicationId: string;
  }): Promise<ApplicationSummary>;

  /** 화면이 지원/철회/없음 중 무엇을 그릴지 정하는 데 쓴다 (AC5) */
  findMine(
    jobPostId: string,
    applicantId: string,
  ): Promise<ApplicationSummary | null>;
}

/** 상태를 옮긴다. **표에 없으면 거부한다** */
export function transition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): ApplicationStatus;
```

### 에러 케이스

| 상황                                | 에러 코드                        | HTTP |
| ----------------------------------- | -------------------------------- | ---- |
| 그런 공고가 없다 (소프트 삭제 포함) | `JOB_POST_NOT_FOUND`             | 404  |
| 공고가 `OPEN`이 아니다              | `APPLICATION_JOB_POST_NOT_OPEN`  | 409  |
| 본인 공고에 지원                    | `APPLICATION_OWN_JOB_POST`       | 403  |
| 이미 지원했다                       | `APPLICATION_ALREADY_APPLIED`    | 409  |
| 그런 신청이 없다                    | `APPLICATION_NOT_FOUND`          | 404  |
| 남의 신청을 철회                    | `APPLICATION_NOT_OWNED`          | 403  |
| `ACCEPTED`·`WITHDRAWN`을 철회 시도  | `APPLICATION_INVALID_TRANSITION` | 409  |
| 요청 형식이 틀렸다                  | (zod)                            | 400  |

### Prisma 모델

```prisma
/// 신청 1건. (이슈 #17, `spec-fixed.md` §4)
model Application {
  id             String            @id @default(cuid())
  jobPostId      String
  applicantId    String
  status         ApplicationStatus @default(APPLIED)
  /// 지원 시점의 공고 버전 (AC1). #21이 재동의 판정에 쓴다
  appliedVersion Int
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  jobPost   JobPost @relation(fields: [jobPostId], references: [id], onDelete: Cascade)
  applicant User    @relation(fields: [applicantId], references: [id], onDelete: Cascade)

  /// 중복 신청 방지 (§4.5). **경합에서 실제로 이기는 것은 이 제약이다**
  @@unique([jobPostId, applicantId])
  /// 구인자의 지원자 목록이 이 순서로 훑는다 (#18)
  @@index([jobPostId, status])
  /// 구직자의 "내 신청" 목록
  @@index([applicantId, status])
}
```

### HTTP — `@Controller('applications')`

| 메서드 | 경로                                               | 성공 코드 |
| ------ | -------------------------------------------------- | --------- |
| `POST` | `/applications` (본문: `applicantId`, `jobPostId`) | 201       |
| `POST` | `/applications/:id/withdraw` (본문: `applicantId`) | 200       |
| `GET`  | `/applications/me?jobPostId=&applicantId=`         | 200 / 404 |

회원 식별은 #12와 마찬가지로 아직 본문·쿼리로 받는다. #4의 토큰 주체로 바꾸는 것은
그 배선이 끝난 뒤다.

### 컴포넌트 Props

```typescript
// apps/web/src/app/job-posts/[id]/ApplyPanel.tsx
interface ApplyPanelProps {
  jobPostId: string;
}
```

`applicantId`는 패널 안의 입력칸으로 받는다 — `job-posts/new/page.tsx`가 `employerId`를
그렇게 받고 있고, 같은 임시 방편을 여기서만 다르게 할 이유가 없다.

상태에 따라 셋 중 하나를 그린다.

| 내 신청 상태        | 그리는 것                               |
| ------------------- | --------------------------------------- |
| 없음                | **지원하기** 버튼                       |
| `WITHDRAWN`         | **지원하기** 버튼 — 다시 지원할 수 있다 |
| `APPLIED`           | **지원 철회** 버튼                      |
| 그 외 (`ACCEPTED`…) | 상태 문구만. **버튼 없음** (AC5)        |

`WITHDRAWN`을 "없음"과 같은 칸에 두지 않고 따로 적은 이유는, 화면은 같아 보여도
**서버가 하는 일이 다르기 때문이다** — 새 행을 만드는 것과 있던 행을 되살리는 것.

### 판단이 갈렸던 지점

| 갈림길                                       | 고른 것       | 이유                                                                                                                                                              |
| -------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 전이표를 통째로 vs #17이 쓰는 것만           | 통째로        | AC5는 금지 규칙이고, 금지는 "표에 없다"로 표현될 때만 한 곳에서 관리된다                                                                                          |
| FK 이름 `userId`(§4.5 문구) vs `applicantId` | `applicantId` | `JobPost`가 `employerId`를 쓴다. §4.5의 `userId`는 약칭으로 본다                                                                                                  |
| 중복을 서비스 조회로만 vs 유니크 제약도      | 둘 다         | 조회는 친절한 에러용, 제약은 동시 요청용. 조회만 두면 §4.4가 설명한 그 틈이 그대로 생긴다                                                                         |
| `findMine` vs 공고 상세에 `myApplication`    | `findMine`    | 상세는 비로그인도 받는다. 사람마다 달라지는 값을 거기 넣으면 캐시가 안 된다                                                                                       |
| 철회 후 재지원 허용 vs 차단                  | **허용**      | 잘못 눌러 철회한 사람이 같은 공고에 영영 못 들어가는 것은 받아들일 수 없다. **`spec-fixed.md` §4.2에 `WITHDRAWN → APPLIED`를 추가**하고 다이어그램도 함께 고쳤다  |
| 재지원 시 새 행 vs 있던 행 되살리기          | 되살리기      | §4.5의 유니크 제약이 확정이라 새 행을 못 넣는다. 제약을 푸는 쪽은 "이 사람이 이 공고에 지원했나"가 한 행 조회에서 여러 행 조회로 바뀌어 #18·#21이 전부 영향받는다 |

### 이 이슈에서 만들지 않는 것

| 안 만드는 것                                               | 어디로                                      |
| ---------------------------------------------------------- | ------------------------------------------- |
| `acceptedAt` 컬럼, `JobPost.acceptedCount`, 조건부 UPDATE  | #18 (`ADR-APP-1`)                           |
| `AcceptedCounter` 어댑터를 실제 카운트로 교체 (지금 `0`)   | #18 — `ACCEPTED`가 생기기 전엔 어차피 0이다 |
| 제재 중 신청 차단 (§5)                                     | #25 — `Suspension` 모델이 아직 없다         |
| 구인자용 지원자 목록 화면                                  | #18                                         |
| `REJECTED`(#19)·취소(#20)·재동의(#21)·완료(#23)의 **실행** | 각 이슈. 표에 선언만 해 둔다                |

---

## 테스트 시나리오

### 정상

- [x] [정상] `apply` — should create an APPLIED application when a job seeker applies to an OPEN job post
- [x] [정상] `apply` — should store the job post's current version in appliedVersion
- [x] [정상] `withdraw` — should move the application from APPLIED to WITHDRAWN
- [x] [정상] `withdraw` — should create no Penalty row when an APPLIED application is withdrawn
- [x] [정상] `findMine` — should return the application when the applicant has applied to that job post
- [x] [정상] `findMine` — should return null when the applicant has never applied to that job post
- [x] [정상] `apply` — should revive the withdrawn application back to APPLIED when the applicant re-applies
- [x] [정상] `canApplicationTransition` — should allow APPLIED to WITHDRAWN
- [x] [정상] `canApplicationTransition` — should allow WITHDRAWN to APPLIED
- [x] [정상] `POST /applications` — should respond 201 with the created application summary
- [x] [정상] `POST /applications/:id/withdraw` — should respond 200 with status WITHDRAWN
- [x] [정상] `GET /applications/me` — should respond 200 with the summary when an application exists
- [x] [정상] `ApplyPanel` — should render a 지원하기 button when the applicant has no application
- [x] [정상] `ApplyPanel` — should render a 지원 철회 button when the application is APPLIED
- [x] [정상] `ApplyPanel` — should render a 지원하기 button again when the application is WITHDRAWN

### 경계

- [x] [경계] `apply` — should store version 3 in appliedVersion when applying to a job post edited twice
- [x] [경계] `apply` — should let exactly one of two concurrent applies succeed and reject the other with APPLICATION_ALREADY_APPLIED
- [x] [경계] `ApplicationStore.create` — should return DUPLICATE when the same applicant row already exists
- [x] [경계] `apply` — should throw APPLICATION_ALREADY_APPLIED when the store reports DUPLICATE because the pre-check missed a row inserted in between
- [x] [경계] `apply` — should refresh appliedVersion to the current version when re-applying after the job post was edited
- [x] [경계] `apply` — should keep the same application id when re-applying after withdrawing
- [x] [경계] `apply` — should let exactly one of two concurrent re-applies succeed and reject the other with APPLICATION_ALREADY_APPLIED
- [x] [경계] `apply` — should reject with APPLICATION_JOB_POST_NOT_OPEN when the job post is CLOSED
- [x] [경계] `withdraw` — should let exactly one of two concurrent withdrawals succeed and reject the other with APPLICATION_INVALID_TRANSITION
- [x] [경계] `withdraw` — should reject with APPLICATION_INVALID_TRANSITION when the store reports STALE because the employer accepted in between
- [x] [경계] `ApplyPanel` — should render neither a 지원하기 nor a 지원 철회 button when the application is ACCEPTED

### 예외

- [x] [예외] `apply` — should throw JOB_POST_NOT_FOUND when the job post does not exist
- [x] [예외] `apply` — should throw JOB_POST_NOT_FOUND when the job post is soft-deleted
- [x] [예외] `apply` — should throw APPLICATION_OWN_JOB_POST when the employer applies to their own job post
- [x] [예외] `apply` — should throw APPLICATION_ALREADY_APPLIED when the applicant already has an APPLIED application
- [x] [예외] `apply` — should throw APPLICATION_JOB_POST_NOT_OPEN when the job post is CANCELLED
- [x] [예외] `withdraw` — should throw APPLICATION_NOT_FOUND when no application has that id
- [x] [예외] `withdraw` — should throw APPLICATION_NOT_OWNED when the application belongs to someone else
- [x] [예외] `withdraw` — should throw APPLICATION_INVALID_TRANSITION when the application is ACCEPTED
- [x] [예외] `withdraw` — should throw APPLICATION_INVALID_TRANSITION when the application is already WITHDRAWN
- [x] [예외] `canApplicationTransition` — should reject ACCEPTED to WITHDRAWN
- [x] [예외] `POST /applications` — should respond 403 when the error code is APPLICATION_OWN_JOB_POST
- [x] [예외] `POST /applications` — should respond 409 when the error code is APPLICATION_ALREADY_APPLIED
- [x] [예외] `POST /applications` — should respond 400 when the body has no applicantId
- [x] [예외] `POST /applications/:id/withdraw` — should respond 409 when the application is ACCEPTED
- [x] [예외] `GET /applications/me` — should respond 404 when the applicant has no application

---

## AC 대조

| AC                                                                                                         | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1** 로그인한 구직자가 `OPEN` 공고에 지원하면 `APPLIED` 신청이 생기고 `appliedVersion`에 현재 버전 저장 | `[정상] apply — should create an APPLIED application ...`<br>`[정상] apply — should store the job post's current version ...`<br>`[경계] apply — should store version 3 ... edited twice`<br>`[정상] POST /applications — should respond 201 ...`<br>`[정상] ApplyPanel — should render a 지원하기 button ...`                   |
| **AC2** 이미 지원한 공고에 또 지원하면 `APPLICATION_ALREADY_APPLIED`로 막힌다                              | `[예외] apply — should throw APPLICATION_ALREADY_APPLIED when ... already has an APPLIED application`<br>`[경계] apply — ... two concurrent applies ...`<br>`[경계] apply — ... two concurrent re-applies ...`<br>`[예외] POST /applications — should respond 409 ...`                                                           |
| **AC3** 본인 공고에 지원하면 막힌다                                                                        | `[예외] apply — should throw APPLICATION_OWN_JOB_POST ...`<br>`[예외] POST /applications — should respond 403 ...`                                                                                                                                                                                                               |
| **AC4** `APPLIED`에서 철회하면 `WITHDRAWN`이 되고 **경고가 쌓이지 않는다**                                 | `[정상] withdraw — should move the application from APPLIED to WITHDRAWN`<br>`[정상] withdraw — should create no Penalty row ...`<br>`[정상] canApplicationTransition — should allow APPLIED to WITHDRAWN`<br>`[정상] POST /applications/:id/withdraw — should respond 200 ...`<br>`[정상] ApplyPanel — 지원 철회 button ...`    |
| **AC5** `ACCEPTED`에서 철회 버튼을 찾으면 없다 (취소는 #20)                                                | `[경계] ApplyPanel — should render neither a 지원하기 nor a 지원 철회 button when ... ACCEPTED`<br>`[예외] withdraw — should throw APPLICATION_INVALID_TRANSITION when the application is ACCEPTED`<br>`[예외] canApplicationTransition — should reject ACCEPTED to WITHDRAWN`<br>`[예외] POST /applications/:id/withdraw — 409` |

### AC에 없는데 추가한 시나리오

| 시나리오                                              | 왜 넣었나                                                                                                                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 공고 없음 / 소프트 삭제 → `JOB_POST_NOT_FOUND`        | 시그니처가 `findForApplication`에서 `null`을 받는 경로를 열어 뒀다. 검증 안 하면 Green에서 `null` 역참조가 그냥 통과한다. #14의 "소프트 삭제는 없는 것" 규칙도 여기 걸린다  |
| 공고가 `CLOSED`·`CANCELLED` → `JOB_POST_NOT_OPEN`     | AC1이 "`OPEN` 공고에 지원하면"이라 조건을 달았으므로 **`OPEN`이 아닐 때**가 그 문장의 경계다                                                                                |
| 남의 신청 철회 → `NOT_OWNED`, 없는 신청 → `NOT_FOUND` | 철회 API가 `applicationId`를 받는다. 소유 확인이 없으면 id만 알면 남의 신청을 철회할 수 있다                                                                                |
| 이미 `WITHDRAWN`인데 또 철회                          | 철회 버튼 연타. 두 번째가 조용히 성공하면 `updatedAt`만 갱신되어 이력이 흐려진다                                                                                            |
| 동시 지원 2건 / 동시 철회 2건                         | §4.4가 짚은 그 틈이다. 문장으로 지금 못 박지 않으면 나중에 테스트로 옮기기 어렵다                                                                                           |
| 철회 후 재지원 (되살리기 + 버전 갱신 + 동시성)        | AC에 없다. **`spec-fixed.md` §4.2에 `WITHDRAWN → APPLIED`를 추가하기로 하면서 들어왔다.** 버전을 다시 안 찍으면 본 적 없는 조건에 동의한 것이 되므로 그 시나리오가 핵심이다 |

| 유니크 제약과 `'DUPLICATE'` 분기를 **직접** 지나가는 시나리오 2개 | Green 후 커버리지가 잡아냈다. "동시 지원 2건 중 1건만 성공"은 통과했지만 두 요청이 실제로는 순차 실행되어, 두 번째가 **사전 조회**에서 막혔다. 유니크 제약과 `'DUPLICATE'` 분기는 한 번도 실행되지 않았고, 그 말은 **사전 조회를 지워도 그 테스트가 통과한다**는 뜻이다. §4.4가 지목한 틈이 그대로 남아 있었다 |

**커버리지:** AC 5개 / 시나리오 41개 / 미커버 0개

> **이 이슈가 확정 문서를 고친다.** `spec-fixed.md` §4.2와 `prd/application.md` §5의
> 상태머신 다이어그램에 `WITHDRAWN ──▶ APPLIED` 한 줄이 추가된다. 재지원을 허용하기로
> 한 결정의 결과이고, 두 문서와 코드가 어긋나면 다음 이슈가 어느 쪽을 믿을지 알 수 없다.
