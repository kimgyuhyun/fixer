import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ADMIN_ERRORS, AUTH_COOKIES, LOGIN_ERRORS } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  LoginError,
  type AuthenticatedSession,
  type LoginService,
  type SessionCookies,
} from '../auth/login.service';
import {
  AdminGuard,
  type RequestWithAdmin,
  type RoleReader,
} from './admin.guard';

const ADMIN = 'usr_admin';
const MEMBER = 'usr_member';

/** 세션을 흉내 내는 가짜. 쿠키를 보고 정해진 답을 돌려준다 */
function logins(
  answer: (cookies: SessionCookies) => AuthenticatedSession,
): LoginService {
  return {
    authenticate: (cookies: SessionCookies) => {
      // 진짜 `authenticate`도 둘 다 없으면 여기서 끝난다.
      if (
        cookies.accessToken === undefined &&
        cookies.refreshToken === undefined
      ) {
        return Promise.reject(new LoginError(LOGIN_ERRORS.UNAUTHENTICATED));
      }
      return Promise.resolve(answer(cookies));
    },
  } as unknown as LoginService;
}

function roles(table: Record<string, 'USER' | 'ADMIN'>): RoleReader {
  return { roleOf: (userId) => Promise.resolve(table[userId] ?? null) };
}

/** 쿠키 헤더 한 줄을 들고 오는 가짜 요청·응답 */
function contextWith(cookieHeader: string | undefined): {
  context: ExecutionContext;
  request: RequestWithAdmin;
  cookie: ReturnType<typeof vi.fn>;
} {
  const request = { headers: { cookie: cookieHeader } } as RequestWithAdmin;
  const cookie = vi.fn();
  const response = { cookie };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, request, cookie };
}

function cookieHeader(parts: Record<string, string>): string {
  return Object.entries(parts)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

describe('AdminGuard', () => {
  it('should allow the request when the access cookie belongs to a user whose role is ADMIN', async () => {
    const guard = new AdminGuard(
      logins(() => ({ userId: ADMIN })),
      roles({ [ADMIN]: 'ADMIN' }),
    );
    const { context } = contextWith(
      cookieHeader({ [AUTH_COOKIES.access]: 'tok' }),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('should expose the authenticated user id as the admin principal when it allows the request', async () => {
    const guard = new AdminGuard(
      logins(() => ({ userId: ADMIN })),
      roles({ [ADMIN]: 'ADMIN' }),
    );
    const { context, request } = contextWith(
      cookieHeader({ [AUTH_COOKIES.access]: 'tok' }),
    );

    await guard.canActivate(context);

    expect(request.admin).toEqual({ userId: ADMIN });
  });

  it('should allow the request and set a renewed access cookie when the access token expired but the refresh token is alive', async () => {
    const expiresAt = new Date('2026-09-05T10:15:00.000Z');
    const guard = new AdminGuard(
      logins(() => ({
        userId: ADMIN,
        renewedAccessToken: { value: 'fresh', expiresAt },
      })),
      roles({ [ADMIN]: 'ADMIN' }),
    );
    const { context, cookie } = contextWith(
      cookieHeader({ [AUTH_COOKIES.refresh]: 'ref' }),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(cookie).toHaveBeenCalledWith(
      AUTH_COOKIES.access,
      'fresh',
      expect.objectContaining({ httpOnly: true, expires: expiresAt }),
    );
  });

  it('should throw AUTH_UNAUTHENTICATED when the request carries neither an access nor a refresh cookie', async () => {
    const guard = new AdminGuard(
      logins(() => ({ userId: ADMIN })),
      roles({ [ADMIN]: 'ADMIN' }),
    );
    const { context } = contextWith(undefined);

    const error = await guard.canActivate(context).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect((error as HttpException).getResponse()).toMatchObject({
      errorCode: LOGIN_ERRORS.UNAUTHENTICATED,
    });
  });

  it('should throw AUTH_UNAUTHENTICATED when the access cookie is forged and no refresh cookie is present', async () => {
    const guard = new AdminGuard(
      // 위조된 Access는 검증에 실패하고, 되살릴 Refresh가 없으면 끝난다.
      {
        authenticate: () =>
          Promise.reject(new LoginError(LOGIN_ERRORS.UNAUTHENTICATED)),
      } as unknown as LoginService,
      roles({ [ADMIN]: 'ADMIN' }),
    );
    const { context } = contextWith(
      cookieHeader({ [AUTH_COOKIES.access]: 'forged' }),
    );

    const error = await guard.canActivate(context).catch((e: unknown) => e);

    expect((error as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('should throw ADMIN_FORBIDDEN when the authenticated user no longer exists', async () => {
    const guard = new AdminGuard(
      logins(() => ({ userId: 'usr_gone' })),
      // 그 회원이 표에 없다 — `roleOf`가 null이다.
      roles({ [ADMIN]: 'ADMIN' }),
    );
    const { context } = contextWith(
      cookieHeader({ [AUTH_COOKIES.access]: 'tok' }),
    );

    const error = await guard.canActivate(context).catch((e: unknown) => e);

    expect((error as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect((error as HttpException).getResponse()).toMatchObject({
      errorCode: ADMIN_ERRORS.FORBIDDEN,
    });
  });

  it("should throw ADMIN_FORBIDDEN when the user's role is USER", async () => {
    const guard = new AdminGuard(
      logins(() => ({ userId: MEMBER })),
      roles({ [ADMIN]: 'ADMIN', [MEMBER]: 'USER' }),
    );
    const { context } = contextWith(
      cookieHeader({ [AUTH_COOKIES.access]: 'tok' }),
    );

    const error = await guard.canActivate(context).catch((e: unknown) => e);

    expect((error as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect((error as HttpException).getResponse()).toMatchObject({
      errorCode: ADMIN_ERRORS.FORBIDDEN,
    });
  });
});
