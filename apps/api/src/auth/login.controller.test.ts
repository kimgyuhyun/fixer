import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AUTH_COOKIES, LOGIN_ERRORS } from '@fixer/shared';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { LoginController } from './login.controller';
import { LoginError, type LoginService } from './login.service';

/**
 * 컨트롤러는 HTTP 경계다. 여기서 보는 것은 도메인 규칙이 아니라
 * "토큰이 어떤 쿠키 속성으로 나가는가"와 "어떤 실패가 어떤 상태가 되는가"다.
 */
function controllerWith(impl: Partial<LoginService>): LoginController {
  return new LoginController(impl as LoginService);
}

/** `@Res({ passthrough: true })`가 넘겨주는 것 중 우리가 쓰는 것만 흉내낸다 */
function fakeResponse() {
  return { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as Response & {
    cookie: ReturnType<typeof vi.fn>;
  };
}

/**
 * 지운 쿠키를 확인할 때 쓴다.
 *
 * `res.clearCookie`를 그대로 넘기면 express 타입의 메서드 선언 때문에
 * `unbound-method`에 걸린다. 목만 꺼내 주는 창구를 따로 둔다.
 */
function clearCookieMock(res: Response): ReturnType<typeof vi.fn> {
  return (res as unknown as { clearCookie: ReturnType<typeof vi.fn> })
    .clearCookie;
}

/** 쿠키 헤더만 들고 있는 요청 */
function fakeRequest(cookieHeader?: string): Request {
  return {
    headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
  } as unknown as Request;
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

const NOW = new Date('2026-09-01T00:00:00.000Z');

const CREDENTIALS = { email: 'worker@example.com', password: 'good-password' };

const ISSUED = {
  user: { id: 'usr_1', email: 'worker@example.com', name: '김구직' },
  accessToken: { value: 'access-token-value', expiresAt: NOW },
  refreshToken: { value: 'refresh-token-value', expiresAt: NOW },
};

const PROFILE = {
  id: 'usr_1',
  email: 'worker@example.com',
  name: '김구직',
  address: null,
  createdAt: NOW.toISOString(),
};

describe('POST /auth/login', () => {
  it('should set the access and refresh tokens as httpOnly, secure, SameSite=Lax cookies and keep them out of the body', async () => {
    const controller = controllerWith({
      login: () => Promise.resolve(ISSUED),
    });
    const res = fakeResponse();

    const body = await controller.login(CREDENTIALS, res);

    const cookieOptions = expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    }) as unknown;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- 호출하지 않고 vi.fn()이 기록한 호출 이력만 읽는다
    expect(res.cookie).toHaveBeenCalledWith(
      AUTH_COOKIES.access,
      ISSUED.accessToken.value,
      cookieOptions,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- 호출하지 않고 vi.fn()이 기록한 호출 이력만 읽는다
    expect(res.cookie).toHaveBeenCalledWith(
      AUTH_COOKIES.refresh,
      ISSUED.refreshToken.value,
      cookieOptions,
    );
    // 본문에도 실으면 자바스크립트가 읽을 수 있어 httpOnly가 무의미해진다.
    expect(JSON.stringify(body)).not.toContain(ISSUED.accessToken.value);
    expect(JSON.stringify(body)).not.toContain(ISSUED.refreshToken.value);
  });

  it('should return 401 with AUTH_INVALID_CREDENTIALS when the credentials are rejected', async () => {
    const controller = controllerWith({
      login: () => {
        throw new LoginError(LOGIN_ERRORS.INVALID_CREDENTIALS);
      },
    });

    const error = await rejectionOf(
      controller.login(CREDENTIALS, fakeResponse()),
    );

    expect(statusOf(error)).toBe(HttpStatus.UNAUTHORIZED);
    expect(bodyOf(error).errorCode).toBe(LOGIN_ERRORS.INVALID_CREDENTIALS);
  });
});

describe('GET /auth/me', () => {
  it('should return the profile and set a renewed access cookie when the access token expired', async () => {
    const controller = controllerWith({
      authenticate: () =>
        Promise.resolve({
          userId: 'usr_1',
          renewedAccessToken: { value: 'renewed-access-token', expiresAt: NOW },
        }),
      getMyProfile: () => Promise.resolve(PROFILE),
    });
    const res = fakeResponse();

    const profile = await controller.me(
      fakeRequest(
        `${AUTH_COOKIES.access}=expired; ${AUTH_COOKIES.refresh}=refresh-token-value`,
      ),
      res,
    );

    expect(profile).toEqual(PROFILE);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- 호출하지 않고 vi.fn()이 기록한 호출 이력만 읽는다
    expect(res.cookie).toHaveBeenCalledWith(
      AUTH_COOKIES.access,
      'renewed-access-token',
      expect.objectContaining({ httpOnly: true }) as unknown,
    );
  });

  it('should return 401 with AUTH_UNAUTHENTICATED when no cookie is sent', async () => {
    const controller = controllerWith({
      authenticate: () => {
        throw new LoginError(LOGIN_ERRORS.UNAUTHENTICATED);
      },
    });

    const error = await rejectionOf(
      controller.me(fakeRequest(), fakeResponse()),
    );

    expect(statusOf(error)).toBe(HttpStatus.UNAUTHORIZED);
    expect(bodyOf(error).errorCode).toBe(LOGIN_ERRORS.UNAUTHENTICATED);
  });
});

describe('POST /auth/logout', () => {
  it('should return 204 and clear both auth cookies', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ logout });
    const res = fakeResponse();
    const clearCookie = clearCookieMock(res);

    await controller.logout(
      fakeRequest(`${AUTH_COOKIES.refresh}=refresh-token-value`),
      res,
    );

    // 심을 때와 같은 속성으로 지워야 브라우저가 같은 쿠키로 알아본다
    expect(clearCookie).toHaveBeenCalledWith(
      AUTH_COOKIES.access,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
    expect(clearCookie).toHaveBeenCalledWith(
      AUTH_COOKIES.refresh,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
    expect(logout).toHaveBeenCalledWith('refresh-token-value');
  });

  it('should return 204 even when the request carries no cookies', async () => {
    // 로그아웃은 멱등하다. 이미 로그아웃된 사람이 다시 눌러도 에러를 보지 않는다.
    const logout = vi.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ logout });
    const res = fakeResponse();

    await expect(
      controller.logout(fakeRequest(), res),
    ).resolves.toBeUndefined();

    expect(logout).toHaveBeenCalledWith(undefined);
  });

  it('should return 401 from GET /auth/me when the refresh token was deleted by a logout', async () => {
    // AC4를 HTTP 경계에서 확인한다
    const authenticate = vi
      .fn()
      .mockRejectedValue(new LoginError(LOGIN_ERRORS.UNAUTHENTICATED));
    const controller = controllerWith({ authenticate });

    const error = await rejectionOf(
      controller.me(
        fakeRequest(`${AUTH_COOKIES.refresh}=deleted-token`),
        fakeResponse(),
      ),
    );

    expect(statusOf(error)).toBe(HttpStatus.UNAUTHORIZED);
    expect(bodyOf(error)).toMatchObject({
      errorCode: LOGIN_ERRORS.UNAUTHENTICATED,
    });
  });
});
