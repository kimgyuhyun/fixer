import type { Prisma } from '../generated/prisma/client';

/**
 * 공고 잠금에 드나드는 원장 유형.
 *
 * `HOLD`가 넣고, `RELEASE`(구인자에게)와 `PAYOUT`(구직자에게)이 뺀다.
 * `PAYOUT`이 여기 있는 것이 핵심이다 — 구인자의 `−` 행이 없으므로
 * (`PAYOUT은 구직자 + 행만 쓴다 (#23)`) 지급분은 `HOLD`가 만든 잠금에서
 * 곧바로 빠져나간다.
 */
export const LOCK_FLOW_TYPES = ['HOLD', 'RELEASE', 'PAYOUT'] as const;

/**
 * 그 공고에 아직 잠겨 있는 금액.
 *
 * 예산에서 다시 계산하지 않는다 — #15가 예산을 고친 공고는 예산과 실제 잠금이
 * 다르다 (`ADR-PAY-7`이 lot 잔여에서 내린 것과 같은 판단). 호출부의 트랜잭션
 * 안에서 읽어야 하므로 `tx`를 받는다.
 */
export function lockedAmountFor(
  tx: Prisma.TransactionClient,
  jobPostId: string,
): Promise<number> {
  throw new Error('not implemented');
}
