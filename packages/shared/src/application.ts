import { z } from 'zod';

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

/**
 * 이 전이가 표에 있나.
 *
 * `job-post`의 `canTransition`과 이름이 겹치지 않게 도메인을 붙였다 —
 * `packages/shared`가 `export *`로 한 이름공간에 모이기 때문이다.
 */
export function canApplicationTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return APPLICATION_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

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
  /** 정원이 찼다 (#18 AC3 — 이슈에 적힌 문자열 그대로) */
  HEADCOUNT_FULL: 'APPLICATION_HEADCOUNT_FULL',
  /** 그 공고의 구인자가 아니다 (#18) */
  NOT_EMPLOYER: 'APPLICATION_NOT_EMPLOYER',
  /** 공고를 그 상태로 옮길 수 없다 (#23). **job-post의 코드를 재사용한다** */
  JOB_POST_INVALID_TRANSITION: 'JOB_POST_INVALID_TRANSITION',
} as const;

export type ApplicationErrorCode =
  (typeof APPLICATION_ERRORS)[keyof typeof APPLICATION_ERRORS];

/** 지원 요청. 회원 식별은 #4의 토큰 배선이 끝나기 전까지 본문으로 받는다 */
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
  /**
   * 수락 시각 (#18 AC1). 아직 수락 전이면 null.
   *
   * 기본값을 둔 이유는 #17이 만든 응답 객체를 고치지 않고도 이 스키마를
   * 통과시키기 위해서다. **#20의 무상 취소 창(수락 +2시간)이 이 값으로 판정한다.**
   */
  acceptedAt: z.iso.datetime().nullable().default(null),
});
export type ApplicationSummary = z.infer<typeof applicationSummarySchema>;

/** 수락 요청. 회원 식별은 #17과 같이 아직 본문으로 받는다 */
export const acceptApplicationRequestSchema = z.object({
  employerId: z.string().min(1, { error: '구인자를 알 수 없습니다.' }),
});
export type AcceptApplicationRequest = z.infer<
  typeof acceptApplicationRequestSchema
>;

/** 완료 확인 요청. 회원 식별은 #17·#18과 같이 아직 본문으로 받는다 (#23) */
export const completeJobPostRequestSchema = z.object({
  jobPostId: z.string().min(1, { error: '공고를 알 수 없습니다.' }),
  employerId: z.string().min(1, { error: '구인자를 알 수 없습니다.' }),
});
export type CompleteJobPostRequest = z.infer<
  typeof completeJobPostRequestSchema
>;

/**
 * 완료 확인 결과 (#23).
 *
 * 화면이 "3명에게 30,000P 지급, 30,000P 반환"을 그린다. 셋을 다 주는 이유는
 * **구인자가 무슨 일이 일어났는지 봐야 하기 때문**이다 — 확정 인원분만
 * 나가고 나머지가 돌아온 것을 숫자로 확인하지 못하면 돈이 샜다고 믿게 된다.
 */
export const completionSummarySchema = z.object({
  jobPostId: z.string(),
  status: z.literal('COMPLETED'),
  /** 지급받은 사람 수 */
  paidCount: z.number().int().min(0),
  /** 지급 총액 */
  paidTotal: z.number().int().min(0),
  /** 구인자에게 돌아간 미체결분 */
  releasedTotal: z.number().int().min(0),
});
export type CompletionSummary = z.infer<typeof completionSummarySchema>;

/** 표본이 이보다 적으면 평균을 감춘다 (`spec-fixed.md` §7) */
export const RATING_MIN_SAMPLES = 3;

/**
 * 평점 표시 문구. 표본이 모자라면 `'신규'`, 아니면 평균 (#18 AC2).
 *
 * **별 1개 받고 평점 1.0으로 낙인찍히는 것을 막는다** (§7). #26이 실제 별점을
 * 채우면 이 함수를 그대로 쓴다 — 규칙이 화면마다 따로 있으면 한쪽만 고쳐진다.
 */
export function formatRating(average: number | null, count: number): string {
  if (average === null || count < RATING_MIN_SAMPLES) return '신규';
  return average.toFixed(1);
}

/** 구인자가 보는 지원자 한 명 (#18) */
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
export const EMPLOYER_VISIBLE_STATUSES = [
  'APPLIED',
  'ACCEPTED',
] as const satisfies readonly ApplicationStatus[];
