import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AUTH_COOKIES, REACTIVATION_ERRORS } from '@fixer/shared';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { LoginService, SessionTokens } from './login.service';
import { ReactivationController } from './reactivation.controller';
import {
  ReactivationError,
  type ReactivationService,
} from './reactivation.service';

function controllerWith(
  impl: Partial<ReactivationService>,
  logins: Partial<LoginService> = sessionStarter(),
): ReactivationController {
  return new ReactivationController(
    impl as ReactivationService,
    logins as LoginService,
  );
}

const SESSION: SessionTokens = {
  accessToken: {
    value: 'access-token-value',
    expiresAt: new Date('2026-09-01T00:15:00.000Z'),
  },
  refreshToken: {
    value: 'refresh-token-value',
    expiresAt: new Date('2026-09-15T00:00:00.000Z'),
  },
};

/** 되살린 직후 세션을 여는 쪽 (ADR-AUTH-5) */
function sessionStarter() {
  return { startSession: vi.fn().mockResolvedValue(SESSION) };
}

function fakeResponse() {
  const cookie = vi.fn();
  return { res: { cookie } as unknown as Response, cookie };
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

    await expect(
      controller.reactivate(REQUEST, fakeResponse().res),
    ).resolves.toEqual(REVIVED);
  });

  it('should return 403 when the email was not verified', async () => {
    const controller = controllerWith({
      reactivate: vi
        .fn()
        .mockRejectedValue(
          new ReactivationError(REACTIVATION_ERRORS.EMAIL_NOT_VERIFIED),
        ),
    });

    const error = await rejectionOf(
      controller.reactivate(REQUEST, fakeResponse().res),
    );

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

    const error = await rejectionOf(
      controller.reactivate(REQUEST, fakeResponse().res),
    );

    expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
    expect(bodyOf(error)).toMatchObject({
      errorCode: REACTIVATION_ERRORS.NOT_DEACTIVATED,
    });
  });

  it('should return 400 when the password does not meet the rules', async () => {
    const controller = controllerWith({ reactivate: vi.fn() });

    const error = await rejectionOf(
      controller.reactivate(
        { ...REQUEST, password: 'short' },
        fakeResponse().res,
      ),
    );

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(error)).toHaveProperty('fieldErrors.password');
  });

  it('should set both auth cookies from a session started for the reactivated member when reactivation succeeds', async () => {
    const logins = sessionStarter();
    const controller = controllerWith(
      { reactivate: vi.fn().mockResolvedValue(REVIVED) },
      logins,
    );
    const { res, cookie } = fakeResponse();

    await controller.reactivate(REQUEST, res);

    // 되살린 화면은 곧장 마이페이지로 간다. 세션이 없으면 거기서 막힌다.
    expect({
      startedFor: logins.startSession.mock.calls.map((call) => call[0]),
      cookies: cookie.mock.calls.map((call) => [call[0], call[1]]),
    }).toEqual({
      startedFor: [REVIVED.id],
      cookies: [
        [AUTH_COOKIES.access, SESSION.accessToken.value],
        [AUTH_COOKIES.refresh, SESSION.refreshToken.value],
      ],
    });
  });

  it('should set no cookie and start no session when the email is not verified', async () => {
    const logins = sessionStarter();
    const controller = controllerWith(
      {
        reactivate: vi
          .fn()
          .mockRejectedValue(
            new ReactivationError(REACTIVATION_ERRORS.EMAIL_NOT_VERIFIED),
          ),
      },
      logins,
    );
    const { res, cookie } = fakeResponse();

    await rejectionOf(controller.reactivate(REQUEST, res));

    expect({
      sessions: logins.startSession.mock.calls.length,
      cookies: cookie.mock.calls.length,
    }).toEqual({ sessions: 0, cookies: 0 });
  });
});
