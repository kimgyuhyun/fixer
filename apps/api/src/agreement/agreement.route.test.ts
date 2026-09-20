import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { CanActivate, ExecutionContext, Type } from '@nestjs/common';
import { AGREEMENT_ERRORS, AUTH_COOKIES, LOGIN_ERRORS } from '@fixer/shared';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  LoginError,
  type AuthenticatedSession,
  type LoginService,
  type SessionCookies,
} from '../auth/login.service';
import {
  MemberGuard,
  memberOf,
  type RequestWithMember,
} from '../auth/member.guard';
import { AgreementController } from './agreement.controller';
import { AgreementError, type AgreementService } from './agreement.service';

/**
 * **어느 동의서 라우트가 가드 뒤에 있고 어느 라우트가 공개인가.** (이슈 #72)
 *
 * `agreement.controller.test.ts`는 컨트롤러 혼자를 보고, 이 파일은 회원 판정이
 * 실제로 라우트에 걸려 있는지와 **가드 → 핸들러 순서**를 본다.
 *
 * 컨트롤러 통째로 붙일 수 없는 컨트롤러다. 서명(`POST`)은 가입 5단계에서
 * 일어나 그 시점에 세션이 없고(`spec-fixed.md` §2.2), 템플릿은 가입 전에 읽는
 * 문서다. **막는 것만큼 안 막을 것을 안 막는 것**도 이 이슈의 결과물이라
 * 넷을 한 파일에서 함께 못 박는다.
 */

/** 로그인한 사람. 토큰의 주체다 */
const CALLER = 'usr_caller';
/** 쿼리에 실려 온 남의 회원 id */
const SOMEONE_ELSE = 'usr_someone_else';

const NOW = new Date('2026-09-19T00:00:00.000Z');
const AGREEMENT_PDF = Buffer.from('%PDF-1.7 signed');
const TEMPLATE_PDF = Buffer.from('%PDF-1.7 template');
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const SAVED = {
  id: 'agr_1',
  userId: CALLER,
  templateVersion: 3,
  filePath: 'agreements/abc.pdf',
  sha256: 'merged-hash',
  agreedAt: NOW,
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (real browser)',
};

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

/** `MemberGuard`가 걸린 라우트 전부. 순서는 컨트롤러에 적힌 순서다 */
function memberGuardedRoutes(): string[] {
  return ['template', 'sign', 'mine', 'one'].filter((route) =>
    guardsOf(AgreementController, route).includes(MemberGuard),
  );
}

/**
 * **가드가 붙은 뒤의 상태인지 먼저 확인한다.**
 *
 * "이 라우트에는 가드가 없다"만 단언하는 테스트는 아무 가드도 없던 시절에도
 * 통과한다 — 지키는 것이 없다는 뜻이다. 지도 전체를 보면 공개로 남겨야 할
 * 라우트에 가드가 새로 붙는 것도, 막아야 할 라우트에서 가드가 빠지는 것도
 * 같은 단언 하나가 잡는다.
 */
function assertReadRoutesAreGuarded(): void {
  expect(memberGuardedRoutes()).toEqual(['mine', 'one']);
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
 * 그 라우트에 **실제로 걸린** 가드를 꺼내 세운다.
 *
 * 메타데이터만 보면 "붙어 있다"까지만 알 수 있어서, 붙어 있는 그 가드를
 * 세워 직접 돌린다. 안 붙어 있으면 여기서 멈춘다.
 */
function guardOn(route: string, service: LoginService): CanActivate {
  expect(guardsOf(AgreementController, route)).toContain(MemberGuard);
  return new MemberGuard(service);
}

/** 쿠키 한 줄과 쿼리를 들고 오는 가짜 요청·응답 */
function contextWith(
  cookieHeader: string | undefined,
  query: Record<string, string> = {},
): { context: ExecutionContext; cookie: ReturnType<typeof vi.fn> } {
  const request = {
    headers: { cookie: cookieHeader },
    query,
  } as unknown as RequestWithMember;
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

function controllerWith(impl: Partial<AgreementService>): AgreementController {
  return new AgreementController(impl as AgreementService);
}

/** `@Res()`가 넘겨주는 것 중 우리가 쓰는 것만 흉내낸다 */
function fakeResponse() {
  return {
    setHeader: vi.fn(),
    send: vi.fn(),
    status: vi.fn(),
  } as unknown as Response;
}

function sentBody(res: Response): unknown {
  return (res as unknown as { send: { mock: { calls: unknown[][] } } }).send
    .mock.calls[0]?.[0];
}

function statusSetOn(res: Response): unknown {
  return (res as unknown as { status: { mock: { calls: unknown[][] } } }).status
    .mock.calls[0]?.[0];
}

/** 서명 요청. 가입 도중이라 쿠키가 없다 */
function signupRequest(): Request {
  return {
    ip: '203.0.113.7',
    headers: { 'user-agent': 'Mozilla/5.0 (real browser)' },
  } as unknown as Request;
}

/**
 * 요청 하나가 Nest에서 지나가는 순서 그대로 — **가드 먼저, 핸들러 나중.**
 * 가드가 던지면 핸들러는 실행되지 않는다.
 */
async function requestMine(
  guard: CanActivate,
  context: ExecutionContext,
  controller: AgreementController,
  res: Response,
): Promise<unknown> {
  await guard.canActivate(context);
  return controller.mine(memberOf(undefined, context), res);
}

async function requestOne(
  guard: CanActivate,
  context: ExecutionContext,
  controller: AgreementController,
  id: string,
  res: Response,
): Promise<void> {
  await guard.canActivate(context);
  await controller.one(id, memberOf(undefined, context), res);
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

describe('GET /agreements/mine', () => {
  it('should carry MemberGuard on the route', () => {
    // 쿼리의 `userId`를 그대로 믿던 자리다. id만 알면 남의 동의서 유무를
    // 알 수 있었다.
    expect(guardsOf(AgreementController, 'mine')).toContain(MemberGuard);
  });

  it('should read the agreement of the token subject when the query carries no userId', async () => {
    const findMyLatest = vi.fn().mockResolvedValue(SAVED);
    const controller = controllerWith({ findMyLatest });
    const guard = guardOn(
      'mine',
      logins(() => ({ userId: CALLER })),
    );
    const { context } = contextWith(`${AUTH_COOKIES.access}=valid`);

    await requestMine(guard, context, controller, fakeResponse());

    expect(findMyLatest).toHaveBeenCalledWith(CALLER);
  });

  it("should ignore another member's userId in the query and answer for the token subject", async () => {
    const findMyLatest = vi.fn().mockResolvedValue(SAVED);
    const controller = controllerWith({ findMyLatest });
    const guard = guardOn(
      'mine',
      logins(() => ({ userId: CALLER })),
    );
    const { context } = contextWith(`${AUTH_COOKIES.access}=valid`, {
      userId: SOMEONE_ELSE,
    });

    await requestMine(guard, context, controller, fakeResponse());

    expect(findMyLatest).not.toHaveBeenCalledWith(SOMEONE_ELSE);
  });

  it('should answer 204 when the token subject never signed', async () => {
    // 없는 것은 오류가 아니다. 아직 서명하지 않았을 뿐이다 (#8).
    const controller = controllerWith({
      findMyLatest: vi.fn().mockResolvedValue(null),
    });
    const guard = guardOn(
      'mine',
      logins(() => ({ userId: CALLER })),
    );
    const { context } = contextWith(`${AUTH_COOKIES.access}=valid`);
    const res = fakeResponse();

    await requestMine(guard, context, controller, res);

    expect(statusSetOn(res)).toBe(HttpStatus.NO_CONTENT);
  });

  it('should answer 401 LOGIN_UNAUTHENTICATED when the request carries no cookie even though the query carries a userId', async () => {
    const controller = controllerWith({ findMyLatest: vi.fn() });
    const guard = guardOn(
      'mine',
      logins(() => ({ userId: CALLER })),
    );
    const { context } = contextWith(undefined, { userId: SOMEONE_ELSE });

    const error = await rejectionOf(
      requestMine(guard, context, controller, fakeResponse()),
    );

    expect(statusOf(error)).toBe(HttpStatus.UNAUTHORIZED);
    expect(bodyOf(error).errorCode).toBe(LOGIN_ERRORS.UNAUTHENTICATED);
  });

  it("should not read anyone's agreement when the request is unauthenticated", async () => {
    // 401을 돌려주면서 조회는 이미 한 배선을 잡는다. 상태 코드만 보는
    // 테스트는 그 사고를 못 잡는다.
    const findMyLatest = vi.fn().mockResolvedValue(SAVED);
    const controller = controllerWith({ findMyLatest });
    const guard = guardOn(
      'mine',
      logins(() => ({ userId: CALLER })),
    );
    const { context } = contextWith(undefined, { userId: SOMEONE_ELSE });

    await rejectionOf(requestMine(guard, context, controller, fakeResponse()));

    expect(findMyLatest).not.toHaveBeenCalled();
  });
});

describe('MemberGuard on GET /agreements/mine', () => {
  it('should renew the access cookie and let the read continue when the access token expired but the refresh token is alive', async () => {
    const renewedAt = new Date('2026-09-19T00:15:00.000Z');
    const findMyLatest = vi.fn().mockResolvedValue(SAVED);
    const controller = controllerWith({ findMyLatest });
    const guard = guardOn(
      'mine',
      logins(() => ({
        userId: CALLER,
        renewedAccessToken: { value: 'fresh-access', expiresAt: renewedAt },
      })),
    );
    const { context, cookie } = contextWith(
      `${AUTH_COOKIES.access}=expired; ${AUTH_COOKIES.refresh}=alive`,
    );

    await requestMine(guard, context, controller, fakeResponse());

    // 갱신하고 그대로 진행한다. 15분마다 튕기면 마이페이지가 로그인 벽이 된다.
    expect(cookie).toHaveBeenCalledWith(AUTH_COOKIES.access, 'fresh-access', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: renewedAt,
    });
  });

  it('should authenticate from the refresh cookie alone when the access cookie is absent', async () => {
    const findMyLatest = vi.fn().mockResolvedValue(SAVED);
    const controller = controllerWith({ findMyLatest });
    const guard = guardOn(
      'mine',
      logins((cookies) => {
        expect(cookies.accessToken).toBeUndefined();
        return { userId: CALLER };
      }),
    );
    const { context } = contextWith(`${AUTH_COOKIES.refresh}=alive`);

    await requestMine(guard, context, controller, fakeResponse());

    expect(findMyLatest).toHaveBeenCalledWith(CALLER);
  });
});

describe('GET /agreements/:id', () => {
  it('should carry MemberGuard on the route', () => {
    expect(guardsOf(AgreementController, 'one')).toContain(MemberGuard);
  });

  it('should send the pdf of the token subject when the query carries no userId', async () => {
    const controller = controllerWith({
      getMyAgreementPdf: vi
        .fn()
        .mockResolvedValue({ bytes: AGREEMENT_PDF, sha256Matches: true }),
    });
    const guard = guardOn(
      'one',
      logins(() => ({ userId: CALLER })),
    );
    const { context } = contextWith(`${AUTH_COOKIES.access}=valid`);
    const res = fakeResponse();

    await requestOne(guard, context, controller, 'agr_1', res);

    expect(sentBody(res)).toEqual(AGREEMENT_PDF);
  });

  it("should hand the token subject as requesterId even when the query carries another member's userId", async () => {
    // `requesterId` 대조는 그대로 남는다 (#8 AC2). 이 이슈가 바꾸는 것은
    // **대조에 넣는 값의 출처**다.
    const getMyAgreementPdf = vi
      .fn()
      .mockResolvedValue({ bytes: AGREEMENT_PDF, sha256Matches: true });
    const controller = controllerWith({ getMyAgreementPdf });
    const guard = guardOn(
      'one',
      logins(() => ({ userId: CALLER })),
    );
    const { context } = contextWith(`${AUTH_COOKIES.access}=valid`, {
      userId: SOMEONE_ELSE,
    });

    await requestOne(guard, context, controller, 'agr_1', fakeResponse());

    expect(getMyAgreementPdf).toHaveBeenCalledWith({
      agreementId: 'agr_1',
      requesterId: CALLER,
    });
  });

  it('should answer 401 when the request carries no cookie even though the query carries a userId', async () => {
    const controller = controllerWith({ getMyAgreementPdf: vi.fn() });
    const guard = guardOn(
      'one',
      logins(() => ({ userId: CALLER })),
    );
    const { context } = contextWith(undefined, { userId: SOMEONE_ELSE });

    const error = await rejectionOf(
      requestOne(guard, context, controller, 'agr_1', fakeResponse()),
    );

    expect(statusOf(error)).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('should answer 403 when the agreement belongs to another member', async () => {
    const controller = controllerWith({
      getMyAgreementPdf: vi
        .fn()
        .mockRejectedValue(new AgreementError(AGREEMENT_ERRORS.FORBIDDEN)),
    });
    const guard = guardOn(
      'one',
      logins(() => ({ userId: CALLER })),
    );
    const { context } = contextWith(`${AUTH_COOKIES.access}=valid`);

    const error = await rejectionOf(
      requestOne(guard, context, controller, 'agr_other', fakeResponse()),
    );

    expect(statusOf(error)).toBe(HttpStatus.FORBIDDEN);
  });

  it('should send no pdf bytes when the agreement belongs to another member', async () => {
    // 403을 내면서 본문은 이미 보낸 배선을 잡는다. 서명본은 이름과 서명
    // 이미지가 들어간 개인 문서다.
    const controller = controllerWith({
      getMyAgreementPdf: vi
        .fn()
        .mockRejectedValue(new AgreementError(AGREEMENT_ERRORS.FORBIDDEN)),
    });
    const guard = guardOn(
      'one',
      logins(() => ({ userId: CALLER })),
    );
    const { context } = contextWith(`${AUTH_COOKIES.access}=valid`);
    const res = fakeResponse();

    await rejectionOf(requestOne(guard, context, controller, 'agr_other', res));

    expect(sentBody(res)).toBeUndefined();
  });

  it('should answer 404 when the id is unknown', async () => {
    const controller = controllerWith({
      getMyAgreementPdf: vi
        .fn()
        .mockRejectedValue(new AgreementError(AGREEMENT_ERRORS.NOT_FOUND)),
    });
    const guard = guardOn(
      'one',
      logins(() => ({ userId: CALLER })),
    );
    const { context } = contextWith(`${AUTH_COOKIES.access}=valid`);

    const error = await rejectionOf(
      requestOne(guard, context, controller, 'agr_missing', fakeResponse()),
    );

    expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
  });
});

describe('POST /agreements', () => {
  it('should stay guardless so the signup flow is not blocked', () => {
    assertReadRoutesAreGuarded();

    // 서명은 가입 5단계에서 일어나고 그 시점에 세션이 없다
    // (`spec-fixed.md` §2.2). 가드를 붙이면 가입이 그 자리에서 막힌다.
    expect(memberGuardedRoutes()).not.toContain('sign');
  });

  it('should still sign during signup when the request carries no cookie', async () => {
    assertReadRoutesAreGuarded();

    const sign = vi.fn().mockResolvedValue(SAVED);
    const controller = controllerWith({ sign });

    const body = await controller.sign(
      { userId: CALLER, signaturePngBase64: TINY_PNG_BASE64 },
      signupRequest(),
    );

    expect(body).toEqual({
      id: 'agr_1',
      templateVersion: 3,
      agreedAt: NOW.toISOString(),
    });
  });
});

describe('GET /agreements/template', () => {
  it('should stay guardless so the document is readable before signup', () => {
    assertReadRoutesAreGuarded();

    // 가입 전에 읽는 문서다. 가드를 붙이면 가입 5단계가 백지가 된다.
    expect(memberGuardedRoutes()).not.toContain('template');
  });

  it('should still answer when the request carries no cookie', async () => {
    assertReadRoutesAreGuarded();

    const controller = controllerWith({
      getActiveTemplatePdf: vi
        .fn()
        .mockResolvedValue({ version: 3, bytes: TEMPLATE_PDF }),
    });
    const res = fakeResponse();

    await controller.template(res);

    expect(sentBody(res)).toEqual(TEMPLATE_PDF);
  });
});
