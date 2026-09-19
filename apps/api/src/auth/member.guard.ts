import {
  Injectable,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { AUTH_COOKIES } from '@fixer/shared';
import type { Request, Response } from 'express';
import { LoginError, LoginService } from './login.service';
import { LoginHttpError } from './login.http-error';

/** 가드를 통과한 요청에 심어 두는 주체 */
export interface MemberPrincipal {
  userId: string;
}

/** 가드가 주체를 얹은 요청 */
export interface RequestWithMember extends Request {
  member?: MemberPrincipal;
}

/**
 * 로그인한 회원만 통과시킨다. (이슈 #69)
 *
 * `AdminGuard`에서 `role === ADMIN` 검사만 뺀 것과 같다. 누구인지 판정하는
 * 경로를 `/api/auth/me`·#36·`AdminGuard`와 하나로 둔다.
 *
 * 토큰을 직접 검증하지 않는 이유가 있다. `authenticate`는 Access가 만료돼도
 * Refresh가 살아 있으면 Access를 다시 발급한다 (ADR-AUTH-1). 가드가 Access
 * 쿠키만 보면 **15분마다 튕기는** 화면이 된다.
 */
@Injectable()
export class MemberGuard implements CanActivate {
  constructor(private readonly logins: LoginService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithMember>();
    const response = http.getResponse<Response>();

    request.member = { userId: await this.callerOf(request, response) };
    return true;
  }

  /**
   * 쿠키에서 회원을 뽑는다. Access가 만료됐어도 Refresh가 살아 있으면
   * 갱신하고 그대로 진행한다 — `/api/auth/me`·#36과 같은 처리다.
   */
  private async callerOf(
    request: Request,
    response: Response,
  ): Promise<string> {
    const cookies = parseCookies(request.headers.cookie);
    try {
      const session = await this.logins.authenticate({
        accessToken: cookies[AUTH_COOKIES.access],
        refreshToken: cookies[AUTH_COOKIES.refresh],
      });

      if (session.renewedAccessToken) {
        // 속성이 `login.controller.ts`의 `AUTH_COOKIE_OPTIONS`와 **한 글자도
        // 달라선 안 된다.** 하나라도 다르면 브라우저가 다른 쿠키로 보고
        // 갱신분이 원래 것을 덮어쓰지 못한다.
        response.cookie(AUTH_COOKIES.access, session.renewedAccessToken.value, {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          expires: session.renewedAccessToken.expiresAt,
        });
      }

      return session.userId;
    } catch (error) {
      throw error instanceof LoginError
        ? new LoginHttpError(error.code)
        : error;
    }
  }
}

/**
 * `Cookie` 헤더를 이름-값으로 가른다.
 *
 * `login.controller.ts`·`notification.controller.ts`·`admin.guard.ts`에 같은
 * 함수가 있다. 넷을 공용으로 빼는 것은 Refactor 단계에서 한다.
 */
function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === undefined) return cookies;

  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;

    const name = pair.slice(0, separator).trim();
    if (name === '') continue;
    cookies[name] = decodeURIComponent(pair.slice(separator + 1).trim());
  }

  return cookies;
}

/** 가드가 심어 둔 주체를 꺼낸다. `CurrentMember`의 본체 */
export function memberOf(_data: unknown, context: ExecutionContext): string {
  const request = context.switchToHttp().getRequest<RequestWithMember>();
  const member = request.member;
  if (member === undefined) {
    // 가드 없이 붙은 라우트다. 조용히 빈 문자열을 주면 회원 id가 빈 채로
    // 서비스까지 내려간다.
    throw new Error('MemberGuard가 없는 라우트에서 CurrentMember를 썼다');
  }
  return member.userId;
}

/** 컨트롤러가 회원 id를 꺼내는 파라미터 데코레이터 */
export const CurrentMember = createParamDecorator(memberOf);
