import {
  ForbiddenException,
  Inject,
  Injectable,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ADMIN_ERRORS, AUTH_COOKIES, type UserRole } from '@fixer/shared';
import type { Request, Response } from 'express';
import { LoginError, LoginService } from '../auth/login.service';
import { LoginHttpError } from '../auth/login.http-error';

/** 가드를 통과한 요청에 심어 두는 주체. 감사 로그의 "누가"가 여기서 온다 */
export interface AdminPrincipal {
  userId: string;
}

/** 가드가 주체를 얹은 요청 */
export interface RequestWithAdmin extends Request {
  admin?: AdminPrincipal;
}

/**
 * `RoleReader`는 인터페이스라 Nest가 타입만으로는 못 찾는다. 주입 지점을
 * 가리킬 토큰이 하나 필요하다 — #32~#34도 이 토큰으로 붙는다.
 */
export const ROLE_READER = Symbol('RoleReader');

/**
 * `role`을 묻는 포트(port, 바깥 세계와 닿는 자리를 인터페이스로 끊어 둔 것).
 *
 * 가드가 Prisma를 직접 알면 가드 테스트에 DB가 필요해진다.
 */
export interface RoleReader {
  /** 그 회원의 등급. 없는 회원이면 null */
  roleOf(userId: string): Promise<UserRole | null>;
}

/**
 * 관리자만 통과시킨다. (`spec-fixed.md` §11.1)
 *
 * **"누구인가"는 이 가드가 판정하지 않는다.** `LoginService.authenticate`가
 * #36·`/api/auth/me`와 같은 경로로 이미 하고 있고, 가드는 그 결과에
 * **`role === ADMIN`만** 덧붙인다.
 *
 * 토큰을 직접 검증하지 않는 이유가 있다. `authenticate`는 Access가 만료돼도
 * Refresh가 살아 있으면 Access를 다시 발급한다 (ADR-AUTH-1). 가드가 Access
 * 쿠키만 보면 **관리자 화면만 15분마다 튕기는** 화면이 된다.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly logins: LoginService,
    @Inject(ROLE_READER) private readonly roles: RoleReader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithAdmin>();
    const response = http.getResponse<Response>();

    const userId = await this.callerOf(request, response);

    if ((await this.roles.roleOf(userId)) !== 'ADMIN') {
      // 없는 회원도 여기로 온다. 관리자가 아닌 것과 구분해 알려줄 이유가
      // 없고, 구분하면 그 id가 실재하는지가 새어나간다.
      throw new ForbiddenException({
        errorCode: ADMIN_ERRORS.FORBIDDEN,
        message: '관리자만 접근할 수 있습니다.',
      });
    }

    request.admin = { userId };
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
 * `login.controller.ts`·`notification.controller.ts`에 같은 함수가 있다.
 * 셋을 공용으로 빼는 것은 Refactor 단계에서 한다.
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

/** 컨트롤러가 관리자 id를 꺼내는 파라미터 데코레이터 */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>();
    const admin = request.admin;
    if (admin === undefined) {
      // 가드 없이 붙은 라우트다. 조용히 빈 문자열을 주면 감사 로그의
      // "누가"가 빈 채로 남는다.
      throw new Error('AdminGuard가 없는 라우트에서 CurrentAdmin을 썼다');
    }
    return admin.userId;
  },
);
