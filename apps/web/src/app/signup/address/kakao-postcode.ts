import { parseKakaoPostcodeResult, type AddressSelection } from '@fixer/shared';

/** 다음 우편번호 서비스 스크립트. 키가 필요 없는 무료 임베드다 */
const POSTCODE_SCRIPT_SRC =
  'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

type PostcodeOptions = {
  oncomplete: (result: unknown) => void;
  onclose: (state: string) => void;
};

type DaumPostcode = {
  Postcode: new (options: PostcodeOptions) => { open: () => void };
};

declare global {
  // eslint-disable-next-line no-var
  var daum: DaumPostcode | undefined;
}

/**
 * 스크립트를 한 번만 내려받는다. 두 번째부터는 같은 약속을 재사용한다 —
 * 사용자가 "주소 검색"을 여러 번 누를 때마다 다시 받으면 낭비다.
 */
let loading: Promise<DaumPostcode> | null = null;

function loadScript(): Promise<DaumPostcode> {
  if (globalThis.daum !== undefined) {
    return Promise.resolve(globalThis.daum);
  }
  if (loading !== null) {
    return loading;
  }

  loading = new Promise<DaumPostcode>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = POSTCODE_SCRIPT_SRC;
    script.onload = () => {
      if (globalThis.daum === undefined) {
        reject(new Error('우편번호 스크립트를 불러오지 못했습니다.'));
        return;
      }
      resolve(globalThis.daum);
    };
    script.onerror = () => {
      // 다음 시도에서 다시 받을 수 있게 비운다
      loading = null;
      reject(new Error('우편번호 스크립트를 불러오지 못했습니다.'));
    };
    document.head.appendChild(script);
  });

  return loading;
}

/**
 * 카카오 우편번호 팝업을 띄우고 사용자가 고른 주소를 돌려준다.
 * 고르지 않고 닫으면 `null`이다.
 *
 * 화면과 파일을 나눈 이유는 **테스트에서 이 모듈만 모킹**하기 위해서다.
 * 카카오 스크립트는 외부 서비스이므로 테스트에서 내려받지 않는다.
 */
export async function openPostcodePopup(): Promise<AddressSelection | null> {
  const daum = await loadScript();

  return new Promise<AddressSelection | null>((resolve, reject) => {
    /**
     * 고르면 `oncomplete`가 먼저 오고 그 뒤에 `onclose`가 온다.
     * 둘 다 약속을 매듭지으려 하므로 먼저 온 것만 반영한다.
     */
    let settled = false;

    const postcode = new daum.Postcode({
      oncomplete: (result: unknown) => {
        if (settled) return;
        settled = true;
        try {
          resolve(parseKakaoPostcodeResult(result));
        } catch (cause) {
          // 카카오가 모르는 모양을 주면 주소가 없는 것이다. 삼키지 않는다.
          reject(cause);
        }
      },
      onclose: () => {
        if (settled) return;
        settled = true;
        resolve(null);
      },
    });

    postcode.open();
  });
}
