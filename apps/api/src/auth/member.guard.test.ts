import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { AUTH_COOKIES, LOGIN_ERRORS } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  LoginError,
  type AuthenticatedSession,
  type LoginService,
  type SessionCookies,
} from './login.service';
import { MemberGuard, memberOf, type RequestWithMember } from './member.guard';

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

/** 무엇을 들고 와도 로그인 안 된 것으로 보는 가짜 */
function rejectingLogins(): LoginService {
  return {
    authenticate: () =>
      Promise.reject(new LoginError(LOGIN_ERRORS.UNAUTHENTICATED)),
  } as unknown as LoginService;
}

/** 쿠키 헤더 한 줄을 들고 오는 가짜 요청·응답 */
function contextWith(cookieHeader: string | undefined): {
  context: ExecutionContext;
  request: RequestWithMember;
  cookie: ReturnType<typeof vi.fn>;
} {
  const request = { headers: { cookie: cookieHeader } } as RequestWithMember;
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

function statusOf(error: unknown): number {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

function bodyOf(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

describe('MemberGuard', () => {
  it('should put the token subject on the request when the access cookie is valid', async () => {
    const { context, request } = contextWith(
      `${AUTH_COOKIES.access}=valid-access-token`,
    );
    const guard = new MemberGuard(logins(() => ({ userId: MEMBER })));

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.member).toEqual({ userId: MEMBER });
  });

  it('should renew the access cookie and continue when the access token expired but the refresh token is alive', async () => {
    const renewedAt = new Date('2026-09-20T00:15:00.000Z');
    const { context, request, cookie } = contextWith(
      `${AUTH_COOKIES.access}=expired; ${AUTH_COOKIES.refresh}=alive`,
    );
    const guard = new MemberGuard(
      logins(() => ({
        userId: MEMBER,
        renewedAccessToken: { value: 'fresh-access', expiresAt: renewedAt },
      })),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.member).toEqual({ userId: MEMBER });
    // 속성이 `login.controller.ts`의 `AUTH_COOKIE_OPTIONS`와 한 글자도
    // 달라선 안 된다. 다르면 브라우저가 다른 쿠키로 보고 덮어쓰지 못한다.
    expect(cookie).toHaveBeenCalledWith(AUTH_COOKIES.access, 'fresh-access', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: renewedAt,
    });
  });

  it('should not set a renewed cookie when the access token is still valid', async () => {
    const { context, cookie } = contextWith(
      `${AUTH_COOKIES.access}=valid-access-token`,
    );
    const guard = new MemberGuard(logins(() => ({ userId: MEMBER })));

    await guard.canActivate(context);

    expect(cookie).not.toHaveBeenCalled();
  });

  it('should authenticate from the refresh cookie alone when the access cookie is absent', async () => {
    const { context, request } = contextWith(`${AUTH_COOKIES.refresh}=alive`);
    const guard = new MemberGuard(
      logins((cookies) => {
        expect(cookies.accessToken).toBeUndefined();
        return { userId: MEMBER };
      }),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.member).toEqual({ userId: MEMBER });
  });

  it('should answer 401 LOGIN_UNAUTHENTICATED when the request carries no cookie header', async () => {
    const { context } = contextWith(undefined);
    const guard = new MemberGuard(logins(() => ({ userId: MEMBER })));

    const error = await guard.canActivate(context).catch((e: unknown) => e);

    expect(statusOf(error)).toBe(HttpStatus.UNAUTHORIZED);
    expect(bodyOf(error).errorCode).toBe(LOGIN_ERRORS.UNAUTHENTICATED);
  });

  it('should answer 401 when both cookies are present but neither is valid', async () => {
    const { context } = contextWith(
      `${AUTH_COOKIES.access}=tampered; ${AUTH_COOKIES.refresh}=unknown`,
    );
    const guard = new MemberGuard(rejectingLogins());

    const error = await guard.canActivate(context).catch((e: unknown) => e);

    expect(statusOf(error)).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('should answer 401 for the same request after logout, when the browser no longer sends the auth cookies', async () => {
    const guard = new MemberGuard(logins(() => ({ userId: MEMBER })));
    const signedIn = contextWith(
      `${AUTH_COOKIES.access}=valid-access-token; ${AUTH_COOKIES.refresh}=alive`,
    );
    await expect(guard.canActivate(signedIn.context)).resolves.toBe(true);

    // 로그아웃이 두 쿠키를 지운다(`login.controller.ts`). 브라우저는 그 뒤로
    // 같은 요청을 쿠키 없이 보낸다.
    const afterLogout = contextWith(undefined);
    const error = await guard
      .canActivate(afterLogout.context)
      .catch((e: unknown) => e);

    expect(statusOf(error)).toBe(HttpStatus.UNAUTHORIZED);
  });
});

describe('CurrentMember', () => {
  it('should return the userId that the guard put on the request', () => {
    const { context, request } = contextWith(undefined);
    request.member = { userId: MEMBER };

    expect(memberOf(undefined, context)).toBe(MEMBER);
  });

  it('should throw when the route has no MemberGuard', () => {
    // 가드 없이 붙은 라우트다. 조용히 빈 문자열을 주면 남의 데이터를
    // 회원 id 없이 조회하게 된다.
    const { context } = contextWith(undefined);

    expect(() => memberOf(undefined, context)).toThrow();
  });
});
