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
});
export type ApplicationSummary = z.infer<typeof applicationSummarySchema>;
