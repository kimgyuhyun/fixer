import { AUTH_COOKIES } from '@fixer/shared';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { setSessionCookies } from './auth-cookie';

const ACCESS_EXPIRES = new Date('2026-10-01T00:15:00.000Z');
const REFRESH_EXPIRES = new Date('2026-10-15T00:00:00.000Z');

describe('setSessionCookies', () => {
  it('should set fixer_access and fixer_refresh as httpOnly, secure, sameSite lax, path / cookies expiring with each token', () => {
    const cookie = vi.fn();
    const res = { cookie } as unknown as Response;

    setSessionCookies(res, {
      accessToken: { value: 'access-value', expiresAt: ACCESS_EXPIRES },
      refreshToken: { value: 'refresh-value', expiresAt: REFRESH_EXPIRES },
    });

    // 속성이 한 글자라도 다르면 로그아웃의 clearCookie가 이 쿠키를 못 지운다.
    expect(cookie.mock.calls).toEqual([
      [
        AUTH_COOKIES.access,
        'access-value',
        {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          expires: ACCESS_EXPIRES,
        },
      ],
      [
        AUTH_COOKIES.refresh,
        'refresh-value',
        {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          expires: REFRESH_EXPIRES,
        },
      ],
    ]);
  });
});
