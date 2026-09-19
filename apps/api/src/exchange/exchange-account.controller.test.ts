import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ExchangeAccountController } from './exchange-account.controller';
import type { ExchangeAccountService } from './exchange-account.service';

/**
 * 계좌는 **본인 것만** 읽고 쓴다. (이슈 #69)
 *
 * 이 컨트롤러는 이슈 본문의 다섯 개 목록에 없지만, 범위에 있는 화면
 * (`my/account/page.tsx`)이 부르는 API다. 화면에서만 회원 id를 빼면 그 화면이
 * 400으로 죽는다.
 */
const CALLER = 'usr_1';

const ACCOUNT = {
  bankCode: '088',
  bankName: '신한은행',
  maskedAccountNumber: '****5678',
  holderName: '김규현',
  status: 'VERIFIED' as const,
  verifiedAt: '2026-09-06T00:00:00.000Z',
};

function controllerWith(
  impl: Partial<ExchangeAccountService>,
): ExchangeAccountController {
  return new ExchangeAccountController(impl as ExchangeAccountService);
}

describe('GET /exchange-accounts/me', () => {
  it("should read the caller's account without a userId query", async () => {
    const findMine = vi.fn().mockResolvedValue(ACCOUNT);
    const controller = controllerWith({ findMine });

    await controller.mine(CALLER);

    expect(findMine).toHaveBeenCalledWith(CALLER);
  });
});

describe('PUT /exchange-accounts', () => {
  it('should register the account for the caller when the body carries no userId', async () => {
    const register = vi.fn().mockResolvedValue(ACCOUNT);
    const controller = controllerWith({ register });

    await controller.register(CALLER, {
      bankCode: '088',
      accountNumber: '110123456789',
      holderName: '김규현',
    });

    expect(register).toHaveBeenCalledWith(CALLER, expect.anything());
  });
});
