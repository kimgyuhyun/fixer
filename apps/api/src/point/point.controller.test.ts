import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { PAYMENT_ERRORS } from '@fixer/shared';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ChargeService, PaymentError } from './charge.service';
import { PointController } from './point.controller';
import type { PointHistoryService } from './point-history.service';

/**
 * 컨트롤러는 HTTP 경계다. 여기서 보는 것은 도메인 규칙이 아니라
 * **어떤 실패가 어떤 상태 코드가 되는가**이다.
 *
 * 이 파일이 없으면 401/403/400 매핑이 깨져도 CI가 못 잡는다 —
 * 실제로 손으로만 확인하고 넘어갈 뻔했다.
 */
function controllerWith(
  charge: Partial<ChargeService>,
  history: Partial<PointHistoryService> = {},
): PointController {
  return new PointController(
    charge as ChargeService,
    history as PointHistoryService,
  );
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

/** 웹훅 요청 흉내. `rawBody`가 서명 검증의 입력이다 */
function webhookRequest(body: string): Request {
  return {
    headers: { 'webhook-signature': 'sig' },
    rawBody: Buffer.from(body, 'utf8'),
  } as unknown as Request;
}

const CONFIRMED = {
  paymentId: 'pay_1',
  charged: 50_000,
  balance: 50_000,
  applied: true,
};

describe('POST /payments', () => {
  it('should return the started charge', async () => {
    const controller = controllerWith({
      start: vi.fn().mockResolvedValue({ paymentId: 'pay_1', amount: 50_000 }),
    });

    await expect(
      controller.start({ userId: 'usr_1', amount: 50_000 }),
    ).resolves.toEqual({ paymentId: 'pay_1', amount: 50_000 });
  });

  it('should return 400 when userId is missing', async () => {
    const start = vi.fn();
    const controller = controllerWith({ start });

    const error = await rejectionOf(controller.start({ amount: 50_000 }));

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
    // 서비스까지 가지 않는다. 회원을 모르면 결제 건을 만들 수 없다.
    expect(start).not.toHaveBeenCalled();
  });

  it('should return 400 with PAYMENT_INVALID_AMOUNT for a bad amount', async () => {
    const controller = controllerWith({
      start: vi
        .fn()
        .mockRejectedValue(new PaymentError(PAYMENT_ERRORS.INVALID_AMOUNT)),
    });

    const error = await rejectionOf(
      controller.start({ userId: 'usr_1', amount: 1_500 }),
    );

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(error).errorCode).toBe(PAYMENT_ERRORS.INVALID_AMOUNT);
  });
});

describe('POST /payments/confirm', () => {
  it('should return 200 with the charge result', async () => {
    const controller = controllerWith({
      confirm: vi.fn().mockResolvedValue(CONFIRMED),
    });

    await expect(
      controller.confirm({ userId: 'usr_1', paymentId: 'pay_1' }),
    ).resolves.toEqual(CONFIRMED);
  });

  it('should pass the logged-in member so another member cannot confirm', async () => {
    const confirm = vi.fn().mockResolvedValue(CONFIRMED);
    const controller = controllerWith({ confirm });

    await controller.confirm({ userId: 'usr_1', paymentId: 'pay_1' });

    expect(confirm).toHaveBeenCalledWith({
      paymentId: 'pay_1',
      userId: 'usr_1',
    });
  });

  it('should return 403 when the payment belongs to another member', async () => {
    const controller = controllerWith({
      confirm: vi
        .fn()
        .mockRejectedValue(new PaymentError(PAYMENT_ERRORS.NOT_OWNED)),
    });

    const error = await rejectionOf(
      controller.confirm({ userId: 'usr_1', paymentId: 'pay_1' }),
    );

    expect(statusOf(error)).toBe(HttpStatus.FORBIDDEN);
    expect(bodyOf(error).errorCode).toBe(PAYMENT_ERRORS.NOT_OWNED);
  });

  it('should return 409 when the amount did not match', async () => {
    // 요청의 모양은 옳고 상태가 아닌 것이라 409다.
    const controller = controllerWith({
      confirm: vi
        .fn()
        .mockRejectedValue(new PaymentError(PAYMENT_ERRORS.AMOUNT_MISMATCH)),
    });

    const error = await rejectionOf(
      controller.confirm({ userId: 'usr_1', paymentId: 'pay_1' }),
    );

    expect(statusOf(error)).toBe(HttpStatus.CONFLICT);
    expect(bodyOf(error).message).toContain('충전하지 않았습니다');
  });

  it('should return 409 when the payment is not paid yet', async () => {
    const controller = controllerWith({
      confirm: vi
        .fn()
        .mockRejectedValue(new PaymentError(PAYMENT_ERRORS.NOT_PAID)),
    });

    const error = await rejectionOf(
      controller.confirm({ userId: 'usr_1', paymentId: 'pay_1' }),
    );

    expect(statusOf(error)).toBe(HttpStatus.CONFLICT);
    expect(bodyOf(error).errorCode).toBe(PAYMENT_ERRORS.NOT_PAID);
  });

  it('should return 404 when no such payment exists', async () => {
    const controller = controllerWith({
      confirm: vi
        .fn()
        .mockRejectedValue(new PaymentError(PAYMENT_ERRORS.NOT_FOUND)),
    });

    const error = await rejectionOf(
      controller.confirm({ userId: 'usr_1', paymentId: 'pay_x' }),
    );

    expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
  });

  it('should return 400 when paymentId is missing', async () => {
    const controller = controllerWith({ confirm: vi.fn() });

    const error = await rejectionOf(controller.confirm({ userId: 'usr_1' }));

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
  });
});

describe('POST /payments/webhook', () => {
  it('should hand the raw body to the service so the signature can be checked', async () => {
    // 파싱한 뒤 다시 직렬화하면 키 순서나 공백이 달라져 서명이 맞지 않는다.
    const body = '{"data":{"paymentId":"pay_1"}}';
    const handleWebhook = vi.fn().mockResolvedValue(CONFIRMED);
    const controller = controllerWith({ handleWebhook });

    await controller.webhook(webhookRequest(body));

    expect(handleWebhook).toHaveBeenCalledWith(
      body,
      expect.objectContaining({ 'webhook-signature': 'sig' }),
    );
  });

  it('should return 401 when the signature does not verify', async () => {
    const controller = controllerWith({
      handleWebhook: vi
        .fn()
        .mockRejectedValue(
          new PaymentError(PAYMENT_ERRORS.WEBHOOK_SIGNATURE_INVALID),
        ),
    });

    const error = await rejectionOf(controller.webhook(webhookRequest('{}')));

    expect(statusOf(error)).toBe(HttpStatus.UNAUTHORIZED);
    expect(bodyOf(error).errorCode).toBe(
      PAYMENT_ERRORS.WEBHOOK_SIGNATURE_INVALID,
    );
  });

  it('should still answer 200 when the payment is unknown', async () => {
    // 200을 주지 않으면 포트원이 계속 재전송한다 (ADR-PAY-3). 서명만이
    // 거절 사유다.
    const controller = controllerWith({
      handleWebhook: vi
        .fn()
        .mockRejectedValue(new PaymentError(PAYMENT_ERRORS.NOT_FOUND)),
    });

    await expect(controller.webhook(webhookRequest('{}'))).resolves.toEqual({
      received: true,
    });
  });

  it('should let an unexpected error through so it becomes 500', async () => {
    // 여기서 삼키면 DB가 죽어도 포트원이 200을 받고 재전송을 멈춘다.
    const controller = controllerWith({
      handleWebhook: vi.fn().mockRejectedValue(new Error('DB가 죽었다')),
    });

    const error = await rejectionOf(controller.webhook(webhookRequest('{}')));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(HttpException);
  });
});

describe('GET /points/me', () => {
  it('should return the balance and transactions', async () => {
    const controller = controllerWith(
      {},
      {
        read: vi.fn().mockResolvedValue({ balance: 50_000, transactions: [] }),
      },
    );

    await expect(controller.myPoints('usr_1')).resolves.toEqual({
      balance: 50_000,
      transactions: [],
    });
  });

  it('should return 400 when no member is given', async () => {
    const read = vi.fn();
    const controller = controllerWith({}, { read });

    const error = await rejectionOf(controller.myPoints(undefined));

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
    expect(read).not.toHaveBeenCalled();
  });
});
