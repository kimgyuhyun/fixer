import { describe, expect, it } from 'vitest';
import { EXCHANGE_ERRORS, checkExchangeAmount } from './exchange.js';

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
