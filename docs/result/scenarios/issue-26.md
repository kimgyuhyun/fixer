# 이슈 #26 — 거래 후 별점을 남긴다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/26
> PRD: `docs/result/prd/penalty-rating.md`
> 담당: B (김규현)
> 상태: 구현 완료 (Green)

---

## 시그니처

### 관련 ADR

PRD `penalty-rating.md` §3의 표는 아직 `TODO`다. **하지만 이 이슈가 쓰는 값과 구조는
`spec-fixed.md` §7이 이미 못 박아 두었다.** 여기서 다시 정하지 않는다.

| 따르는 것            | 내용                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `spec-fixed.md` §7   | 공고가 `COMPLETED`된 거래에 한해 **양방향으로 별점 1~5만** 입력. 텍스트 후기·신고·블랙리스트 없음 |
| `spec-fixed.md` §7   | **`@@unique([applicationId, raterId])`** — 거래당 1회                                             |
| `spec-fixed.md` §7   | `User.ratingAsPoster` / `User.ratingAsWorker` 에 **평균과 카운트를 캐시**                         |
| `spec-fixed.md` §7   | **표본 3건 미만이면 평균 대신 "신규"**                                                            |
| `spec-fixed.md` §2.1 | 평점은 **역할별로 분리 집계**한다. "고용주로서"와 "일꾼으로서"의 신뢰도는 별개다                  |
| #18 `application.ts` | `RATING_MIN_SAMPLES`와 `formatRating`이 **이미 있다.** 표시 규칙을 새로 만들지 않는다             |
| #18 `issue-18.md`    | `ApplicantProfileReader`는 "#26이 어댑터만 채운다"고 적힌 임시 구현체다                           |
| #23 (`COMPLETED`)    | 완료 확인이 `Application`을 `COMPLETED`로 옮긴다. **별점 자격은 그 상태다**                       |

### 이 이슈가 내리는 결정 두 가지

PRD §3의 `ADR-PEN-3`(평점 집계 캐시 갱신 전략)이 비어 있어 보이지만, **선택지는 이미 좁혀져 있다.**

**1. 캐시는 별점이 들어오는 그 트랜잭션 안에서 다시 집계해 쓴다** (`ADR-PEN-3`)

세 선택지 중 "조회 시 계산"은 §7이 **캐시**라고 못 박은 순간 빠진다 — 조회 때 세는 것은 캐시가
아니다. 남은 것은 증분 갱신(`sum += score; count += 1`)과 즉시 재집계다.

**즉시 재집계를 고른다.** 증분은 값이 한 번 틀어지면 되돌릴 근거가 없다 — 원장(`PointTransaction`)이
합계를 진실로 두고 `cachedBalance`를 표시용으로만 쓰는 것(`ADR-PAY-1`)과 같은 판단이다. 재집계
비용은 문제가 되지 않는다. **별점은 거래당 1회**라 사람당 행 수가 거래 수를 넘지 않고,
`(rateeId, rateeRole)` 인덱스로 한 번에 센다.

**삽입과 같은 트랜잭션에 둔다.** 나누면 `Rating` 행은 커밋됐는데 캐시가 옛 값인 상태가 남고,
**그걸 고쳐 줄 배치가 없다**(§8.1에 그런 잡이 없다). #25가 경고와 제재를 한 트랜잭션에 둔 이유와 같다.

**2. 평가받는 사람의 역할을 `Rating` 행에 적어 둔다**

역할을 행마다 적지 않으면, 집계할 때마다 `Application → JobPost`를 타고 들어가 "이 사람이
그 거래에서 구인자였나"를 되짚어야 한다. 그 조인은 공고가 지워지거나 주인이 바뀌면 답이
달라지는데, **별점은 그 거래 그 시점의 평가**라 나중에 답이 달라지면 안 된다.
`Application.appliedVersion`을 남기는 것(`ADR-JOB-1`)과 같은 이유다.

### 경계값 해석 (판단이 갈렸던 지점)

| 물음                                             | 답                                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| "`COMPLETED` 거래"는 공고 상태인가 신청 상태인가 | **신청 상태다.** 같은 공고에서 한 사람은 완료, 한 사람은 노쇼일 수 있다 (#24). 평가 자격은 사람마다 갈린다      |
| 상대가 같은 거래에 별점을 주는 것도 막히는가     | **아니다.** 유니크는 `(applicationId, raterId)`다. 양방향 입력이 §7의 요구다                                    |
| 표본이 정확히 3건이면 평균인가 "신규"인가        | **평균이다.** `formatRating`이 `count < 3`일 때만 감춘다 (§7 "3건 미만")                                        |
| 별점을 한 번도 못 받은 사람의 평균은             | **`null`이고 카운트는 0이다.** 0.0으로 두면 화면이 "0점을 받았다"와 구분할 수 없다                              |
| 제재 중인 회원은 별점을 줄 수 있는가             | **있다.** §5의 차단 대상은 공고 등록·알바 신청 둘뿐이고, 이미 끝난 거래의 평가는 "진행 중인 계약 이행"에 가깝다 |
| 소수점 별점(4.5)을 받는가                        | **안 받는다.** §7이 "별점 1~5"라고 썼다. 정수만이다                                                             |
| 취소(`CANCELLED_FREE`)·노쇼(`NO_SHOW`) 거래는    | **막힌다.** `COMPLETED`가 아니다. AC3이 그대로 그 문장이다                                                      |

### 타입

```typescript
// packages/shared/src/rating.ts  (새 파일)

/** 줄 수 있는 별점의 최소·최대 (`spec-fixed.md` §7) */
export const RATING_SCORE_MIN = 1;
export const RATING_SCORE_MAX = 5;

/** 평가받은 사람의 그 거래에서의 역할. 역할별 분리 집계의 축이다 (§2.1) */
export const RATING_ROLES = ['POSTER', 'WORKER'] as const;
export type RatingRole = (typeof RATING_ROLES)[number];

/** 별점이 내는 에러 코드 */
export const RATING_ERRORS = {
  APPLICATION_NOT_FOUND: 'RATING_APPLICATION_NOT_FOUND',
  /** 그 거래의 당사자가 아니다 */
  NOT_PARTICIPANT: 'RATING_NOT_PARTICIPANT',
  /** 아직 끝나지 않은 거래다 (AC3) */
  NOT_COMPLETED: 'RATING_NOT_COMPLETED',
  /** 이 거래에 이미 별점을 줬다 (AC2) */
  ALREADY_RATED: 'RATING_ALREADY_RATED',
  /** 그 id의 회원이 없다 */
  USER_NOT_FOUND: 'RATING_USER_NOT_FOUND',
} as const;
export type RatingErrorCode =
  (typeof RATING_ERRORS)[keyof typeof RATING_ERRORS];

/** 별점 입력 요청 */
export const rateRequestSchema = z.object({
  applicationId: z.string().min(1),
  /** 별점을 주는 사람. #4의 토큰 주체로 바꾸기 전까지는 본문으로 온다 */
  raterId: z.string().min(1),
  score: z.number().int().min(RATING_SCORE_MIN).max(RATING_SCORE_MAX),
});
export type RateRequest = z.infer<typeof rateRequestSchema>;

/** 한 역할의 평점. **평균과 표본 수를 함께 준다** — 화면이 "신규" 판정에 쓴다 */
export const roleRatingSchema = z.object({
  average: z.number().nullable(),
  count: z.number().int().min(0),
});
export type RoleRating = z.infer<typeof roleRatingSchema>;

/** 한 회원의 평점. **두 역할이 따로다** (§2.1, AC6) */
export const ratingSummarySchema = z.object({
  userId: z.string(),
  asPoster: roleRatingSchema,
  asWorker: roleRatingSchema,
});
export type RatingSummary = z.infer<typeof ratingSummarySchema>;

/** 별점을 남긴 결과. 반영된 뒤의 평점을 함께 준다 (AC1) */
export const ratingResultSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  raterId: z.string(),
  rateeId: z.string(),
  rateeRole: z.enum(RATING_ROLES),
  score: z.number().int(),
  ratee: ratingSummarySchema,
});
export type RatingResult = z.infer<typeof ratingResultSchema>;

/**
 * 누가 평가받는 사람이고 그때 무슨 역할이었나.
 *
 * 당사자가 아니면 `null`이다. **판정을 서비스 안에 숨기지 않는 이유는**
 * 이것이 "구인자 평점 / 구직자 평점"이 갈리는 유일한 지점이기 때문이다.
 */
export function rateeOf(input: {
  raterId: string;
  employerId: string;
  applicantId: string;
}): { rateeId: string; rateeRole: RatingRole } | null;
```

`RATING_MIN_SAMPLES`와 `formatRating`은 **이미 `application.ts`에 있다.** 옮기지도 다시 만들지도
않는다 — #18이 "#26이 실제 별점을 채우면 이 함수를 그대로 쓴다"고 적어 둔 자리다.

```typescript
// apps/api/src/rating/rating.service.ts  (새 파일)

export class RatingError extends Error {
  constructor(readonly code: RatingErrorCode) {}
}

/** 별점을 매길 수 있는지 판정하는 데 필요한 거래 정보. 넷뿐이다 */
export interface RatableApplication {
  id: string;
  status: ApplicationStatus;
  applicantId: string;
  employerId: string;
}

/** 저장된 별점 한 건 */
export interface RatingRecord {
  id: string;
  applicationId: string;
  raterId: string;
  rateeId: string;
  rateeRole: RatingRole;
  score: number;
}

export interface RatingStore {
  /** 그 거래의 당사자와 상태. 없으면 null */
  findApplication(applicationId: string): Promise<RatableApplication | null>;

  /**
   * 별점 1행을 쓰고 **그 자리에서** 평가받은 사람의 역할별 캐시를 다시 집계한다.
   *
   * 유니크 제약(`applicationId, raterId`)에 걸리면 `'DUPLICATE'`다 — 예외로
   * 던지지 않는 이유는 **이것이 연타의 정상적인 결과**이기 때문이다 (#17과 같다).
   */
  create(input: {
    applicationId: string;
    raterId: string;
    rateeId: string;
    rateeRole: RatingRole;
    score: number;
  }): Promise<RatingRecord | 'DUPLICATE'>;

  /** 그 회원의 역할별 평점 캐시. 그런 회원이 없으면 null */
  summaryOf(userId: string): Promise<RatingSummary | null>;
}

export class RatingService {
  constructor(private readonly store: RatingStore) {}

  /** 거래 후 별점을 남긴다 (AC1~AC3) */
  rate(input: RateRequest): Promise<RatingResult>;

  /** 한 회원의 두 평점 (AC4~AC6) */
  summaryOf(userId: string): Promise<RatingSummary>;
}
```

```typescript
// apps/api/src/rating/rating.controller.ts  (새 파일)

@Controller('ratings')
export class RatingController {
  @Post() rate(body: unknown): Promise<RatingResult>;
  @Get(':userId') summary(userId: string): Promise<RatingSummary>;
}
```

```typescript
// apps/api/src/application/prisma-application.store.ts  (변경)

/**
 * 임시 구현체를 걷어낸다. 이제 `User`의 평점 캐시를 **진짜로 읽는다**.
 */
export class PrismaApplicantProfileReader implements ApplicantProfileReader {}
```

```prisma
// apps/api/prisma/schema.prisma  (추가·변경)

model User {
  /// 구인자로서 받은 평점 평균. 표본이 없으면 null (§7)
  ratingAsPoster       Float?
  ratingAsPosterCount  Int    @default(0)
  /// 구직자로서 받은 평점 평균 (§7)
  ratingAsWorker       Float?
  ratingAsWorkerCount  Int    @default(0)

  ratingsGiven    Rating[] @relation("RatingsGiven")
  ratingsReceived Rating[] @relation("RatingsReceived")
}

/// 거래 후 남기는 별점 1건. (이슈 #26, `spec-fixed.md` §7)
model Rating {
  id            String     @id @default(cuid())
  applicationId String
  raterId       String
  rateeId       String
  /// 평가받은 사람의 그 거래에서의 역할. 나중에 되짚지 않고 그때 값을 굳힌다
  rateeRole     RatingRole
  score         Int
  createdAt     DateTime   @default(now())

  /// 거래당 1회 (§7). **경합에서 실제로 이기는 것은 이 제약이다**
  @@unique([applicationId, raterId])
  /// 역할별 평균 재집계가 이 인덱스로 끝난다
  @@index([rateeId, rateeRole])
}

enum RatingRole {
  POSTER
  WORKER
}
```

### 에러 케이스

| 상황                          | 에러 코드                      | HTTP |
| ----------------------------- | ------------------------------ | ---- |
| 그런 거래가 없다              | `RATING_APPLICATION_NOT_FOUND` | 404  |
| 그 거래의 당사자가 아니다     | `RATING_NOT_PARTICIPANT`       | 403  |
| 아직 끝나지 않은 거래다 (AC3) | `RATING_NOT_COMPLETED`         | 409  |
| 이미 별점을 줬다 (AC2)        | `RATING_ALREADY_RATED`         | 409  |
| 그 id의 회원이 없다           | `RATING_USER_NOT_FOUND`        | 404  |
| 별점이 1~5 정수가 아니다      | `VALIDATION_FAILED`            | 400  |

**중복과 미완료는 409다.** 403(권한 없음)은 "당신은 이 행동을 할 수 없다"인데, 둘 다 사람이
아니라 **거래의 지금 상태** 때문에 막힌 것이다 — 완료되면 줄 수 있고, 이미 준 것은 상태 충돌이다.
당사자가 아닌 경우만 403이다 (#25의 판단과 같은 축).

### 컴포넌트 Props

```typescript
// apps/web/src/app/my/MemberRating.tsx  (새 파일)

/**
 * 내 평점 두 개를 나란히 보여준다 (AC4~AC6).
 *
 * 표시 규칙은 `formatRating` 하나뿐이다 — 3건 미만이면 "신규"다.
 * 못 불러오면 **아무것도 그리지 않는다.** 평점은 부가 정보라 마이페이지
 * 전체를 실패로 만들 이유가 없다.
 */
export function MemberRating({
  userId,
}: {
  userId: string;
}): React.JSX.Element | null;
```

### 이 이슈에서 만들지 않는 것

| 항목                        | 이유                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| 별점 입력 화면              | AC 6개 중 입력은 서버 판정이다. 액션 화면은 #22 묶음과 함께 붙인다 (#20·#24와 같은 판단) |
| 텍스트 후기·신고            | PRD Out of Scope. §7이 "별점 1~5만"이라고 썼다                                           |
| 받은 별점 내역 목록 (§11.4) | #32(관리자 회원 상세)다. 여기는 **평균과 카운트**까지다                                  |
| 평점에 따른 노출 우선순위   | PRD Out of Scope("표시만")                                                               |
| 별점 수정·삭제·이의제기     | PRD Out of Scope                                                                         |
| 별점 요청 알림              | AC에 없다. §8의 이메일 병행 목록에도 없다                                                |
| 제재 중 별점 차단           | §5의 차단 대상은 공고 등록·알바 신청 둘뿐이다                                            |

---

## 테스트 시나리오

### 정상

- [x] [정상] `rateeOf` — should point at the applicant as WORKER when the employer is the rater
- [x] [정상] `rateeOf` — should point at the employer as POSTER when the applicant is the rater
- [x] [정상] `rate` — should store the score and refresh the worker rating when the employer rates a completed transaction
- [x] [정상] `rate` — should store the score and refresh the poster rating when the applicant rates the employer
- [x] [정상] `summaryOf` — should report the average of the scores the member received as a worker
- [x] [정상] `POST /ratings` — should answer 201 with the rated member's refreshed rating
- [x] [정상] `GET /ratings/:userId` — should answer 200 with the two role averages side by side
- [x] [정상] `create` — should write the average and the count into the rated member's worker cache
- [x] [정상] `profilesOf` — should report the applicant's cached worker rating instead of an empty sample
- [x] [정상] `MemberRating` — should show the poster rating and the worker rating as separate rows

### 경계

- [x] [경계] `rate` — should store a score of exactly 1
- [x] [경계] `rate` — should store a score of exactly 5
- [x] [경계] `summaryOf` — should report a null average and a zero count when the member was never rated
- [x] [경계] `summaryOf` — should report a count of 2 while the average is still hidden by the display rule
- [x] [경계] `summaryOf` — should keep the two roles apart when the member was rated in both roles
- [x] [경계] `create` — should leave the poster cache untouched when the rating was left for the worker
- [x] [경계] `create` — should recompute the average over every rating the member received in that role
- [x] [경계] `create` — should accept the counterpart's rating on the same transaction
- [x] [경계] `MemberRating` — should show 신규 instead of the average when only 2 ratings were received
- [x] [경계] `MemberRating` — should show the average when exactly 3 ratings were received

### 예외

- [x] [예외] `rateeOf` — should return null when the rater is neither party of the transaction
- [x] [예외] `rate` — should reject a score below 1
- [x] [예외] `rate` — should reject a score above 5
- [x] [예외] `rate` — should reject a fractional score
- [x] [예외] `rate` — should throw RATING_ALREADY_RATED when the same rater rates the same transaction twice
- [x] [예외] `rate` — should throw RATING_NOT_COMPLETED when the transaction is still ACCEPTED
- [x] [예외] `rate` — should throw RATING_NOT_COMPLETED when the transaction ended as NO_SHOW
- [x] [예외] `rate` — should throw RATING_NOT_PARTICIPANT when someone outside the transaction rates
- [x] [예외] `rate` — should throw RATING_APPLICATION_NOT_FOUND when there is no such transaction
- [x] [예외] `summaryOf` — should throw RATING_USER_NOT_FOUND when there is no such member
- [x] [예외] `create` — should report DUPLICATE when the same rater rates the same transaction twice
- [x] [예외] `POST /ratings` — should answer 409 with RATING_ALREADY_RATED when the transaction was already rated
- [x] [예외] `POST /ratings` — should answer 409 with RATING_NOT_COMPLETED when the transaction is not completed

---

## AC 대조

| AC                                                                                                               | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Given `COMPLETED` 거래, When 구인자가 구직자에게 별점을 주면, Then 저장되고 구직자의 `ratingAsWorker`에 반영된다 | `[정상] rateeOf — employer rates the applicant as WORKER`<br>`[정상] rate — stores and refreshes the worker rating`<br>`[정상] POST /ratings — 201 with the refreshed rating`<br>`[정상] create — writes the average and the count into the worker cache`<br>`[경계] create — recomputes over every rating in that role`<br>`[정상] profilesOf — reports the cached worker rating` |
| Given 같은 거래, When 또 별점을 주면, Then 막힌다                                                                | `[예외] rate — RATING_ALREADY_RATED on the second rating`<br>`[예외] create — DUPLICATE from the unique constraint`<br>`[예외] POST /ratings — 409 RATING_ALREADY_RATED`<br>`[경계] create — the counterpart may still rate the same transaction`                                                                                                                                  |
| Given `COMPLETED`가 아닌 거래, When 별점을 주면, Then 막힌다                                                     | `[예외] rate — RATING_NOT_COMPLETED while ACCEPTED`<br>`[예외] rate — RATING_NOT_COMPLETED after NO_SHOW`<br>`[예외] POST /ratings — 409 RATING_NOT_COMPLETED`<br>`[예외] rate — RATING_APPLICATION_NOT_FOUND`<br>`[예외] rate — RATING_NOT_PARTICIPANT`                                                                                                                           |
| Given 별점 2건만 받은 회원, When 평점을 보면, Then 평균 대신 **"신규"** 로 표시된다                              | `[경계] MemberRating — 신규 with only 2 ratings`<br>`[경계] summaryOf — count of 2 with the average still hidden`<br>`[경계] summaryOf — null average and zero count when never rated`                                                                                                                                                                                             |
| Given 별점 3건을 받은 회원, When 평점을 보면, Then 평균이 표시된다                                               | `[경계] MemberRating — the average at exactly 3 ratings`<br>`[정상] summaryOf — the average of the worker scores`<br>`[경계] create — recomputes over every rating in that role`                                                                                                                                                                                                   |
| Given 구인자로도 구직자로도 별점을 받은 회원, When 평점을 보면, Then **두 평균이 따로** 보인다                   | `[정상] rateeOf — applicant rates the employer as POSTER`<br>`[정상] rate — refreshes the poster rating`<br>`[경계] summaryOf — keeps the two roles apart`<br>`[경계] create — leaves the poster cache untouched`<br>`[정상] GET /ratings/:userId — the two averages side by side`<br>`[정상] MemberRating — two separate rows`                                                    |

**AC에 없는데 추가한 시나리오** — 넷 다 `spec-fixed.md`가 요구하는 것이고 AC 문장만 없다.

- `[경계]·[예외] rate — 1 / 5 / 소수 / 범위 밖` — §7의 "별점 1~5"를 지키는 유일한 자리다.
  범위를 안 막으면 별 100개짜리 평점이 평균에 섞인다. **스키마를 직접 부르지 않고
  서비스를 통해 본다** — 스키마만 보는 테스트는 stub 상태에서도 통과해서 빨간불을 못 만든다
- `[예외] rate — RATING_NOT_PARTICIPANT` — §7이 "거래에 한해"라고 썼다. 당사자 판정이 없으면
  아무나 남의 평점을 올리고 내릴 수 있다
- `[예외] summaryOf — RATING_USER_NOT_FOUND` — 없는 회원에 0건을 돌려주면 화면이
  "아직 별점이 없는 회원"과 "없는 회원"을 구분할 수 없다
- `[정상] profilesOf — 캐시를 진짜로 읽는다` — #18이 "#26이 어댑터만 채운다"고 남겨 둔 임시
  구현체다. **안 채우면 지원자 목록이 계속 전원 "신규"로 보인다**

**커버리지:** AC 6개 / 시나리오 33개 / 미커버 0개

---

## Green 결과

테스트 33개 전부 통과. 저장소 전체는 1,030건(`packages/shared` 58 · `apps/web` 128 ·
`apps/api` 844)이고 빨간불은 없다. `pnpm build` → `pnpm typecheck` → `pnpm lint` 순서로
돌려 **오류 0건**이다 (`apps/web`의 경고 1건은 이 이슈가 건드리지 않은 파일의 기존 항목).

만든·고친 파일

| 파일                                                   | 무엇                                          |
| ------------------------------------------------------ | --------------------------------------------- |
| `packages/shared/src/rating.ts`                        | 값·스키마·`rateeOf`                           |
| `apps/api/prisma/schema.prisma` + 마이그레이션         | `Rating` 모델과 `User`의 역할별 캐시 컬럼 4개 |
| `apps/api/src/rating/*`                                | 서비스·저장소·컨트롤러·모듈                   |
| `apps/api/src/application/prisma-application.store.ts` | 임시 구현체를 걷어내고 캐시를 진짜로 읽는다   |
| `apps/web/src/app/my/MemberRating.tsx` + CSS           | 두 평점을 나란히 그린다                       |
| `apps/web/src/app/my/page.tsx`                         | 마이페이지에 배선                             |

### 커버리지 — 어댑터 두 메서드가 비어 있다

`src/rating` 기준 구문 79.4% / 분기 65.6%. `rating.service.ts`는 100%다.

| 미커버                                            | 판단                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `PrismaRatingStore.findApplication` · `summaryOf` | **시나리오에서 빠진 것이다.** 서비스 테스트는 가짜 저장소를 쓰고, 통합 테스트는 `create`만 부른다 |
| `RatingController`의 404·403 분기                 | 시나리오가 409 둘만 잡는다. 나머지 분기는 코드로만 있다                                           |

**커버리지를 채우려고 테스트를 더 쓰지 않았다.** 다만 `findApplication`의 조인
(`Application → JobPost.employerId`)은 지금 어떤 테스트도 진짜 DB에서 실행하지 않으므로,
**배포 전에 한 번은 실제로 태워 봐야 하는 자리**로 남긴다.

---

## AC 독립 검증 (`@ac-verifier`)

**AC 6개 전부 ✅.** 구현한 사람과 다른 눈으로 코드와 테스트를 읽고, 실제로 돌려
(`apps/api` 844건 · `apps/web` 128건, 통합은 진짜 Postgres) 확인했다. 가짜 테스트
점검(단언 없는 테스트, `await` 누락, 목 값을 그대로 단언)에서도 걸린 것이 없다.

지적된 것은 하나다 — **AC3의 "COMPLETED가 아닌 거래"를 `ACCEPTED`·`NO_SHOW` 둘로만
확인했다.** 구현이 `status !== 'COMPLETED'` 화이트리스트라 취소 상태도 논리적으로는
막히지만, 그건 코드를 읽어 확인한 것이지 테스트로 증명된 것은 아니다. **판정에는
영향이 없어 시나리오를 늘리지 않았다.**

---

## Refactor — 고칠 것이 없었다

바뀐 파일 11개(`git diff main...HEAD`, 테스트·생성물 제외)를 중복·네이밍·단일책임·
불필요한 복잡도·컨벤션 불일치로 훑었다. **코드를 한 줄도 바꾸지 않았다.**

| 후보                                     | 판단                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `UNIQUE_VIOLATION`(P2002) 판별이 4벌     | **범위 밖이다.** 나머지 셋은 이번 이슈가 건드리지 않은 파일이다 (`job-post`·`point`·`application` 저장소) |
| `MemberRating`의 두 줄이 같은 모양       | 2회다. **세 번째부터 뽑는다** — `my/page.tsx`의 정의 목록도 같은 모양을 그냥 반복한다                     |
| `formatRating`이 `application.ts`에 있음 | 옮기면 `application.test.ts`가 함께 깨진다. **테스트 파일은 고치지 않는다**                               |

근거 없이 손대면 순수한 위험이라 그대로 뒀다.

---

## 커밋 전 점검 (`/security-review 26`)

### 🔴 즉시 수정 — 없음

타입 오류 0건(`pnpm build` → `pnpm typecheck` 순서). 비밀값이 코드에 박힌 곳 없음,
`NEXT_PUBLIC_` 오용 없음, `.env` 커밋 대상 없음, 새 코드에 `console.*` 없음.
컨트롤러는 요청·응답을 모두 zod로 `parse`한다.

### 🟡 권장 수정 — 별점을 주는 회원 id도 본문에서 온다

`POST /ratings`는 `raterId`를 **본문에서 그대로 받는다.** 그래서 남의 id를 적어 보내면
그 사람 이름으로 별점을 남길 수 있다. 다만 이건 별점 이전에 **신원 위조 자체가 문제**다.

원인은 #26이 아니다. #4의 토큰 주체 배선이 끝나기 전까지 #12 이후 모든 엔드포인트가
같은 임시 방편을 쓰고 있고, `issue-18.md`·`issue-19.md`·`issue-24.md`·`issue-25.md`에
같은 항목이 이미 남아 있다.

|                 |                                                 |
| --------------- | ----------------------------------------------- |
| **해소 조건**   | #4의 토큰 주체가 본문 id를 대체하면 사라진다    |
| **재판정 시점** | **첫 배포 직전.** 위 네 문서의 같은 항목과 함께 |

### ⚪ 무시 가능 — 의존성 9건

`pnpm audit` 9건 전부 `security-exceptions.md`에 이미 판정돼 있다
(`deepmerge-ts` 1 · `mysql2` 2 · `fast-uri` 4 · `qs` 2). **새로 추가된 항목은 없다** —
이 이슈는 `package.json`도 잠금 파일도 건드리지 않았다.

### 동시성 — 같은 사람이 같은 거래에 동시에 두 번 보내면

**유니크 제약이 막는다.** 사전 조회가 아니라 `(applicationId, raterId)` 제약이
두 번째를 떨어뜨리고, 저장소가 그것을 `'DUPLICATE'`로 바꿔 돌려준다. 통합 테스트가
그 경로를 실제 DB에서 태운다.

평균 재집계는 삽입과 같은 트랜잭션 안이라, 두 별점이 겹쳐도 나중 트랜잭션이 두 행을
모두 세고 끝난다. **증분이었다면 하나를 잃었을 자리다.**
