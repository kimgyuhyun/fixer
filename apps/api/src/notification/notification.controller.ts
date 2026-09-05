import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  AUTH_COOKIES,
  NOTIFICATION_ERRORS,
  notificationItemSchema,
  notificationListSchema,
  type NotificationItem,
  type NotificationList,
} from '@fixer/shared';
import type { Request, Response } from 'express';
import { LoginError, LoginService } from '../auth/login.service';
import { LoginHttpError } from '../auth/login.http-error';
import { NotificationError, NotificationService } from './notification.service';

/**
 * 알림의 HTTP 경계. (이슈 #36)
 *
 * **회원 식별을 쿠키에서 뽑는다.** #12·#17·#30 컨트롤러는 아직 `userId`를
 * 쿼리·본문으로 받지만, 알림 목록은 개인 데이터라 그렇게 받으면 id만 바꿔
 * 남의 알림을 그대로 읽는다. 헤더 벨에는 회원 id를 입력할 자리도 없다.
 * `/api/auth/me`가 쓰는 것과 같은 `LoginService.authenticate`를 재사용한다.
 */
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly service: NotificationService,
    private readonly logins: LoginService,
  ) {}

  /** 목록 + 벨 숫자. 한 번에 온다 */
  @Get('me')
  async mine(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<NotificationList> {
    const userId = await this.callerOf(req, res);
    // `read`와 달리 `toHttpError`로 감싸지 않는다. `list`는 도메인 에러를
    // 던지지 않으므로 그 catch는 통과만 하는 죽은 코드가 된다.
    return notificationListSchema.parse(await this.service.list(userId));
  }

  /** 읽음 처리. 응답의 `linkUrl`로 화면이 이동한다 */
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async read(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<NotificationItem> {
    const userId = await this.callerOf(req, res);
    try {
      return notificationItemSchema.parse(
        await this.service.markRead(userId, id),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /**
   * 쿠키에서 회원을 뽑는다. Access가 만료됐어도 Refresh가 살아 있으면
   * 갱신하고 그대로 진행한다 — `/api/auth/me`와 같은 처리다.
   */
  private async callerOf(req: Request, res: Response): Promise<string> {
    const cookies = parseCookies(req.headers.cookie);
    try {
      const session = await this.logins.authenticate({
        accessToken: cookies[AUTH_COOKIES.access],
        refreshToken: cookies[AUTH_COOKIES.refresh],
      });

      if (session.renewedAccessToken) {
        // 속성이 `login.controller.ts`의 `AUTH_COOKIE_OPTIONS`와 **한 글자도
        // 달라선 안 된다.** 하나라도 다르면 브라우저가 다른 쿠키로 보고
        // 갱신분이 원래 것을 덮어쓰지 못한다. `secure`를 개발에서도 켜 두는
        // 것이 그쪽 결정이다 (spec-fixed §2.5).
        res.cookie(AUTH_COOKIES.access, session.renewedAccessToken.value, {
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
 * `login.controller.ts`에 같은 함수가 있다. 그쪽은 #18 세션이 잡고 있는
 * 파일이 아니지만, 공용으로 빼는 것은 Refactor 단계에서 한다.
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
  if (
    error instanceof NotificationError &&
    error.code === NOTIFICATION_ERRORS.NOT_FOUND
  ) {
    return new NotFoundException({
      errorCode: error.code,
      message: '알림을 찾을 수 없습니다.',
    });
  }

  return error;
}
