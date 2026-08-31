import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ADDRESS_ERRORS } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
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

describe('POST /members/:userId/addresses', () => {
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
