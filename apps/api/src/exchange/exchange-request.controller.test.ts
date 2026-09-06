import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { EXCHANGE_ERRORS } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { ExchangeRequestController } from './exchange-request.controller';
import {
  ExchangeError,
  type ExchangeRequestService,
} from './exchange-request.service';

const SUMMARY = {
  id: 'exr_1',
  amount: 10_000,
  status: 'REQUESTED' as const,
  requestedAt: '2026-09-06T00:00:00.000Z',
};

function controllerWith(
  impl: Partial<ExchangeRequestService>,
): ExchangeRequestController {
  return new ExchangeRequestController(impl as ExchangeRequestService);
}

function statusOf(error: unknown): number {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

function bodyOf(error: unknown): { errorCode?: string } {
  return (error as HttpException).getResponse() as { errorCode?: string };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

describe('POST /exchange-requests', () => {
  it('should respond 201 with the summary when every gate passes', async () => {
    const controller = controllerWith({
      request: vi.fn().mockResolvedValue(SUMMARY),
    });

    const result = await controller.request({
      userId: 'usr_worker',
      amount: 10_000,
    });

    expect(result).toEqual(SUMMARY);
  });

  // 사용자가 고칠 수 있는 입력값이다. 상태로 막힌 것과 구분한다.
  it('should respond 400 with EXCHANGE_BELOW_MIN_AMOUNT', async () => {
    const controller = controllerWith({
      request: vi
        .fn()
        .mockRejectedValue(new ExchangeError(EXCHANGE_ERRORS.BELOW_MIN_AMOUNT)),
    });

    const error = await rejectionOf(
      controller.request({ userId: 'usr_worker', amount: 4_000 }),
    );

    expect(statusOf(error)).toBe(400);
    expect(bodyOf(error).errorCode).toBe(EXCHANGE_ERRORS.BELOW_MIN_AMOUNT);
  });

  it('should respond 409 with EXCHANGE_ACCOUNT_NOT_VERIFIED', async () => {
    const controller = controllerWith({
      request: vi
        .fn()
        .mockRejectedValue(
          new ExchangeError(EXCHANGE_ERRORS.ACCOUNT_NOT_VERIFIED),
        ),
    });

    const error = await rejectionOf(
      controller.request({ userId: 'usr_worker', amount: 10_000 }),
    );

    expect(statusOf(error)).toBe(409);
    expect(bodyOf(error).errorCode).toBe(EXCHANGE_ERRORS.ACCOUNT_NOT_VERIFIED);
  });

  it('should respond 400 with VALIDATION_FAILED when amount is missing or not an integer', async () => {
    const controller = controllerWith({ request: vi.fn() });

    const missing = await rejectionOf(
      controller.request({ userId: 'usr_worker' }),
    );
    const fractional = await rejectionOf(
      controller.request({ userId: 'usr_worker', amount: 10_000.5 }),
    );

    expect(statusOf(missing)).toBe(400);
    expect(bodyOf(missing).errorCode).toBe('VALIDATION_FAILED');
    expect(statusOf(fractional)).toBe(400);
    expect(bodyOf(fractional).errorCode).toBe('VALIDATION_FAILED');
  });
});
