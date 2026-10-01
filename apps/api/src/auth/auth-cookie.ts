import { AUTH_COOKIES } from '@fixer/shared';
import type { CookieOptions, Response } from 'express';
import type { SessionTokens } from './login.service';

/**
 * 세션 토큰 두 개를 쿠키로 심는다. (spec-fixed §2.5, #82)
 *
 * 로그인·가입·재활성화가 함께 쓴다. 속성이 한 곳에 있어야 셋이 같은 쿠키를
 * 심는다 — 하나라도 다르면 브라우저가 다른 쿠키로 보고 로그아웃이 지우지 못한다.
 */
export function setSessionCookies(res: Response, tokens: SessionTokens): void {
  setAuthCookie(res, AUTH_COOKIES.access, tokens.accessToken);
  setAuthCookie(res, AUTH_COOKIES.refresh, tokens.refreshToken);
}

/**
 * 토큰 쿠키의 공통 속성. (spec-fixed §2.5)
 *
 * `secure`는 개발 중에도 켜둔다. 브라우저가 `localhost`를 안전한 출처로
 * 취급하므로 http로도 저장되고, 환경에 따라 속성이 달라지지 않는 편이 낫다.
 */
export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

export function setAuthCookie(
  res: Response,
  name: string,
  token: { value: string; expiresAt: Date },
): void {
  res.cookie(name, token.value, {
    ...AUTH_COOKIE_OPTIONS,
    expires: token.expiresAt,
  });
}
