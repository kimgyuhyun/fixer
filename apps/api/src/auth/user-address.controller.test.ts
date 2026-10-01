import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ADDRESS_ERRORS, AUTH_COOKIES, LOGIN_ERRORS } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { LoginError, type LoginService } from './login.service';
import { MemberGuard, memberOf, type RequestWithMember } from './member.guard';
import { UserAddressController } from './user-address.controller';
import {
  UserAddressError,
  type UserAddressService,
} from './user-address.service';

/**
 * 컨트롤러는 HTTP 경계다. 여기서 검증하는 것은 도메인 규칙이 아니라
 * "어떤 결과가 어떤 상태 코드와 본문이 되는가" 하나다.
 */
function controllerWith(impl: Partial<UserAddressService>) {
  return new UserAddressController(impl as UserAddressService);
}

/** HttpException의 본문을 객체로 꺼낸다 */
function bodyOf(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

/** 거절될 때까지 기다렸다가 던져진 값을 돌려준다 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

const USER_ID = 'usr_1';
/** 본문에 실려 온 남의 회원 id */
const SOMEONE_ELSE = 'usr_someone_else';

/** Nest가 `@UseGuards`·`@Controller` 경로를 남기는 자리 */
const GUARDS_METADATA = '__guards__';
const PATH_METADATA = 'path';

/** register 라우트에 걸린 가드. 컨트롤러 통째로 붙인 것까지 센다 */
function guardsOnRegister(): unknown[] {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- 호출하지 않고 데코레이터가 남긴 메타데이터만 읽는다
  const handler = UserAddressController.prototype.register;
  return [
    ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? []),
    ...((Reflect.getMetadata(GUARDS_METADATA, UserAddressController) as
      unknown[] | undefined) ?? []),
  ];
}

/** 쿠키가 있으면 USER_ID로, 없으면 401로 답하는 세션 */
function sessionOfUser(): LoginService {
  return {
    authenticate: (cookies: { accessToken?: string; refreshToken?: string }) =>
      cookies.accessToken === undefined && cookies.refreshToken === undefined
        ? Promise.reject(new LoginError(LOGIN_ERRORS.UNAUTHENTICATED))
        : Promise.resolve({ userId: USER_ID }),
  } as unknown as LoginService;
}

/** 그 라우트에 **실제로 걸린** 가드를 세운다. 안 걸려 있으면 여기서 멈춘다 */
function guardOnRegister(): CanActivate {
  expect(guardsOnRegister()).toContain(MemberGuard);
  return new MemberGuard(sessionOfUser());
}

function contextWith(cookieHeader: string | undefined): ExecutionContext {
  const request = { headers: { cookie: cookieHeader } } as RequestWithMember;
  const response = { cookie: vi.fn() };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

/** 가드 먼저, 핸들러 나중 — Nest가 요청을 지나가게 하는 순서 그대로 */
async function requestRegister(
  controller: UserAddressController,
  cookieHeader: string | undefined,
  body: unknown,
): Promise<unknown> {
  const guard = guardOnRegister();
  const context = contextWith(cookieHeader);
  await guard.canActivate(context);
  return controller.register(memberOf(undefined, context), body);
}

const VALID_BODY = {
  postalCode: '06236',
  roadAddress: '서울 강남구 테헤란로 152',
  jibunAddress: '서울 강남구 역삼동 737',
  sido: '서울',
  sigungu: '강남구',
};

const CREATED = {
  ...VALID_BODY,
  id: 'adr_1',
  label: '기본',
  lat: 37.5006431,
  lng: 127.0359529,
  createdAt: '2026-09-01T00:00:00.000Z',
};

describe('UserAddressController', () => {
  it('should be mounted at members/me/addresses with MemberGuard on register', () => {
    // 경로에서 회원 id를 받지 않는다. 남기면 "경로의 id는 무시된다"는 함정이 된다.
    expect({
      path: Reflect.getMetadata(
        PATH_METADATA,
        UserAddressController,
      ) as unknown,
      guarded: guardsOnRegister().includes(MemberGuard),
    }).toEqual({ path: 'members/me/addresses', guarded: true });
  });
});

describe('POST /members/me/addresses', () => {
  it('should register the address for the token subject', async () => {
    const register = vi.fn().mockResolvedValue(CREATED);
    const controller = controllerWith({ register });

    await requestRegister(
      controller,
      `${AUTH_COOKIES.access}=valid`,
      VALID_BODY,
    );

    expect(register).toHaveBeenCalledWith(USER_ID, VALID_BODY);
  });

  it('should answer 401 AUTH_UNAUTHENTICATED and register nothing when the request carries no cookie', async () => {
    const register = vi.fn().mockResolvedValue(CREATED);
    const controller = controllerWith({ register });

    const error = await rejectionOf(
      requestRegister(controller, undefined, VALID_BODY),
    );

    expect({
      errorCode: bodyOf(error).errorCode,
      status: (error as HttpException).getStatus(),
      registered: register.mock.calls.length,
    }).toEqual({
      errorCode: LOGIN_ERRORS.UNAUTHENTICATED,
      status: HttpStatus.UNAUTHORIZED,
      registered: 0,
    });
  });

  it('should ignore a userId in the body and register for the token subject', async () => {
    const register = vi.fn().mockResolvedValue(CREATED);
    const controller = controllerWith({ register });

    await requestRegister(controller, `${AUTH_COOKIES.access}=valid`, {
      ...VALID_BODY,
      userId: SOMEONE_ELSE,
    });

    expect(register.mock.calls.map((call) => call[0] as unknown)).toEqual([
      USER_ID,
    ]);
  });

  it('should return 201 with the created address', async () => {
    const controller = controllerWith({
      register: () => Promise.resolve(CREATED),
    });

    const result = await controller.register(USER_ID, VALID_BODY);

    expect(result).toEqual(CREATED);
    // 성공 응답은 201이다. 데코레이터가 실제로 붙어 있는지 메타데이터로 본다.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- 호출하지 않고 데코레이터가 남긴 메타데이터만 읽는다
    const handler = UserAddressController.prototype.register;
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(
      HttpStatus.CREATED,
    );
  });

  it('should return 201 with null lat and lng when geocoding failed', async () => {
    // AC3. 좌표 변환 실패에는 에러 코드가 없다. 빈 좌표를 담은 성공이다.
    const controller = controllerWith({
      register: () => Promise.resolve({ ...CREATED, lat: null, lng: null }),
    });

    const result = await controller.register(USER_ID, VALID_BODY);

    expect(result).toMatchObject({ lat: null, lng: null });
  });

  it('should return 404 with MEMBER_NOT_FOUND when the member does not exist', async () => {
    const controller = controllerWith({
      register: () => {
        throw new UserAddressError(ADDRESS_ERRORS.MEMBER_NOT_FOUND);
      },
    });

    const error = await rejectionOf(controller.register(USER_ID, VALID_BODY));

    expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(bodyOf(error).errorCode).toBe(ADDRESS_ERRORS.MEMBER_NOT_FOUND);
  });

  it('should return 400 with VALIDATION_FAILED and a postalCode field error when the postal code is malformed', async () => {
    const controller = controllerWith({
      register: () => {
        throw new Error('서비스까지 오면 안 된다');
      },
    });

    const error = await rejectionOf(
      controller.register(USER_ID, { ...VALID_BODY, postalCode: '135-080' }),
    );

    expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(error).errorCode).toBe('VALIDATION_FAILED');
    expect(
      (bodyOf(error).fieldErrors as Record<string, string[]>).postalCode,
    ).toBeTruthy();
  });

  it('should let an unknown error through so it becomes 500', async () => {
    const controller = controllerWith({
      register: () => Promise.reject(new Error('DB가 죽었다')),
    });

    const error = await rejectionOf(controller.register(USER_ID, VALID_BODY));

    expect(error).not.toBeInstanceOf(HttpException);
    expect((error as Error).message).toBe('DB가 죽었다');
  });
});
