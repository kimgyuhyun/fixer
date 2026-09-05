import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  AUTH_COOKIES,
  LOGIN_ERRORS,
  NOTIFICATION_ERRORS,
  type NotificationList,
} from '@fixer/shared';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { LoginError, type LoginService } from '../auth/login.service';
import { NotificationController } from './notification.controller';
import {
  NotificationError,
  type NotificationService,
} from './notification.service';

const USER = 'usr_1';

const LIST: NotificationList = {
  items: [
    {
      id: 'ntf_1',
      type: 'ACCOUNT_VERIFIED',
      title: '계좌 검증이 끝났습니다',
      body: '신한은행 ****5678 계좌를 쓸 수 있습니다.',
      linkUrl: '/my/account',
      read: false,
      createdAt: '2026-09-05T00:00:01.000Z',
    },
  ],
  unreadCount: 1,
};

/** 쿠키가 있으면 그 회원, 없으면 로그인 안 된 것으로 판정하는 가짜 세션 */
function logins(): LoginService {
  return {
    authenticate: (cookies: { accessToken?: string }) => {
      if (cookies.accessToken === undefined) {
        return Promise.reject(new LoginError(LOGIN_ERRORS.UNAUTHENTICATED));
      }
      return Promise.resolve({ userId: USER });
    },
  } as unknown as LoginService;
}

function controllerWith(
  impl: Partial<NotificationService>,
): NotificationController {
  return new NotificationController(impl as NotificationService, logins());
}

function fakeRequest(cookieHeader?: string): Request {
  return {
    headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
  } as unknown as Request;
}

function fakeResponse(): Response {
  return { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as Response;
}

function signedIn(): Request {
  return fakeRequest(`${AUTH_COOKIES.access}=valid-access-token`);
}

function bodyOf(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

function statusOf(error: unknown): number {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

describe('GET /notifications/me', () => {
  it('should return the caller’s list resolved from the session cookie', async () => {
    const list = vi.fn(() => Promise.resolve(LIST));
    const controller = controllerWith({ list });

    const result = await controller.mine(signedIn(), fakeResponse());

    expect(list).toHaveBeenCalledWith(USER);
    expect(result).toEqual(LIST);
  });

  it('should return 401 when no session cookie is present', async () => {
    const controller = controllerWith({
      list: vi.fn(() => Promise.resolve(LIST)),
    });

    const error = await rejectionOf(
      controller.mine(fakeRequest(), fakeResponse()),
    );

    expect(statusOf(error)).toBe(HttpStatus.UNAUTHORIZED);
  });
});

describe('POST /notifications/:id/read', () => {
  it('should return 404 with NOTIFICATION_NOT_FOUND when the notification is not the caller’s', async () => {
    const controller = controllerWith({
      markRead: vi.fn(() =>
        Promise.reject(new NotificationError(NOTIFICATION_ERRORS.NOT_FOUND)),
      ),
    });

    const error = await rejectionOf(
      controller.read('ntf_남의것', signedIn(), fakeResponse()),
    );

    expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
    expect(bodyOf(error).errorCode).toBe(NOTIFICATION_ERRORS.NOT_FOUND);
  });
});
