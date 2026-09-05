import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { WITHDRAWAL_BLOCKERS, WITHDRAWAL_ERRORS } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { WithdrawalController } from './withdrawal.controller';
import {
  MemberNotFoundError,
  WithdrawalBlockedError,
  type WithdrawalService,
} from './withdrawal.service';

function controllerWith(
  impl: Partial<WithdrawalService>,
): WithdrawalController {
  return new WithdrawalController(impl as WithdrawalService);
}

function statusOf(error: unknown): number {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

function bodyOf(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

describe('POST /auth/withdraw', () => {
  it('should return 204', async () => {
    const withdraw = vi.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ withdraw });

    await expect(
      controller.withdraw({ userId: 'usr_1' }),
    ).resolves.toBeUndefined();

    expect(withdraw).toHaveBeenCalledWith('usr_1', expect.any(Date));
  });

  it('should return 409 with every blocking reason', async () => {
    // 하나씩 알려주면 고치고 다시 시도하기를 세 번 반복하게 된다
    const reasons = [
      WITHDRAWAL_BLOCKERS.ACTIVE_CONTRACT,
      WITHDRAWAL_BLOCKERS.POSITIVE_BALANCE,
    ];
    const controller = controllerWith({
      withdraw: vi.fn().mockRejectedValue(new WithdrawalBlockedError(reasons)),
    });

    const error = await rejectionOf(controller.withdraw({ userId: 'usr_1' }));

    expect(statusOf(error)).toBe(HttpStatus.CONFLICT);
    expect(bodyOf(error)).toMatchObject({
      errorCode: WITHDRAWAL_ERRORS.BLOCKED,
      reasons,
    });
  });
});

describe('POST /auth/withdraw — 없는 회원', () => {
  it('should return 404, not 500', async () => {
    const controller = controllerWith({
      withdraw: vi.fn().mockRejectedValue(new MemberNotFoundError()),
    });

    const error = await rejectionOf(controller.withdraw({ userId: 'usr_x' }));

    expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
    expect(bodyOf(error)).toMatchObject({
      errorCode: WITHDRAWAL_ERRORS.NOT_FOUND,
    });
  });

  it('should return 400 when userId is missing', async () => {
    const controller = controllerWith({ withdraw: vi.fn() });

    const error = await rejectionOf(controller.withdraw({}));

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
  });
});
