import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { REACTIVATION_ERRORS } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { ReactivationController } from './reactivation.controller';
import {
  ReactivationError,
  type ReactivationService,
} from './reactivation.service';

function controllerWith(
  impl: Partial<ReactivationService>,
): ReactivationController {
  return new ReactivationController(impl as ReactivationService);
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

const REQUEST = { email: 'worker@example.com', password: 'new-Password-1!' };

const REVIVED = {
  id: 'usr_original',
  email: 'worker@example.com',
  name: '김구직',
  createdAt: '2026-01-15T09:00:00.000Z',
};

describe('POST /auth/reactivate', () => {
  it('should return 200 with the member', async () => {
    // 201이 아니다. 새로 만든 것이 아니라 되살린 것이다.
    const controller = controllerWith({
      reactivate: vi.fn().mockResolvedValue(REVIVED),
    });

    await expect(controller.reactivate(REQUEST)).resolves.toEqual(REVIVED);
  });

  it('should return 403 when the email was not verified', async () => {
    const controller = controllerWith({
      reactivate: vi
        .fn()
        .mockRejectedValue(
          new ReactivationError(REACTIVATION_ERRORS.EMAIL_NOT_VERIFIED),
        ),
    });

    const error = await rejectionOf(controller.reactivate(REQUEST));

    expect(statusOf(error)).toBe(HttpStatus.FORBIDDEN);
  });

  it('should return 404 when there is nothing to revive', async () => {
    const controller = controllerWith({
      reactivate: vi
        .fn()
        .mockRejectedValue(
          new ReactivationError(REACTIVATION_ERRORS.NOT_DEACTIVATED),
        ),
    });

    const error = await rejectionOf(controller.reactivate(REQUEST));

    expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
    expect(bodyOf(error)).toMatchObject({
      errorCode: REACTIVATION_ERRORS.NOT_DEACTIVATED,
    });
  });

  it('should return 400 when the password does not meet the rules', async () => {
    const controller = controllerWith({ reactivate: vi.fn() });

    const error = await rejectionOf(
      controller.reactivate({ ...REQUEST, password: 'short' }),
    );

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(error)).toHaveProperty('fieldErrors.password');
  });
});
