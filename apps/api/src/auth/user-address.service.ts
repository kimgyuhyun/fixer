import { Injectable, Logger } from '@nestjs/common';
import {
  ADDRESS_ERRORS,
  ADDRESS_RULES,
  registerAddressRequestSchema,
  type AddressErrorCode,
  type Coordinate,
  type RegisterAddressRequest,
  type RegisteredAddress,
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
  private readonly logger = new Logger(UserAddressService.name);

  constructor(
    private readonly addresses: UserAddressStore,
    private readonly members: MemberChecker,
    private readonly geocoder: Geocoder,
  ) {}

  /** 검증 → 회원 확인 → 좌표 시도 → 저장 순으로 간다 */
  async register(
    userId: string,
    input: RegisterAddressRequest,
  ): Promise<RegisteredAddress> {
    // 검증이 가장 먼저다. 형식이 틀린 요청은 저장소를 건드리지 않고 끝난다.
    // (`SignupService`와 같은 순서)
    const selected = registerAddressRequestSchema.parse(input);

    // 없는 회원에 주소를 매달면 FK 위반이 그대로 올라가 500이 된다.
    if (!(await this.members.exists(userId))) {
      throw new UserAddressError(ADDRESS_ERRORS.MEMBER_NOT_FOUND);
    }

    const coordinate = await this.toCoordinateOrNull(selected);

    const saved = await this.addresses.create({
      userId,
      label: selected.label ?? ADDRESS_RULES.defaultLabel,
      postalCode: selected.postalCode,
      roadAddress: selected.roadAddress,
      jibunAddress: selected.jibunAddress,
      sido: selected.sido,
      sigungu: selected.sigungu,
      lat: coordinate?.lat ?? null,
      lng: coordinate?.lng ?? null,
    });

    return {
      id: saved.id,
      label: saved.label,
      postalCode: saved.postalCode,
      roadAddress: saved.roadAddress,
      jibunAddress: saved.jibunAddress,
      sido: saved.sido,
      sigungu: saved.sigungu,
      lat: saved.lat,
      lng: saved.lng,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  /**
   * 좌표를 구해 본다. 못 구하면 `null`이다.
   *
   * 포트는 `null`을 주기로 했지만 실제 구현은 네트워크 예외를 던질 수 있다.
   * 컨트롤러까지 올라가면 500이 되어 AC3("저장 자체는 성공한다")이 깨지므로
   * 여기서 끊는다.
   */
  private async toCoordinateOrNull(selected: {
    roadAddress: string;
    jibunAddress: string;
  }): Promise<Coordinate | null> {
    // 도로명이 없는 주소가 있다. 그때는 지번으로 묻는다.
    const query =
      selected.roadAddress !== ''
        ? selected.roadAddress
        : selected.jibunAddress;

    try {
      return await this.geocoder.toCoordinate(query);
    } catch {
      // 주소는 개인정보라 로그에 남기지 않는다. 실패했다는 사실만 남긴다.
      this.logger.warn('좌표 변환에 실패해 좌표 없이 주소를 저장한다.');
      return null;
    }
  }
}
