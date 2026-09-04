/**
 * 보관·파기 기간. (`spec-fixed.md` §2.7)
 *
 * **한 곳에 모으는 것이 목적이다.** 실서비스 오픈 전에 법정 기준으로
 * 재확인해야 하는데, 값이 코드 여기저기 흩어져 있으면 어디를 고쳐야 하는지
 * 알 수 없다. 여기 숫자만 바꾸면 파기 로직·배치·스키마는 그대로다.
 *
 * 테스트는 이 값을 쓰지 않고 짧은 값을 **주입한다**. 4개월을 실제로
 * 기다릴 수는 없기 때문이다 (#39 AC5).
 */
export const RETENTION = {
  /** 이름·연락처·주소·계좌 정보·서명 동의서 PDF — 비활성화 후 4개월 */
  PERSONAL_INFO_MS: 4 * 30 * 24 * 60 * 60 * 1000,
  /** 계약·청약철회 기록 (공고, 신청, 수락/취소 이력) — 5년 */
  CONTRACT_MS: 5 * 365 * 24 * 60 * 60 * 1000,
  /** 대금결제·재화공급 기록 (포인트 원장, 결제, 환전) — 5년 */
  PAYMENT_MS: 5 * 365 * 24 * 60 * 60 * 1000,
  /** 소비자 불만·분쟁 처리 기록 (Penalty, Suspension, AdminAuditLog) — 3년 */
  DISPUTE_MS: 3 * 365 * 24 * 60 * 60 * 1000,
} as const;

/**
 * 잡 하나당 고정 정수 키. (`spec-fixed.md` §8.2)
 *
 * `pg_try_advisory_lock`에 넘긴다. 서버가 여러 대여도 같은 잡이 동시에
 * 돌지 않는다. 값은 이슈 번호를 쓴다 — 겹치지 않고 출처가 분명하다.
 */
export const ADVISORY_LOCK_KEYS = {
  PURGE_PERSONAL_INFO: 39,
} as const;

/** 파기된 계정의 이메일. 유니크 제약을 유지하면서 실재하지 않는 주소가 된다 */
export function purgedEmailFor(userId: string): string {
  // `.invalid`는 예약 TLD라 어떤 메일도 닿지 않는다 (RFC 2606).
  return `deleted_${userId}@invalid`;
}

/** 파기된 계정의 이름 */
export const PURGED_NAME = '탈퇴회원';
