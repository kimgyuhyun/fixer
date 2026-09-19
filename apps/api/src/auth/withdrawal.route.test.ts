import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { CanActivate, ExecutionContext, Type } from '@nestjs/common';
import { AUTH_COOKIES, LOGIN_ERRORS } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  LoginError,
  type AuthenticatedSession,
  type LoginService,
  type SessionCookies,
} from './login.service';
import { MemberGuard, memberOf, type RequestWithMember } from './member.guard';
import { WithdrawalController } from './withdrawal.controller';
import type { WithdrawalService } from './withdrawal.service';

/**
 * **탈퇴 라우트가 누구를 탈퇴시키는가.** (이슈 #71)
 *
 * `withdrawal.controller.test.ts`는 컨트롤러 혼자를 보고, 이 파일은 가드가
 * 실제로 그 라우트에 걸려 있는지와 **가드 → 핸들러 순서**를 본다. 탈퇴는
 * 되돌리려면 재활성화(#10)를 거쳐야 하므로, 401을 돌려주면서 탈퇴는 이미
 * 실행된 배선을 상태 코드만 보는 테스트로는 잡을 수 없다.
 */

/** 로그인한 사람. 토큰의 주체다 */
const CALLER = 'usr_caller';
/** 몸체에 실려 온 남의 회원 id */
const SOMEONE_ELSE = 'usr_someone_else';

/** Nest가 `@UseGuards`를 남기는 자리. 라우트와 컨트롤러 양쪽에 붙을 수 있다 */
const GUARDS_METADATA = '__guards__';

function guardsOf(controller: Type<unknown>, route: string): unknown[] {
  const prototype = controller.prototype as Record<string, unknown>;
  const handler = prototype[route];
  if (typeof handler !== 'function') {
    throw new Error(`${controller.name}에 ${route} 라우트가 없다`);
  }

  return [
    ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? []),
    ...((Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ?? []),
  ];
}

/** 세션을 흉내 내는 가짜. 쿠키를 보고 정해진 답을 돌려준다 */
function logins(
  answer: (cookies: SessionCookies) => AuthenticatedSession,
): LoginService {
  return {
    authenticate: (cookies: SessionCookies) => {
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

/**
 * 탈퇴 라우트에 **실제로 걸린** 가드를 꺼내 세운다.
 *
 * 메타데이터만 보면 "붙어 있다"까지만 알 수 있어서, 붙어 있는 그 가드를
 * 세워 직접 돌린다. 안 붙어 있으면 여기서 멈춘다.
 */
function guardOnWithdrawRoute(service: LoginService): CanActivate {
  expect(guardsOf(WithdrawalController, 'withdraw')).toContain(MemberGuard);
  return new MemberGuard(service);
}

/** 쿠키 한 줄과 몸체를 들고 오는 가짜 요청·응답 */
function contextWith(
  cookieHeader: string | undefined,
  body?: unknown,
): { context: ExecutionContext; cookie: ReturnType<typeof vi.fn> } {
  const request = {
    headers: { cookie: cookieHeader },
    body,
  } as RequestWithMember;
  const cookie = vi.fn();
  const response = { cookie };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, cookie };
}

function controllerWith(
  impl: Partial<WithdrawalService>,
): WithdrawalController {
  return new WithdrawalController(impl as WithdrawalService);
}

/**
 * 요청 하나가 Nest에서 지나가는 순서 그대로 — **가드 먼저, 핸들러 나중.**
 * 가드가 던지면 핸들러는 실행되지 않는다.
 */
async function requestWithdraw(
  guard: CanActivate,
  context: ExecutionContext,
  controller: WithdrawalController,
): Promise<void> {
  await guard.canActivate(context);
  await controller.withdraw(memberOf(undefined, context));
}

function statusOf(error: unknown): number {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

function bodyOf(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

describe('POST /auth/withdraw', () => {
  it('should carry MemberGuard on the route', () => {
    // 남은 것 중 가장 위험한 라우트다. id만 알면 남의 계정을 탈퇴시킬 수 있었다.
    expect(guardsOf(WithdrawalController, 'withdraw')).toContain(MemberGuard);
  });

  it("should withdraw the token subject when the body carries someone else's userId", async () => {
    const withdraw = vi.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ withdraw });
    const guard = guardOnWithdrawRoute(logins(() => ({ userId: CALLER })));
    const { context } = contextWith(`${AUTH_COOKIES.access}=valid`, {
      userId: SOMEONE_ELSE,
    });

    await requestWithdraw(guard, context, controller);

    expect(withdraw).toHaveBeenCalledWith(CALLER, expect.any(Date));
  });

  it('should answer 401 when the request carries no cookie even though the body carries a userId', async () => {
    const controller = controllerWith({ withdraw: vi.fn() });
    const guard = guardOnWithdrawRoute(logins(() => ({ userId: CALLER })));
    const { context } = contextWith(undefined, { userId: SOMEONE_ELSE });

    const error = await rejectionOf(
      requestWithdraw(guard, context, controller),
    );

    expect(statusOf(error)).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('should answer LOGIN_UNAUTHENTICATED rather than VALIDATION_FAILED when the caller cannot be identified', async () => {
    // 전에는 "몸체에 userId가 없다"로 보고 400 VALIDATION_FAILED였다.
    // 이제는 "네가 누군지 모르겠다"라서 401이다.
    const controller = controllerWith({ withdraw: vi.fn() });
    const guard = guardOnWithdrawRoute(logins(() => ({ userId: CALLER })));
    const { context } = contextWith(undefined);

    const error = await rejectionOf(
      requestWithdraw(guard, context, controller),
    );

    expect(bodyOf(error).errorCode).toBe(LOGIN_ERRORS.UNAUTHENTICATED);
  });

  it('should not deactivate anyone when the request is unauthenticated', async () => {
    const withdraw = vi.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ withdraw });
    const guard = guardOnWithdrawRoute(logins(() => ({ userId: CALLER })));
    const { context } = contextWith(undefined, { userId: SOMEONE_ELSE });

    await rejectionOf(requestWithdraw(guard, context, controller));

    expect(withdraw).not.toHaveBeenCalled();
  });
});

describe('MemberGuard on POST /auth/withdraw', () => {
  it('should renew the access cookie and let the withdrawal continue when the access token expired but the refresh token is alive', async () => {
    const renewedAt = new Date('2026-09-20T00:15:00.000Z');
    const withdraw = vi.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ withdraw });
    const guard = guardOnWithdrawRoute(
      logins(() => ({
        userId: CALLER,
        renewedAccessToken: { value: 'fresh-access', expiresAt: renewedAt },
      })),
    );
    const { context, cookie } = contextWith(
      `${AUTH_COOKIES.access}=expired; ${AUTH_COOKIES.refresh}=alive`,
    );

    await requestWithdraw(guard, context, controller);

    // 갱신하고(쿠키를 다시 내려주고) 그대로 진행한다. 15분마다 튕기면
    // 탈퇴 화면에서 확인을 누르는 순간 로그인으로 밀려난다.
    expect(cookie).toHaveBeenCalledWith(AUTH_COOKIES.access, 'fresh-access', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: renewedAt,
    });
    expect(withdraw).toHaveBeenCalledWith(CALLER, expect.any(Date));
  });

  it('should not set a renewed cookie when the access token is still valid', async () => {
    const controller = controllerWith({
      withdraw: vi.fn().mockResolvedValue(undefined),
    });
    const guard = guardOnWithdrawRoute(logins(() => ({ userId: CALLER })));
    const { context, cookie } = contextWith(`${AUTH_COOKIES.access}=valid`);

    await requestWithdraw(guard, context, controller);

    expect(cookie).not.toHaveBeenCalled();
  });

  it('should authenticate from the refresh cookie alone when the access cookie is absent', async () => {
    const withdraw = vi.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ withdraw });
    const guard = guardOnWithdrawRoute(
      logins((cookies) => {
        expect(cookies.accessToken).toBeUndefined();
        return { userId: CALLER };
      }),
    );
    const { context } = contextWith(`${AUTH_COOKIES.refresh}=alive`);

    await requestWithdraw(guard, context, controller);

    expect(withdraw).toHaveBeenCalledWith(CALLER, expect.any(Date));
  });
});
