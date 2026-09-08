/**
 * 제재 판정 규칙. (이슈 #25, `spec-fixed.md` §5)
 *
 * 값은 여기서 정하지 않았다 — §5가 "최근 180일 롤링 윈도우 내 5건 이상 →
 * 5일 제재"라고 이미 못 박았고, 이 파일은 그 문장을 코드로 옮긴 것뿐이다.
 */

/** 경고를 세는 롤링 윈도우(최근 얼마간만 보는 기간). 180일 */
export const PENALTY_WINDOW_DAYS = 180;

/** 창 안 경고가 이 건수 이상이면 제재다 */
export const PENALTY_SUSPEND_THRESHOLD = 5;

/** 제재 기간. 5일 */
export const SUSPENSION_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 제재가 내는 에러 코드. **이슈 AC에 적힌 문자열 그대로다** */
export const PENALTY_ERRORS = {
  /** 제재 중이라 할 수 없는 행위다 (공고 등록 · 알바 신청) */
  SUSPENDED: 'PENALTY_SUSPENDED',
} as const;

export type PenaltyErrorCode =
  (typeof PENALTY_ERRORS)[keyof typeof PENALTY_ERRORS];

/**
 * 경고를 세기 시작하는 시각.
 *
 * **이 시각 이상이 창 안이다.** "최근 180일 내"를 닫힌 구간으로 읽는다 —
 * 정확히 180일 전에 생긴 경고까지가 최근이다.
 */
export function penaltyWindowStart(now: Date): Date {
  throw new Error('not implemented');
}

/** 창 안 경고가 이만큼이면 제재인가 */
export function shouldSuspend(recentPenaltyCount: number): boolean {
  throw new Error('not implemented');
}

/** 제재 종료 시각. 시작 +5일 */
export function suspensionEndAt(startAt: Date): Date {
  throw new Error('not implemented');
}

/**
 * 지금 유효한 제재인가.
 *
 * **§5.1의 `releasedAt IS NULL AND endAt > now()`를 그대로 옮긴 것이다.**
 * 판정이 두 군데로 갈라지지 않게 여기 한 곳에만 둔다. 종료 시각 **정각은
 * 이미 끝난 것**이다 — 부등호가 `>`이지 `>=`가 아니다.
 */
export function isSuspensionActive(
  suspension: { endAt: Date; releasedAt: Date | null },
  now: Date,
): boolean {
  throw new Error('not implemented');
}
