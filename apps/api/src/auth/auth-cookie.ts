import type { Response } from 'express';
import type { SessionTokens } from './login.service';

/**
 * 세션 토큰 두 개를 쿠키로 심는다. (spec-fixed §2.5, #82)
 *
 * 로그인·가입·재활성화가 함께 쓴다. 속성이 한 곳에 있어야 셋이 같은 쿠키를
 * 심는다 — 하나라도 다르면 브라우저가 다른 쿠키로 보고 로그아웃이 지우지 못한다.
 */
export function setSessionCookies(
  _res: Response,
  _tokens: SessionTokens,
): void {
  throw new Error('not implemented');
}
