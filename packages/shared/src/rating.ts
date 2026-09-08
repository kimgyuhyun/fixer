import { z } from 'zod';

/**
 * 거래 후 남기는 별점. (이슈 #26, `spec-fixed.md` §7)
 *
 * 값은 여기서 정하지 않았다 — §7이 "`COMPLETED`된 거래에 한해 양방향으로
 * 별점 1~5만", "거래당 1회", "표본 3건 미만이면 신규"라고 이미 못 박았고,
 * 이 파일은 그 문장을 코드로 옮긴 것뿐이다.
 *
 * 표시 규칙(`RATING_MIN_SAMPLES` · `formatRating`)은 **`application.ts`에 이미
 * 있다.** #18이 "#26이 실제 별점을 채우면 이 함수를 그대로 쓴다"고 남겨 둔
 * 자리라 옮기지도 다시 만들지도 않는다.
 */

/** 줄 수 있는 별점의 최소 */
export const RATING_SCORE_MIN = 1;

/** 줄 수 있는 별점의 최대 */
export const RATING_SCORE_MAX = 5;

/**
 * 평가받은 사람의 그 거래에서의 역할. **역할별 분리 집계의 축이다** (§2.1).
 *
 * `apps/api/prisma/schema.prisma`의 `RatingRole`과 같아야 한다.
 */
export const RATING_ROLES = ['POSTER', 'WORKER'] as const;
export type RatingRole = (typeof RATING_ROLES)[number];

/** 별점이 내는 에러 코드 */
export const RATING_ERRORS = {
  /** 그런 거래가 없다 */
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

/**
 * 별점 입력 요청.
 *
 * **정수만 받는다.** §7이 "별점 1~5"라고 썼다 — 소수점을 받으면 4.5점 같은
 * 값이 섞이고, 그걸 별로 그릴 방법이 화면에 없다.
 */
export const rateRequestSchema = z.object({
  applicationId: z.string().min(1, { error: '거래를 알 수 없습니다.' }),
  /** 별점을 주는 사람. #4의 토큰 주체로 바꾸기 전까지는 본문으로 온다 */
  raterId: z.string().min(1, { error: '회원 정보가 없습니다.' }),
  score: z
    .number()
    .int({ error: '별점은 1~5 사이의 정수여야 합니다.' })
    .min(RATING_SCORE_MIN, { error: '별점은 1점부터입니다.' })
    .max(RATING_SCORE_MAX, { error: '별점은 5점까지입니다.' }),
});
export type RateRequest = z.infer<typeof rateRequestSchema>;

/**
 * 한 역할의 평점.
 *
 * **평균과 표본 수를 함께 준다** — 화면이 "신규" 판정에 쓴다. 평균만 주면
 * 3건 미만인지 알 수 없어 판정할 수 없다 (#18의 `ApplicantItem`과 같다).
 */
export const roleRatingSchema = z.object({
  /** 표본이 없으면 null. **0으로 두지 않는다** — 0점을 받은 것과 구분해야 한다 */
  average: z.number().nullable(),
  count: z.number().int().min(0),
});
export type RoleRating = z.infer<typeof roleRatingSchema>;

/** 한 회원의 평점. **두 역할이 따로다** (§2.1, #26 AC6) */
export const ratingSummarySchema = z.object({
  userId: z.string(),
  asPoster: roleRatingSchema,
  asWorker: roleRatingSchema,
});
export type RatingSummary = z.infer<typeof ratingSummarySchema>;

/** 별점을 남긴 결과. **반영된 뒤의 평점을 함께 준다** (AC1) */
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
export function rateeOf(_input: {
  raterId: string;
  employerId: string;
  applicantId: string;
}): { rateeId: string; rateeRole: RatingRole } | null {
  throw new Error('not implemented');
}
