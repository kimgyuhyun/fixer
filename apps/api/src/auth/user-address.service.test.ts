/* eslint-disable @typescript-eslint/require-await --
 * 메모리 가짜 저장소는 동기 동작이지만, 실제 구현과 같은 Promise 인터페이스를
 * 지켜야 하므로 async로 선언한다.
 */
import { ADDRESS_ERRORS, ADDRESS_RULES } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import {
  UserAddressError,
  UserAddressService,
  type Geocoder,
  type MemberChecker,
  type UserAddressRecord,
  type UserAddressStore,
} from './user-address.service';

const USER_ID = 'usr_1';

/** 팝업이 고른 뒤 서버로 넘어오는 값 */
const SELECTED = {
  postalCode: '06236',
  roadAddress: '서울 강남구 테헤란로 152',
  jibunAddress: '서울 강남구 역삼동 737',
  sido: '서울',
  sigungu: '강남구',
};

const COORDINATE = { lat: 37.5006431, lng: 127.0359529 };

/** 가짜 주소 저장소. 저장된 행을 그대로 들여다볼 수 있게 배열을 함께 돌려준다 */
function createAddressStore() {
  const rows: UserAddressRecord[] = [];
  let seq = 0;

  const store: UserAddressStore = {
    async create(input) {
      const row: UserAddressRecord = {
        id: `adr_${++seq}`,
        label: input.label,
        postalCode: input.postalCode,
        roadAddress: input.roadAddress,
        jibunAddress: input.jibunAddress,
        sido: input.sido,
        sigungu: input.sigungu,
        lat: input.lat,
        lng: input.lng,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      };
      rows.push(row);
      return row;
    },
  };

  return { store, rows };
}

/** 아무도 부르면 안 되는 저장소. "저장되지 않는다"를 증명할 때 쓴다 */
function createForbiddenAddressStore(): UserAddressStore {
  return {
    create() {
      throw new Error('저장소까지 오면 안 된다');
    },
  };
}

/** 아는 회원만 있다고 답하는 가짜 확인기 */
function createMemberChecker(known: string[] = [USER_ID]): MemberChecker {
  return {
    async exists(userId) {
      return known.includes(userId);
    },
  };
}

/** 항상 같은 좌표를 주는 가짜 변환기 */
function createGeocoder(coordinate: typeof COORDINATE | null): Geocoder {
  return {
    async toCoordinate() {
      return coordinate;
    },
  };
}

/** 네트워크 오류처럼 던져 버리는 가짜 변환기. AC3의 핵심 상황이다 */
function createThrowingGeocoder(): Geocoder {
  return {
    toCoordinate() {
      return Promise.reject(new Error('kakao local api is down'));
    },
  };
}

function serviceWith(options: {
  store?: UserAddressStore;
  members?: MemberChecker;
  geocoder?: Geocoder;
}) {
  return new UserAddressService(
    options.store ?? createAddressStore().store,
    options.members ?? createMemberChecker(),
    options.geocoder ?? createGeocoder(COORDINATE),
  );
}

describe('register', () => {
  it('should store the decomposed address with sido and sigungu when the member exists', async () => {
    const { store, rows } = createAddressStore();
    const service = serviceWith({ store });

    await service.register(USER_ID, SELECTED);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(SELECTED);
  });

  it('should store the coordinate that the geocoder returned', async () => {
    const { store, rows } = createAddressStore();
    const service = serviceWith({
      store,
      geocoder: createGeocoder(COORDINATE),
    });

    await service.register(USER_ID, SELECTED);

    expect(rows[0]).toMatchObject({
      lat: COORDINATE.lat,
      lng: COORDINATE.lng,
    });
  });

  it('should label the address 기본 when no label was given', async () => {
    const { store, rows } = createAddressStore();
    const service = serviceWith({ store });

    await service.register(USER_ID, SELECTED);

    expect(rows[0].label).toBe(ADDRESS_RULES.defaultLabel);
  });

  it('should store lat and lng as null when the geocoder returns null', async () => {
    const { store, rows } = createAddressStore();
    const service = serviceWith({ store, geocoder: createGeocoder(null) });

    await service.register(USER_ID, SELECTED);

    expect(rows[0]).toMatchObject({ lat: null, lng: null });
  });

  it('should reject a label that is only whitespace', async () => {
    const service = serviceWith({ store: createForbiddenAddressStore() });

    await expect(
      service.register(USER_ID, { ...SELECTED, label: '   ' }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('should not touch the address store when the input fails validation', async () => {
    const service = serviceWith({ store: createForbiddenAddressStore() });

    await expect(
      service.register(USER_ID, { ...SELECTED, postalCode: '135-080' }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('should still store the address when the geocoder throws', async () => {
    const { store, rows } = createAddressStore();
    const service = serviceWith({
      store,
      geocoder: createThrowingGeocoder(),
    });

    const saved = await service.register(USER_ID, SELECTED);

    expect(rows).toHaveLength(1);
    expect(saved).toMatchObject({ lat: null, lng: null });
  });

  it('should throw MEMBER_NOT_FOUND when the member does not exist', async () => {
    const service = serviceWith({
      store: createForbiddenAddressStore(),
      members: createMemberChecker([]),
    });

    const error = await service.register('usr_없음', SELECTED).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(UserAddressError);
    expect((error as UserAddressError).code).toBe(
      ADDRESS_ERRORS.MEMBER_NOT_FOUND,
    );
  });

  it('should not call the geocoder at all when the member does not exist', async () => {
    const toCoordinate = vi.fn();
    const service = serviceWith({
      store: createForbiddenAddressStore(),
      members: createMemberChecker([]),
      geocoder: { toCoordinate },
    });

    await service.register('usr_없음', SELECTED).catch(() => undefined);

    expect(toCoordinate).not.toHaveBeenCalled();
  });
});
