import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { WITHDRAWAL_BLOCKERS, WITHDRAWAL_ERRORS } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { memberOf } from './member.guard';
import { WithdrawalController } from './withdrawal.controller';
import {
  MemberNotFoundError,
  WithdrawalBlockedError,
  type WithdrawalService,
} from './withdrawal.service';

/** 탈퇴하는 사람. 몸체가 아니라 토큰에서 온다 (#71) */
const CALLER = 'usr_1';

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

/** Nest가 라우트 파라미터를 남기는 자리 */
const ROUTE_ARGS_METADATA = '__routeArguments__';

/**
 * 그 라우트의 파라미터를 **채워 주는 것**을 인덱스 순서로 돌려준다.
 *
 * `@CurrentMember()`처럼 `createParamDecorator`로 만든 것은 `factory`를 남기고,
 * `@Body()`는 남기지 않는다. 그래서 목록이 곧 "무엇이 이 파라미터를 채우는가"다.
 */
function paramFactoriesOf(
  controller: new (...args: never[]) => unknown,
  route: string,
): unknown[] {
  const args =
    (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, route) as Record<
      string,
      { index: number; factory?: unknown }
    >) ?? {};

  const factories: unknown[] = [];
  for (const entry of Object.values(args)) {
    factories[entry.index] = entry.factory;
  }
  return factories;
}

describe('WithdrawalController.withdraw', () => {
  it('should hand the caller and the current time to the service', async () => {
    const withdraw = vi.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ withdraw });

    await expect(controller.withdraw(CALLER)).resolves.toBeUndefined();

    expect(withdraw).toHaveBeenCalledWith(CALLER, expect.any(Date));
  });

  it('should take the caller as its only parameter so nothing from the wire body reaches the service', () => {
    // 몸체를 아예 받지 않으면 남의 `userId`를 실어 보내도 닿을 곳이 없다.
    expect(paramFactoriesOf(WithdrawalController, 'withdraw')).toEqual([
      memberOf,
    ]);
  });

  it('should answer 409 with every blocking reason for the token subject', async () => {
    // 하나씩 알려주면 고치고 다시 시도하기를 세 번 반복하게 된다
    const reasons = [
      WITHDRAWAL_BLOCKERS.ACTIVE_CONTRACT,
      WITHDRAWAL_BLOCKERS.POSITIVE_BALANCE,
    ];
    const controller = controllerWith({
      withdraw: vi.fn().mockRejectedValue(new WithdrawalBlockedError(reasons)),
    });

    const error = await rejectionOf(controller.withdraw(CALLER));

    expect(statusOf(error)).toBe(HttpStatus.CONFLICT);
    expect(bodyOf(error)).toMatchObject({
      errorCode: WITHDRAWAL_ERRORS.BLOCKED,
      reasons,
    });
  });

  it('should answer 404 when the token subject is not found', async () => {
    const controller = controllerWith({
      withdraw: vi.fn().mockRejectedValue(new MemberNotFoundError()),
    });

    const error = await rejectionOf(controller.withdraw(CALLER));

    expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
    expect(bodyOf(error)).toMatchObject({
      errorCode: WITHDRAWAL_ERRORS.NOT_FOUND,
    });
  });
});
