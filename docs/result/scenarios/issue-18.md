# 이슈 #18 — 구인자가 지원자를 수락한다 (정원 제어)

> GitHub: https://github.com/Ikara777/fixer/issues/18
> PRD: `docs/result/prd/application.md`
> 담당: B (김규현)
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 시그니처

### 관련 ADR

**이 이슈가 `ADR-APP-1`(정원 초과 방지 동시성 제어)을 확정한다.** PRD §3에 TODO로
남아 있던 항목이고, "부분 취소 후 재수락 시 카운터 정합성을 어떻게 볼지에 따라 답이
달라질 수 있다"는 유보가 걸려 있었다. `spec-fixed.md` §4.4의 잠정안을 그대로
확정한다 — **비정규화(정규화된 원본 대신 계산 결과를 따로 들고 있는 것) 카운터
컬럼에 조건부 UPDATE**.

| 따르는 것              | 내용                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `spec-fixed.md` §4.4   | 조건부 UPDATE 한 문장으로 정원을 막는다. `SELECT ... FOR UPDATE`는 잠금 구간이 길어 기각      |
| `spec-fixed.md` §7     | 평점 표본 3건 미만이면 평균 대신 **"신규"**                                                   |
| `ADR-JOB-3` (#17 경유) | 전이표에 없으면 거부한다. `ACCEPTED → ACCEPTED`가 표에 없으므로 **중복 수락이 여기서 막힌다** |

유보였던 "부분 취소 후 카운터 정합성"에 대한 답은 **#18이 올리기만 하고, 내리는 쪽은
취소를 실제로 만드는 이슈가 같은 조건부 UPDATE로 내린다**는 것이다. #18에서 감소를
미리 만들면 호출자가 없는 코드가 남고, 그 코드는 #20이 무상 취소 창을 정하기 전까지
언제 불려야 하는지 알 수 없다.

### 스키마 변경

```prisma
model JobPost {
  /// 확정 인원. **비정규화 카운터다** (ADR-APP-1).
  ///
  /// 행을 세지 않고 이 값을 조건부 UPDATE로 올린다 —
  /// `WHERE acceptedCount < headcount`가 원자적이라 별도 락 없이 정원 초과가
  /// 막힌다 (§4.4). 행을 세는 방식은 두 트랜잭션이 똑같은 수를 보고 둘 다
  /// 통과하는 그 틈을 못 막는다.
  acceptedCount Int @default(0)
}

model Application {
  /// 수락 시각 (AC1). **#20의 무상 취소 창(수락 +2시간)이 이 값으로 판정한다**
  acceptedAt DateTime?
}
```

### 타입

```typescript
// packages/shared/src/application.ts

/** 수락 요청. 회원 식별은 #17과 같이 아직 본문으로 받는다 */
export const acceptApplicationRequestSchema = z.object({
  employerId: z.string().min(1, { error: '구인자를 알 수 없습니다.' }),
});
export type AcceptApplicationRequest = z.infer<
  typeof acceptApplicationRequestSchema
>;

/** 표본이 이보다 적으면 평균을 감춘다 (`spec-fixed.md` §7) */
export const RATING_MIN_SAMPLES = 3;

/**
 * 평점 표시 문구.
 *
 * **별 1개 받고 평점 1.0으로 낙인찍히는 것을 막는다** (§7). #26이 실제 별점을
 * 채우면 이 함수를 그대로 쓴다 — 규칙이 화면마다 따로 있으면 한쪽만 고쳐진다.
 */
export function formatRating(average: number | null, count: number): string;

/** 구인자가 보는 지원자 한 명 */
export const applicantItemSchema = z.object({
  applicationId: z.string(),
  applicantId: z.string(),
  applicantName: z.string(),
  status: z.enum(APPLICATION_STATUSES),
  appliedVersion: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  /** 구직자 평점 평균. 표본이 없으면 null (AC2) */
  ratingAsWorker: z.number().nullable(),
  /**
   * 표본 수. **화면이 "신규" 판정에 쓴다** — 평균만 주면 3건 미만인지
   * 알 수 없어 판정할 수 없다.
   */
  ratingCount: z.number().int().min(0),
});
export type ApplicantItem = z.infer<typeof applicantItemSchema>;

/** 지원자 목록. **정원 상태를 함께 준다** — 화면이 "3 / 6"을 그린다 */
export const applicantListSchema = z.object({
  jobPostId: z.string(),
  headcount: z.number().int().min(1),
  acceptedCount: z.number().int().min(0),
  applicants: z.array(applicantItemSchema),
});
export type ApplicantList = z.infer<typeof applicantListSchema>;

/** 구인자에게 보이는 상태. #19가 `REJECTED`를 더한다 */
export const EMPLOYER_VISIBLE_STATUSES = ['APPLIED', 'ACCEPTED'] as const;

// APPLICATION_ERRORS에 추가
/** 정원이 찼다 (AC3 — 이슈에 적힌 문자열 그대로) */
HEADCOUNT_FULL: 'APPLICATION_HEADCOUNT_FULL',
/** 그 공고의 구인자가 아니다 */
NOT_EMPLOYER: 'APPLICATION_NOT_EMPLOYER',

// applicationSummarySchema에 추가
/**
 * 수락 시각 (AC1). `.default(null)`인 이유는 #17이 만든 응답 객체를
 * 고치지 않고도 이 스키마를 통과시키기 위해서다.
 */
acceptedAt: z.iso.datetime().nullable().default(null),
```

```typescript
// apps/api/src/application/application.service.ts

/** 확장: 정원 판정에 headcount·acceptedCount가 더 필요하다 */
export interface JobPostReader {
  findForApplication(jobPostId: string): Promise<{
    id: string;
    employerId: string;
    status: JobPostStatus;
    version: number;
    headcount: number; // ← #18
    acceptedCount: number; // ← #18
  } | null>;
}

export interface ApplicationStore {
  // … #17의 5개(create·findById·findByApplicant·updateStatus·reapply) 그대로 …

  /**
   * 수락을 **한 트랜잭션으로** 확정한다 (ADR-APP-1).
   *
   * 두 문장이 모두 1행을 갱신했을 때만 커밋한다 (§4.4).
   *
   * 1. `Application SET ACCEPTED, acceptedAt WHERE id=? AND status='APPLIED'`
   * 2. `JobPost SET acceptedCount+1 WHERE id=? AND acceptedCount < headcount`
   *
   * **신청 갱신이 먼저다.** 카운터를 먼저 올리면, 정원이 찬 공고에서 이미
   * 수락된 신청을 또 수락했을 때 "정원이 찼다"고 답하게 된다 — 실제 이유는
   * 중복 수락인데. 순서를 바꾸면 두 실패가 서로 구분된다.
   *
   * `'STALE'` = `APPLIED`가 아니다 (중복 수락·철회됨).
   * `'FULL'` = 정원이 찼다. **둘 다 아무것도 커밋하지 않는다.**
   */
  accept(input: {
    applicationId: string;
    jobPostId: string;
    acceptedAt: Date;
  }): Promise<ApplicationRecord | 'STALE' | 'FULL'>;

  /** 구인자의 지원자 목록. 오래 지원한 순 (선착순 표시지 선착순 수락은 아니다) */
  listByJobPost(
    jobPostId: string,
    statuses: readonly ApplicationStatus[],
  ): Promise<ApplicationRecord[]>;
}

/**
 * 지원자의 이름과 평점을 묻는 포트.
 *
 * `Rating`(#26)이 아직 없다. #12의 `AcceptedCounter`와 같은 방식으로 포트를
 * 지금 만들고, 어댑터는 이름만 진짜로 읽고 평점은 표본 0으로 돌려준다 —
 * **전원 "신규"가 보이는 것이 화면이 안 나오는 것보다 낫다.** #26이 어댑터만 채운다.
 */
export interface ApplicantProfileReader {
  profilesOf(
    applicantIds: readonly string[],
  ): Promise<
    Map<
      string,
      { name: string; ratingAsWorker: number | null; ratingCount: number }
    >
  >;
}

export class ApplicationService {
  constructor(
    private readonly store: ApplicationStore,
    private readonly jobPosts: JobPostReader,
    private readonly profiles: ApplicantProfileReader, // ← #18
  ) {}

  // … #17의 apply·withdraw·findMine 그대로 …

  /** 구인자가 지원자 한 명을 수락한다. **이 순간이 계약 체결** (#18) */
  accept(input: {
    employerId: string;
    applicationId: string;
  }): Promise<ApplicationSummary>;

  /** 구인자가 보는 지원자 목록 (AC1·AC2) */
  listForEmployer(input: {
    employerId: string;
    jobPostId: string;
  }): Promise<ApplicantList>;
}
```

### 에러 케이스

| 상황                                          | 에러 코드                        | HTTP |
| --------------------------------------------- | -------------------------------- | ---- |
| 그런 신청이 없다                              | `APPLICATION_NOT_FOUND`          | 404  |
| 공고가 없다 / 소프트 삭제됐다                 | `JOB_POST_NOT_FOUND`             | 404  |
| 그 공고의 구인자가 아니다                     | `APPLICATION_NOT_EMPLOYER`       | 403  |
| 공고가 `OPEN`이 아니다                        | `APPLICATION_JOB_POST_NOT_OPEN`  | 409  |
| `APPLIED`가 아닌 신청을 수락 (중복 수락 포함) | `APPLICATION_INVALID_TRANSITION` | 409  |
| 정원이 찼다                                   | `APPLICATION_HEADCOUNT_FULL`     | 409  |
| 요청 형식이 틀렸다                            | (zod)                            | 400  |

### HTTP — `@Controller('applications')`

| 메서드 | 경로                                            | 성공 코드 |
| ------ | ----------------------------------------------- | --------- |
| `POST` | `/applications/:id/accept` (본문: `employerId`) | 200       |
| `GET`  | `/applications?jobPostId=&employerId=`          | 200       |

### 컴포넌트 Props

```typescript
// apps/web/src/app/job-posts/[id]/applicants/ApplicantList.tsx
interface ApplicantListProps {
  jobPostId: string;
}
```

`employerId`는 패널 안의 입력칸으로 받는다 — #17의 `ApplyPanel`이 `applicantId`를
그렇게 받고 있고, 같은 임시 방편을 여기서만 다르게 할 이유가 없다.

지원자 행마다 **이름 · 평점(`formatRating`) · 상태 · 수락 버튼**을 그린다.

| 조건                           | 수락 버튼   |
| ------------------------------ | ----------- |
| 상태가 `APPLIED`이고 자리 있음 | 있음        |
| 상태가 `ACCEPTED`              | 없음        |
| `acceptedCount === headcount`  | 없음 (전원) |

### 함께 바뀌는 것

`job-post.module.ts`의 `countAccepted: () => Promise.resolve(0)` 스텁을
**`JobPost.acceptedCount` 컬럼을 읽는 어댑터로 교체한다.** #17이 "#18에서 교체"로
미뤄 둔 항목이고, 교체하지 않으면 공고 상세가 수락 뒤에도 계속 "0 / 6"을 보여준다.

### 판단이 갈렸던 지점

| 갈림길                                     | 고른 것              | 이유                                                                                                                                                                |
| ------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 카운터 컬럼 vs `COUNT(*)` 서브쿼리         | **카운터 컬럼**      | 서브쿼리 count는 READ COMMITTED에서 두 트랜잭션이 똑같이 5를 보고 둘 다 통과한다 — §4.4가 그린 그림 그대로다. 컬럼이라야 UPDATE가 락을 잡은 뒤 조건을 다시 평가한다 |
| 카운터가 진실 vs 행 개수가 진실            | **카운터**           | 둘을 다 두면 화면에 보이는 수와 정원을 막는 수가 갈릴 수 있다. `countAccepted`도 컬럼을 읽게 통일하고, **둘이 일치하는지를 통합 테스트로 못 박는다**                |
| 신청 갱신 먼저 vs 카운터 먼저              | **신청 먼저**        | 정원이 찬 공고에서 중복 수락했을 때 "정원이 찼다"가 아니라 진짜 이유가 나온다                                                                                       |
| 평점 컬럼 지금 추가 vs 포트만              | **포트만**           | `User.ratingAsPoster/AsWorker` 집계는 #26의 몫이다. 컬럼을 지금 넣으면 채우는 코드가 없는 컬럼이 남는다                                                             |
| `acceptedAt` 필수 vs `.default(null)`      | **`.default(null)`** | #17의 컨트롤러 테스트가 만드는 응답 객체를 고치지 않아도 된다. 남의 단계 테스트를 건드리지 않는 값이 더 크다                                                        |
| 목록에 `REJECTED`·`WITHDRAWN` 포함 vs 제외 | **제외**             | #18에 `REJECTED`를 만드는 코드가 없다. #19가 그 상태를 만들면서 `EMPLOYER_VISIBLE_STATUSES`에 한 줄을 더한다                                                        |

### 이 이슈에서 만들지 않는 것

| 안 만드는 것                                | 어디로                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **정원이 차면 공고를 `CLOSED`로 자동 전환** | #20. 취소가 생기면 되열어야 하는데, 그 규칙이 정해지기 전에 닫으면 되열 방법이 없다. #18의 AC에도 없다 |
| 카운터 **감소** (취소·거절·재동의)          | #19·#20·#21. **#18은 올리기만 한다**                                                                   |
| 수락 알림 (구직자에게)                      | #33 (`notification`)                                                                                   |
| 실제 별점 집계와 `User.ratingAs*` 컬럼      | #26 — 지금은 전원 "신규"                                                                               |
| 거절                                        | #19                                                                                                    |

---

## 테스트 시나리오

### 정상

- [x] [정상] `accept` — should move the application from APPLIED to ACCEPTED
- [x] [정상] `accept` — should stamp acceptedAt when the application is accepted
- [x] [정상] `accept` — should increase the job post's acceptedCount by 1
- [x] [정상] `canApplicationTransition` — should allow APPLIED to ACCEPTED
- [x] [정상] `formatRating` — should return the average when the sample count is 5
- [x] [정상] `listForEmployer` — should return the applicants of the employer's own job post
- [x] [정상] `listForEmployer` — should return the job post's headcount and acceptedCount alongside the applicants
- [x] [정상] `listForEmployer` — should order applicants by createdAt ascending
- [x] [정상] `listForEmployer` — should include each applicant's name and rating sample count
- [x] [정상] `PrismaAcceptedCounter` — should return the job post's acceptedCount column
- [x] [정상] `POST /applications/:id/accept` — should respond 200 with status ACCEPTED
- [x] [정상] `GET /applications` — should respond 200 with the applicant list
- [x] [정상] `ApplicantList` — should render a 수락 button for an APPLIED applicant
- [x] [정상] `ApplicantList` — should render 신규 when the applicant has fewer than 3 ratings
- [x] [정상] `ApplicantList` — should render the average when the applicant has 3 or more ratings

### 경계

- [x] [경계] `accept` — should succeed when exactly one seat is left because acceptedCount is headcount minus 1
- [x] [경계] `accept` — should throw APPLICATION_HEADCOUNT_FULL when acceptedCount already equals headcount
- [x] [경계] `accept` — should let exactly one of two concurrent accepts succeed when one seat is left
- [x] [경계] `accept` — should leave acceptedCount equal to headcount after two concurrent accepts race for the last seat
- [x] [경계] `accept` — should not increase acceptedCount when the same application is accepted twice
- [x] [경계] `accept` — should let exactly one of two concurrent accepts of the same application succeed
- [x] [경계] `ApplicationStore.accept` — should return FULL when acceptedCount already equals headcount
- [x] [경계] `ApplicationStore.accept` — should return STALE when the application is not APPLIED
- [x] [경계] `ApplicationStore.accept` — should leave acceptedCount unchanged when it returns STALE
- [x] [경계] `ApplicationStore.listByJobPost` — should return rows ordered by createdAt ascending
- [x] [경계] `ApplicationStore.listByJobPost` — should exclude statuses that were not asked for
- [x] [정상] `PrismaApplicantProfileReader` — should return every applicant as 신규 until #26 fills the rating aggregate
- [x] [경계] `acceptedCount` — should equal the number of ACCEPTED rows after several accepts
- [x] [경계] `formatRating` — should return 신규 when the sample count is exactly 2
- [x] [경계] `formatRating` — should return the average when the sample count is exactly 3
- [x] [경계] `formatRating` — should return 신규 when the sample count is 0
- [x] [경계] `listForEmployer` — should return an empty applicants array when nobody has applied
- [x] [경계] `listForEmployer` — should exclude WITHDRAWN applications from the list
- [x] [경계] `ApplicantList` — should render no 수락 button when acceptedCount equals headcount

### 예외

- [x] [예외] `accept` — should throw APPLICATION_NOT_FOUND when no application has that id
- [x] [예외] `accept` — should throw JOB_POST_NOT_FOUND when the job post is soft-deleted
- [x] [예외] `accept` — should throw APPLICATION_NOT_EMPLOYER when the caller does not own the job post
- [x] [예외] `accept` — should throw APPLICATION_JOB_POST_NOT_OPEN when the job post is CANCELLED
- [x] [예외] `accept` — should throw APPLICATION_INVALID_TRANSITION when the application is already ACCEPTED
- [x] [예외] `accept` — should throw APPLICATION_INVALID_TRANSITION when the application is WITHDRAWN
- [x] [예외] `canApplicationTransition` — should reject ACCEPTED to ACCEPTED
- [x] [예외] `listForEmployer` — should throw APPLICATION_NOT_EMPLOYER when the caller does not own the job post
- [x] [예외] `listForEmployer` — should throw JOB_POST_NOT_FOUND when the job post does not exist
- [x] [예외] `POST /applications/:id/accept` — should respond 403 when the error code is APPLICATION_NOT_EMPLOYER
- [x] [예외] `POST /applications/:id/accept` — should respond 409 when the error code is APPLICATION_HEADCOUNT_FULL
- [x] [예외] `POST /applications/:id/accept` — should respond 400 when the body has no employerId
- [x] [예외] `GET /applications` — should respond 403 when the caller does not own the job post

---

## AC 대조

| AC                                                                                    | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1** 한 명을 수락하면 `ACCEPTED`가 되고 `acceptedAt`이 찍히며 확정 인원이 1 는다   | `[정상] accept — should move ... APPLIED to ACCEPTED`<br>`[정상] accept — should stamp acceptedAt ...`<br>`[정상] accept — should increase ... acceptedCount by 1`<br>`[정상] canApplicationTransition — should allow APPLIED to ACCEPTED`<br>`[정상] POST /applications/:id/accept — 200 ...`                                                |
| **AC2** 지원자 목록에서 구직자 평점이 보인다 (표본 3건 미만이면 "신규") ⚠️ **절반만** | `[정상] listForEmployer — should include each applicant's name and rating sample count`<br>`[정상] formatRating — average when count is 5`<br>`[경계] formatRating — 신규 when count is exactly 2 / 0`<br>`[경계] formatRating — average when count is exactly 3`<br>`[정상] ApplicantList — 신규 / 평균`                                     |
| **AC3** 정원이 찬 공고에 더 수락하면 `APPLICATION_HEADCOUNT_FULL`로 막힌다            | `[경계] accept — should throw APPLICATION_HEADCOUNT_FULL when acceptedCount already equals headcount`<br>`[경계] ApplicationStore.accept — should return FULL ...`<br>`[예외] POST /applications/:id/accept — 409 ...`<br>`[경계] ApplicantList — no 수락 button when acceptedCount equals headcount`                                         |
| **AC4** 정원 1자리에 **수락 요청 2개를 동시에** 보내면 정확히 1개만 성공한다          | `[경계] accept — should let exactly one of two concurrent accepts succeed when one seat is left`<br>`[경계] accept — should leave acceptedCount equal to headcount after two concurrent accepts race`<br>`[경계] accept — should succeed when exactly one seat is left`                                                                       |
| **AC5** 이미 수락된 신청을 또 수락해도 확정 인원이 중복으로 늘지 않는다               | `[경계] accept — should not increase acceptedCount when the same application is accepted twice`<br>`[경계] accept — should let exactly one of two concurrent accepts of the same application succeed`<br>`[예외] accept — INVALID_TRANSITION when already ACCEPTED`<br>`[예외] canApplicationTransition — should reject ACCEPTED to ACCEPTED` |

### AC에 없는데 추가한 시나리오

| 시나리오                                                        | 왜 넣었나                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 남의 공고 수락·조회 → `APPLICATION_NOT_EMPLOYER`                | 수락 API가 `applicationId`만 받는다. 주인 확인이 없으면 id만 알면 **남의 공고에 사람을 확정시킬 수 있다.** 돈이 잠긴 쪽은 그 공고 주인이다                                                                         |
| 신청 없음 / 공고 소프트 삭제 → `NOT_FOUND`                      | #17이 열어 둔 `null` 경로다. 검증 안 하면 Green에서 `null` 역참조가 그냥 통과한다. #14의 "소프트 삭제는 없는 것" 규칙도 여기 걸린다                                                                                |
| 공고가 `CANCELLED` → `JOB_POST_NOT_OPEN`                        | 취소된 공고는 `RELEASE`로 돈이 이미 풀렸다. 거기서 수락하면 지급할 돈이 없는 계약이 생긴다                                                                                                                         |
| `WITHDRAWN` 신청을 수락 → `INVALID_TRANSITION`                  | 철회한 사람을 구인자가 확정시키는 경로. 전이표에 `WITHDRAWN → ACCEPTED`가 없다는 사실이 실제로 지켜지는지 확인한다                                                                                                 |
| **`ApplicationStore.accept` — STALE일 때 `acceptedCount` 불변** | **트랜잭션 롤백을 직접 증명하는 시나리오다.** 신청 갱신이 실패했는데 카운터만 올라가면 정원이 아무도 안 쓴 자리로 채워진다. `$transaction`을 빼도 서비스 레벨 테스트는 전부 통과하므로 여기서 잡는다               |
| **`acceptedCount` == `ACCEPTED` 행 수**                         | 카운터를 진실로 삼기로 한 결정의 대가다. 둘이 갈리면 화면에 보이는 수와 정원을 막는 수가 달라진다. 컬럼만 올리고 상태를 안 바꾸는 구현이 이 테스트에서만 걸린다                                                    |
| `listForEmployer` — 빈 목록 / `WITHDRAWN` 제외 / 정렬           | 목록의 경계다. 0건에서 터지지 않는지, 철회한 사람이 다시 뜨지 않는지                                                                                                                                               |
| **`ApplicationStore.listByJobPost` — 정렬 / 상태 필터**         | Green 후 커버리지가 잡아냈다. 위의 목록 시나리오 3개가 전부 **가짜 저장소**만 지나가서, Prisma 쪽 `orderBy`를 지우거나 `where`의 상태 필터를 지워도 전부 통과했다. #17이 `'DUPLICATE'`에서 잡은 것과 같은 구멍이다 |
| `PrismaAcceptedCounter` — 컬럼을 읽는다                         | #17이 미뤄 둔 스텁 교체다. 교체를 안 해도 #18의 다른 테스트는 전부 통과하므로, 이 시나리오가 없으면 공고 상세가 계속 "0 / 6"인 채로 이슈가 닫힌다                                                                  |
| `POST .../accept` — `employerId` 없으면 400                     | 컨트롤러가 본문에서 문자열을 꺼낸다. 없을 때 500이 나면 원인을 화면에서 알 수 없다                                                                                                                                 |

**커버리지:** AC 5개 / 시나리오 47개 / 미커버 0개

### ⚠️ 배포 전 재판정 — `GET /applications`가 제3자 이름을 인증 없이 내준다

`/security-review 18`에서 나왔다. **🟡 권장 수정이고 이 이슈에서 고치지 않는다.**

`listForEmployer`는 `employerId`를 **쿼리스트링에서 그대로 받는다.** 소유 확인
(`mustOwn`)은 그 값과 공고 주인을 비교할 뿐이라, **남의 `employerId`를 넣으면 그
사람 공고의 지원자 실명 목록이 나온다.**

원인은 #18이 아니다. #4의 토큰 주체 배선이 끝나기 전까지 #12 이후 모든
엔드포인트가 같은 임시 방편을 쓰고 있고, 시그니처 게이트에서 그대로 따르기로
합의한 내용이다.

**그런데 #18이 성격을 바꾼다.** 지금까지 이 방식으로 새는 것은 *본인 정보*였다 —
`/applications/me`는 `applicantId`가 곧 본인이다. **#18이 처음으로 제3자의
개인정보(지원자 이름)를 이 경로에 올린다.** 배포 시점의 위험이 한 단계 올라간다.

|                 |                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------- |
| **해소 조건**   | #4의 토큰 주체가 `employerId`를 대체하면 사라진다                                                  |
| **재판정 시점** | **첫 배포 직전.** `security-exceptions.md` 4번(`qs`)과 같은 성격이다 — 날짜가 아니라 사건이 먼저다 |

> 배포하기 전에 이 줄을 반드시 읽을 것. 지금 안 고치는 근거는 "노출 면이 로컬뿐"
> 하나이고, 배포되는 순간 그 근거가 사라진다.

---

### AC2를 범위 밖으로 인정한다 (`@ac-verifier` 판정 ⚠️)

`@ac-verifier`가 4단계에서 짚었다. **AC2는 절반만 충족된다.**

| AC2의 두 부분                | 상태                                        |
| ---------------------------- | ------------------------------------------- |
| "표본 3건 미만이면 **신규**" | ✅ 충족. 실제 화면에 그대로 보인다          |
| "구직자 **평점이 표시**된다" | ⚠️ 코드는 있으나 **지금 아무도 볼 수 없다** |

`formatRating`의 평균 분기는 운영 경로에서 절대 발동하지 않는다.
`PrismaApplicantProfileReader.profilesOf`가 항상 `ratingCount: 0`을 돌려주므로
화면에는 전원 "신규"만 뜬다. 평균이 나오는 테스트는 전부 **가짜 프로필이나 순수
함수 직접 호출**로만 지나간다.

**그럼에도 #18에서 메우지 않는다.** 평균을 실제로 표시하려면 `Rating` 테이블,
`User.ratingAsPoster`/`ratingAsWorker` 컬럼, 집계 로직이 필요한데 **그게 #26의
전부다.** 여기서 만들면 평점 도메인을 통째로 앞당기는 것이고, 이슈 크기 M을 크게
넘긴다. 시그니처 게이트에서 이미 `AcceptedCounter`(#12) 선례를 따라 "포트만 만들고
#26이 어댑터를 채운다"로 합의한 내용이기도 하다.

대신 **지금 상태를 테스트로 못 박았다.**

```
[정상] PrismaApplicantProfileReader — should return every applicant as 신규
       until #26 fills the rating aggregate
```

이 테스트는 두 가지를 한다. 어댑터가 이름을 **진짜로 읽는지** 확인하고(이게 없으면
User 조회가 통째로 틀려도 아무 테스트가 안 깨진다), #26이 평점을 채우는 순간
**깨지면서 고칠 자리를 알려준다.**

> **#26을 시작할 때 이 줄을 먼저 읽을 것.** AC2가 그때 완성된다.

> **이 이슈가 PRD를 고친다.** `docs/result/prd/application.md` §3의 `ADR-APP-1` 줄이
> TODO에서 **확정**으로 바뀐다. 결정 내용과 기각한 대안(`SELECT FOR UPDATE`,
> `COUNT(*)` 서브쿼리)을 그 자리에 적는다. 표에 TODO로 남겨 두면 #20이 취소를 만들 때
> 카운터를 내려야 하는지 세어야 하는지 다시 판단하게 된다.
