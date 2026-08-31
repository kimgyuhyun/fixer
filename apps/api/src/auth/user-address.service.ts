import { Injectable } from '@nestjs/common';
import type {
  AddressErrorCode,
  Coordinate,
  RegisterAddressRequest,
  RegisteredAddress,
} from '@fixer/shared';

/**
 * 주소 등록이 내는 실패. 코드로 분기하고 HTTP 상태 매핑은 컨트롤러에서만 한다.
 * 서비스는 HTTP를 모른다. (`SignupError`와 같은 모양)
 */
export class UserAddressError extends Error {
  constructor(readonly code: AddressErrorCode) {
    super(code);
    this.name = 'UserAddressError';
  }
}

/** 저장된 주소 한 행. 이슈 #3 범위의 컬럼만 담는다 */
export interface UserAddressRecord {
  id: string;
  label: string;
  postalCode: string;
  roadAddress: string;
  jibunAddress: string;
  sido: string;
  sigungu: string;
  /** 좌표 변환 실패를 저장 실패로 만들지 않는다 (AC3) */
  lat: number | null;
  lng: number | null;
  createdAt: Date;
}

/**
 * 주소 저장소 포트. Prisma 구현체는 `prisma-user-address.store.ts`에 있다.
 *
 * 서비스가 Prisma를 직접 부르지 않는 이유는 #1·#2와 같다 — 판정 로직을
 * DB 없이 단위 테스트하기 위해서다.
 */
export interface UserAddressStore {
  create(input: {
    userId: string;
    label: string;
    postalCode: string;
    roadAddress: string;
    jibunAddress: string;
    sido: string;
    sigungu: string;
    lat: number | null;
    lng: number | null;
  }): Promise<UserAddressRecord>;
}

/**
 * "이 회원이 있는가"만 묻는 포트.
 *
 * #2의 `UserStore`를 끌어오지 않는 이유는 #2가 `EmailVerificationChecker`를
 * 만든 이유와 같다 — 주소 등록이 알아야 하는 것은 회원 전체가 아니라
 * 예/아니오 하나다.
 */
export interface MemberChecker {
  exists(userId: string): Promise<boolean>;
}

/**
 * 주소를 좌표로 바꾸는 포트. 카카오 로컬 구현체는 `kakao-local.geocoder.ts`.
 *
 * 좌표를 못 얻으면 `null`이다. 좌표는 거리 검색과 관리자 지역 필터를 위한
 * 것이지 가입을 막을 이유가 아니다. (이슈 #3 AC3)
 */
export interface Geocoder {
  toCoordinate(address: string): Promise<Coordinate | null>;
}

@Injectable()
export class UserAddressService {
  constructor(
    private readonly addresses: UserAddressStore,
    private readonly members: MemberChecker,
    private readonly geocoder: Geocoder,
  ) {}

  /** 회원 확인 → 검증 → 좌표 시도 → 저장 순으로 간다 */
  register(
    _userId: string,
    _input: RegisterAddressRequest,
  ): Promise<RegisteredAddress> {
    throw new Error('not implemented');
  }
}
