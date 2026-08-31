import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseKakaoCoordinate, type Coordinate } from '@fixer/shared';
import type { Geocoder } from './user-address.service';

/** 카카오 로컬 주소검색. 키가 바뀌어도 코드가 아니라 환경변수만 바뀐다 */
const KAKAO_LOCAL_ADDRESS_URL =
  'https://dapi.kakao.com/v2/local/search/address.json';

/** 좌표 하나 때문에 요청이 매달려 있으면 저장이 늦어진다 */
const TIMEOUT_MS = 3000;

/**
 * `Geocoder`의 카카오 로컬 구현체. (이슈 #3, ADR-AUTH-2)
 *
 * 못 얻으면 `null`이다. 좌표는 거리 검색과 관리자 지역 필터를 위한 것이지
 * 가입을 막을 이유가 아니므로, 실패를 예외가 아니라 결과로 돌려준다. (AC3)
 *
 * 응답 파싱은 `packages/shared/src/address.ts`의 `parseKakaoCoordinate`
 * 한 곳에서만 한다 — 카카오가 필드를 바꾸면 고칠 곳이 그 파일 하나다.
 */
@Injectable()
export class KakaoLocalGeocoder implements Geocoder {
  private readonly logger = new Logger(KakaoLocalGeocoder.name);
  private readonly restApiKey: string;

  constructor(configService: ConfigService) {
    // 키는 코드에 두지 않는다. 없으면 좌표 없이 도는 것이 정상 동작이다.
    this.restApiKey = configService.get<string>('KAKAO_REST_API_KEY') ?? '';
  }

  async toCoordinate(address: string): Promise<Coordinate | null> {
    if (this.restApiKey === '' || address === '') {
      // 키를 넣지 않은 개발 환경에서도 주소 등록은 끝까지 되어야 한다.
      return null;
    }

    // 주소는 개인정보지만 카카오 로컬 API가 질의 문자열로만 받는다.
    // 그래서 여기 한 곳에서만 나가고, 로그에는 남기지 않는다.
    const url = `${KAKAO_LOCAL_ADDRESS_URL}?query=${encodeURIComponent(address)}`;

    const response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${this.restApiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // 실패했다는 사실만 남긴다. 주소도 키도 로그에 넣지 않는다.
      this.logger.warn(`카카오 로컬 응답이 ${response.status}였다.`);
      return null;
    }

    return parseKakaoCoordinate(await response.json());
  }
}
