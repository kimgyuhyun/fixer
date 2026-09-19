import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { CanActivate, ExecutionContext, Type } from '@nestjs/common';
import { LOGIN_ERRORS } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationController } from '../application/application.controller';
import { JobPostController } from '../job-post/job-post.controller';
import { PointController } from '../point/point.controller';
import { RatingController } from '../rating/rating.controller';
import { LoginError, type LoginService } from './login.service';
import { MemberGuard, type RequestWithMember } from './member.guard';

/**
 * **어느 라우트가 가드 뒤에 있고 어느 라우트가 공개인가.** (이슈 #69)
 *
 * 컨트롤러별 테스트는 "회원 id를 어디서 얻는가"를 보고, 이 파일은 "그 회원
 * 판정이 실제로 라우트에 걸려 있는가"를 본다. 가드를 컨트롤러 통째로 붙이면
 * 공고 목록과 프로필 평점까지 로그인 벽 뒤로 들어가므로, **막는 것과
 * 안 막는 것을 함께** 못 박는다.
 */

/** Nest가 `@UseGuards`를 남기는 자리. 라우트와 컨트롤러 양쪽에 붙을 수 있다 */
const GUARDS_METADATA = '__guards__';

/**
 * 그 라우트에 걸린 가드. **컨트롤러 통째로 붙인 것까지 센다** — Nest가
 * 라우트마다 둘을 합쳐 실행하므로 어느 쪽에 적었는지는 요청자에게 차이가 없다.
 */
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

/** 무엇을 들고 와도 로그인 안 된 것으로 보는 가짜 */
function rejectingLogins(): LoginService {
  return {
    authenticate: () =>
      Promise.reject(new LoginError(LOGIN_ERRORS.UNAUTHENTICATED)),
  } as unknown as LoginService;
}

/** 쿠키 없이 몸체만 들고 온 요청 */
function cookielessContext(body: unknown): ExecutionContext {
  const request = { headers: {}, body } as RequestWithMember;
  const response = { cookie: vi.fn() };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

/**
 * 그 라우트에 걸린 `MemberGuard`를 실제로 돌려 상태 코드를 본다.
 *
 * 메타데이터만 보면 "가드가 붙어 있다"까지만 알 수 있고, 그 가드가 무엇을
 * 돌려주는지는 모른다. 붙어 있는 가드를 꺼내 직접 돌린다.
 */
async function statusFor(
  controller: Type<unknown>,
  route: string,
  body: unknown,
): Promise<number> {
  expect(guardsOf(controller, route)).toContain(MemberGuard);

  const guard: CanActivate = new MemberGuard(rejectingLogins());
  const error = await Promise.resolve(
    guard.canActivate(cookielessContext(body)),
  ).catch((e: unknown) => e);

  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

describe('PointController.refund', () => {
  it('should answer 401 when unauthenticated even though the body carries a userId', async () => {
    const status = await statusFor(PointController, 'refund', {
      userId: 'usr_someone_else',
      amount: 50_000,
    });

    expect(status).toBe(HttpStatus.UNAUTHORIZED);
  });
});

describe('ApplicationController.accept', () => {
  it('should answer 401 when unauthenticated even though the body carries an employerId', async () => {
    const status = await statusFor(ApplicationController, 'accept', {
      employerId: 'usr_someone_else',
    });

    expect(status).toBe(HttpStatus.UNAUTHORIZED);
  });
});

describe('JobPostController.create', () => {
  it('should answer 401 when unauthenticated even though the body carries an employerId', async () => {
    const status = await statusFor(JobPostController, 'create', {
      employerId: 'usr_someone_else',
    });

    expect(status).toBe(HttpStatus.UNAUTHORIZED);
  });
});

describe('JobPostController.list', () => {
  it('should stay public and answer without any cookie', () => {
    // 공고 열람은 로그인 전에도 된다. 가드가 붙으면 첫 화면이 로그인 벽 뒤로
    // 들어간다.
    expect(guardsOf(JobPostController, 'list')).not.toContain(MemberGuard);
  });
});

describe('RatingController.summary', () => {
  it('should stay public and answer without any cookie', () => {
    // 프로필 평점은 공개다. `MemberRating`이 남의 화면에서도 읽는다.
    expect(guardsOf(RatingController, 'summary')).not.toContain(MemberGuard);
  });
});

describe('PointController.webhook', () => {
  it('should accept the webhook with a valid signature and no cookie', () => {
    // 포트원은 쿠키를 들고 오지 않는다. 서명 검증이 인증 역할을 한다 (AC5).
    expect(guardsOf(PointController, 'webhook')).not.toContain(MemberGuard);
  });
});
