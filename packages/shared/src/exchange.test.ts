import { describe, expect, it } from 'vitest';
import {
  EXCHANGE_ERRORS,
  EXCHANGE_REQUEST_STATUSES,
  canTransitionExchange,
  checkExchangeAmount,
} from './exchange.js';

describe('checkExchangeAmount', () => {
  it('should accept exactly 5000', () => {
    expect(checkExchangeAmount(5000)).toEqual({ ok: true });
  });

  it('should reject 4990 with EXCHANGE_BELOW_MIN_AMOUNT', () => {
    expect(checkExchangeAmount(4990)).toEqual({
      ok: false,
      code: EXCHANGE_ERRORS.BELOW_MIN_AMOUNT,
    });
  });

  // 둘 다 걸리는 값에서 어느 쪽이 나오는지 못 박는다. 안 정하면 테스트가
  // 구현을 따라간다.
  it('should reject 4005 with EXCHANGE_BELOW_MIN_AMOUNT when both the minimum and the unit are violated', () => {
    expect(checkExchangeAmount(4005)).toEqual({
      ok: false,
      code: EXCHANGE_ERRORS.BELOW_MIN_AMOUNT,
    });
  });
});

/**
 * 전이표 (#34, §6.4.1).
 *
 * **종착역을 검증하는 것이 핵심이다.** 갈 수 있는 길만 맞추면 이체가 끝난
 * 건을 반려해 포인트를 두 번 주는 길이 열린 채로 초록불이 된다.
 */
describe('canTransitionExchange', () => {
  it('should allow REQUESTED to APPROVED and APPROVED to COMPLETED', () => {
    expect(canTransitionExchange('REQUESTED', 'APPROVED')).toBe(true);
    expect(canTransitionExchange('APPROVED', 'COMPLETED')).toBe(true);
  });

  it('should allow rejecting from REQUESTED and from APPROVED', () => {
    expect(canTransitionExchange('REQUESTED', 'REJECTED')).toBe(true);
    expect(canTransitionExchange('APPROVED', 'REJECTED')).toBe(true);
  });

  it('should refuse every transition out of COMPLETED and out of REJECTED', () => {
    const terminal = ['COMPLETED', 'REJECTED'] as const;
    const leaving = terminal.flatMap((from) =>
      EXCHANGE_REQUEST_STATUSES.map((to) => canTransitionExchange(from, to)),
    );
    expect(leaving).not.toContain(true);
  });
});
