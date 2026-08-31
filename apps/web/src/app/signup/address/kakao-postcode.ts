import type { AddressSelection } from '@fixer/shared';

/**
 * 카카오 우편번호 팝업을 띄우고 사용자가 고른 주소를 돌려준다.
 * 고르지 않고 닫으면 `null`이다.
 *
 * 화면과 파일을 나눈 이유는 **테스트에서 이 모듈만 모킹**하기 위해서다.
 * 카카오 스크립트는 외부 서비스이므로 테스트에서 내려받지 않는다.
 */
export function openPostcodePopup(): Promise<AddressSelection | null> {
  throw new Error('not implemented');
}
