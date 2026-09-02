import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  AUTH_COOKIES,
  loginRequestSchema,
  myProfileSchema,
  signedInSchema,
  type MyProfile,
  type SignedIn,
} from '@fixer/shared';
import type { CookieOptions, Request, Response } from 'express';
import { ZodError } from 'zod';
import { LoginError, LoginService } from './login.service';
import { LoginHttpError } from './login.http-error';

/**
 * 로그인과 마이페이지의 HTTP 경계. (이슈 #4)
 *
 * 토큰은 응답 본문이 아니라 httpOnly 쿠키로만 나간다. 본문에도 실으면
 * 자바스크립트가 읽을 수 있게 되어 httpOnly가 무의미해진다.
 */
@Controller('auth')
export class LoginController {
  constructor(private readonly service: LoginService) {}

  /** 로그인 */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignedIn> {
    try {
      const input = loginRequestSchema.parse(body);
      const session = await this.service.login(input);

      setAuthCookie(res, AUTH_COOKIES.access, session.accessToken);
      setAuthCookie(res, AUTH_COOKIES.refresh, session.refreshToken);

      // 응답도 공유 스키마로 파싱한다. 스키마에 토큰 자리가 없으므로
      // 실수로 얹어 보내도 여기서 떨어져 나간다.
      return signedInSchema.parse(session.user);
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 내 정보. Access가 만료됐어도 Refresh가 살아 있으면 갱신하고 그대로 진행한다 */
  @Get('me')
  async me(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MyProfile> {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const session = await this.service.authenticate({
        accessToken: cookies[AUTH_COOKIES.access],
        refreshToken: cookies[AUTH_COOKIES.refresh],
      });

      // 갱신됐으면 새 Access를 심는다. Refresh는 회전하지 않으므로 그대로 둔다.
      if (session.renewedAccessToken) {
        setAuthCookie(res, AUTH_COOKIES.access, session.renewedAccessToken);
      }

      return myProfileSchema.parse(
        await this.service.getMyProfile(session.userId),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 로그아웃. 쿠키를 지우고 서버의 Refresh 행도 지운다 */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const cookies = parseCookies(req.headers.cookie);
    await this.service.logout(cookies[AUTH_COOKIES.refresh]);

    // 심을 때와 같은 속성으로 지워야 브라우저가 같은 쿠키로 알아본다.
    // 속성이 하나라도 다르면 지워지지 않고 남는다.
    res.clearCookie(AUTH_COOKIES.access, AUTH_COOKIE_OPTIONS);
    res.clearCookie(AUTH_COOKIES.refresh, AUTH_COOKIE_OPTIONS);
  }
}

/**
 * 토큰 쿠키의 공통 속성. (spec-fixed §2.5)
 *
 * `secure`는 개발 중에도 켜둔다. 브라우저가 `localhost`를 안전한 출처로
 * 취급하므로 http로도 저장되고, 환경에 따라 속성이 달라지지 않는 편이 낫다.
 */
const AUTH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

function setAuthCookie(
  res: Response,
  name: string,
  token: { value: string; expiresAt: Date },
): void {
  res.cookie(name, token.value, {
    ...AUTH_COOKIE_OPTIONS,
    expires: token.expiresAt,
  });
}

/**
 * `Cookie` 헤더를 이름-값으로 가른다.
 *
 * cookie-parser를 들이지 않는 이유는 이 한 줄짜리 파싱 말고는 쓸 곳이
 * 없기 때문이다. 값은 `encodeURIComponent`로 실려 오므로 되돌려 읽는다.
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

function toHttpError(error: unknown): unknown {
  // 입력 검증 실패는 사용자 잘못이므로 400이다. 그대로 두면 500이 되어
  // "서버가 고장났다"는 잘못된 신호를 준다.
  if (error instanceof ZodError) {
    return new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '입력값을 확인해 주세요.',
      fieldErrors: toFieldErrors(error),
    });
  }

  if (error instanceof LoginError) {
    return new LoginHttpError(error.code);
  }

  // 우리가 아는 도메인 에러가 아니면 그대로 올려보내 500이 되게 둔다.
  return error;
}

/** zod 오류를 `{ 필드명: [문구] }` 모양으로 모은다 */
function toFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path.join('.');
    if (field === '') continue;
    (fieldErrors[field] ??= []).push(issue.message);
  }

  return fieldErrors;
}
