# 이슈 #3 — 주소를 검색해서 등록한다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/3
> PRD: `docs/result/prd/auth-member.md`
> 담당: **A (최동훈)**
> 선행: #2 (인증된 이메일로 가입)
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 시그니처

### 관련 ADR

**`ADR-AUTH-2` — 주소를 분해해 `UserAddress` 테이블에 저장한다.** (PRD §3, 확정 완료)

이 이슈에는 새 ADR이 없다. 이미 정해진 것을 그대로 따른다.

| 결정된 것                                               | 출처                            | 이 시그니처에 미치는 영향                             |
| ------------------------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| 테이블 이름은 `UserAddress`                             | `spec-fixed.md` §3              | Prisma 모델명을 새로 정하지 않는다                    |
| 회원당 **여러 행**, 라벨로 구분                         | `spec-fixed.md` §3, ADR-AUTH-2  | `userId`에 유니크를 걸지 않는다. `label` 컬럼을 둔다  |
| 도로명·지번·우편번호 + 시/도 + 시/군/구로 **분해 저장** | `spec-fixed.md` §2.2 4단계, §11 | 통 문자열 컬럼을 두지 않는다                          |
| `lat`/`lng`는 **nullable**                              | ADR-AUTH-2 Alternatives, AC3    | 좌표 변환 실패가 저장을 막지 않는다                   |
| 카카오 응답 파싱은 **한 곳**에                          | ADR-AUTH-2 Consequences         | 파싱 함수를 `packages/shared/src/address.ts`에 모은다 |

**`ADR-AUTH-3`(계정 생명주기)은 아직 TODO다.** 그래서 `User`에 `deactivatedAt`·`role`을
지금도 넣지 않는다. 이 이슈가 `User`에 더하는 것은 `UserAddress`로 향하는 관계 필드 하나뿐이다.

### 외부 서비스를 인터페이스 뒤에 둔다

카카오는 **두 군데**에 나온다. 성격이 달라 취급도 다르다.

| 카카오                 | 어디서 도는가         | 이 이슈의 취급                                                     |
| ---------------------- | --------------------- | ------------------------------------------------------------------ |
| 우편번호 서비스 (팝업) | 브라우저 (클라이언트) | 팝업을 여는 모듈을 따로 두고, 화면 테스트에서는 그 모듈을 모킹한다 |
| 로컬 API (주소 → 좌표) | 서버                  | `Geocoder` 포트 뒤에 둔다. 단위 테스트는 가짜 구현으로 한다        |

`MailProvider`(#1, `console-mail.provider.ts`)와 같은 방식이다. 서비스는 포트만 알고,
구현체는 `AuthModule`이 꽂는다. **테스트에서 실제 카카오를 호출하지 않는다.**

### 타입 — 공유 계약

```typescript
// packages/shared/src/address.ts

export const ADDRESS_RULES = {
  /** 라벨을 정하지 않으면 이 값이 붙는다 */
  defaultLabel: '기본',
  /** 방어적 상한. 사양에 값이 없어 입력 폭주만 막는 선에서 정했다 */
  labelMaxLength: 20,
  /** 카카오 `zonecode`는 5자리 새 우편번호다 */
  postalCodeLength: 5,
} as const;

export const ADDRESS_ERRORS = {
  /** 그 회원이 없다 */
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
} as const;

export type AddressErrorCode =
  (typeof ADDRESS_ERRORS)[keyof typeof ADDRESS_ERRORS];

/** 우편번호 팝업이 고른 주소 한 건. 카카오 필드명이 아니라 우리 이름이다 */
export const addressSelectionSchema: z.ZodType<AddressSelection>;
export interface AddressSelection {
  postalCode: string;
  roadAddress: string;
  jibunAddress: string;
  sido: string;
  /** 세종특별자치시처럼 시/군/구가 없는 지역이 있어 빈 문자열을 허용한다 */
  sigungu: string;
}

/** 저장 요청. 선택된 주소에 라벨만 얹는다 */
export const registerAddressRequestSchema: z.ZodType<RegisterAddressRequest>;
export type RegisterAddressRequest = AddressSelection & { label?: string };

/** 저장 결과. 좌표는 비어 있을 수 있다 */
export const registeredAddressSchema: z.ZodType<RegisteredAddress>;
export interface RegisteredAddress extends AddressSelection {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
  createdAt: string; // ISO
}

export const coordinateSchema: z.ZodType<Coordinate>;
export interface Coordinate {
  lat: number;
  lng: number;
}

/**
 * 카카오 응답을 우리 모양으로 옮기는 **유일한 지점**.
 * 카카오가 필드를 바꾸면 고칠 곳이 이 파일 하나다. (ADR-AUTH-2 Consequences)
 */
export function parseKakaoPostcodeResult(raw: unknown): AddressSelection;
export function parseKakaoCoordinate(raw: unknown): Coordinate | null;
```

`parseKakaoPostcodeResult`는 모양이 어긋나면 `ZodError`를 던진다.
`parseKakaoCoordinate`는 **던지지 않고 `null`을 준다** — 좌표는 없어도 되는 값이라
실패가 예외가 아니라 결과다. AC3이 그렇게 정했다.

### 타입 — 서버

```typescript
// apps/api/src/auth/user-address.service.ts

/** 이 도메인이 내는 실패. HTTP 경계가 `code`로 분기한다 */
export class UserAddressError extends Error {
  constructor(readonly code: AddressErrorCode);
}

export interface UserAddressRecord {
  id: string;
  label: string;
  postalCode: string;
  roadAddress: string;
  jibunAddress: string;
  sido: string;
  sigungu: string;
  lat: number | null;
  lng: number | null;
  createdAt: Date;
}

/** 주소 저장소 포트. Prisma 구현체는 `prisma-user-address.store.ts` */
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
 * #2의 `UserStore`를 끌어오지 않는 이유는 #2가 `EmailVerificationChecker`를 만든
 * 이유와 같다 — 주소 등록이 알아야 하는 것은 회원 전체가 아니라 예/아니오 하나다.
 * 기존 인터페이스에 메서드를 더하면 #2의 가짜 저장소들이 전부 깨진다.
 */
export interface MemberChecker {
  exists(userId: string): Promise<boolean>;
}

/**
 * 주소를 좌표로 바꾸는 포트. 카카오 로컬 구현체는 `kakao-local.geocoder.ts`.
 *
 * 못 얻으면 `null`이다. 던지더라도 서비스가 삼킨다 — 좌표는 거리 검색과
 * 관리자 지역 필터를 위한 것이지 가입을 막을 이유가 아니다. (AC3)
 */
export interface Geocoder {
  toCoordinate(address: string): Promise<Coordinate | null>;
}

class UserAddressService {
  /** 회원 확인 → 저장할 값 정리 → 좌표 시도 → 저장 순으로 간다 */
  register(
    userId: string,
    input: RegisterAddressRequest,
  ): Promise<RegisteredAddress>;
}
```

```typescript
// apps/api/src/auth/user-address.controller.ts
@Controller('members/:userId/addresses')
class UserAddressController {
  @Post() @HttpCode(HttpStatus.CREATED)
  register(userId: string, body: unknown): Promise<RegisteredAddress>;
}
```

### Prisma 모델

```prisma
/// 회원의 주소. (이슈 #3, ADR-AUTH-2)
model UserAddress {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// 여러 주소를 구분하는 이름. 정하지 않으면 "기본"
  label        String
  /// 5자리 새 우편번호 (카카오 zonecode)
  postalCode   String
  roadAddress  String
  jibunAddress String
  /// 관리자 지역 필터 1단계 (spec-fixed §11)
  sido         String
  /// 관리자 지역 필터 2단계. 세종특별자치시처럼 없는 지역은 빈 문자열
  sigungu      String
  /// 좌표 변환 실패를 저장 실패로 만들지 않는다 (AC3)
  lat          Float?
  lng          Float?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([userId])
  /// 관리자 지역 필터가 시/도 → 시/군/구 두 단계로 좁힌다
  @@index([sido, sigungu])
}
```

`User`에는 `addresses UserAddress[]` 한 줄만 더한다.

### 에러 케이스

| 상황                       | 에러 코드                       | HTTP | 출처                      |
| -------------------------- | ------------------------------- | ---- | ------------------------- |
| 그 회원이 없다             | `MEMBER_NOT_FOUND`              | 404  | AC2의 "Given 가입한 회원" |
| 우편번호가 5자리가 아니다  | `VALIDATION_FAILED` + 필드 오류 | 400  | 입력 검증                 |
| 도로명·지번이 둘 다 비었다 | `VALIDATION_FAILED` + 필드 오류 | 400  | 입력 검증                 |
| 시/도가 비었다             | `VALIDATION_FAILED` + 필드 오류 | 400  | AC2(분해 저장)의 전제     |
| **좌표 변환 실패**         | **없음 — 201로 성공한다**       | 201  | **AC3**                   |

좌표 변환 실패에 에러 코드를 만들지 않는 것이 이 이슈의 핵심이다. AC3이
"저장 자체는 성공한다"고 못박았으므로 실패는 **`lat`/`lng`가 `null`인 201**로 나타난다.

### 화면

```typescript
// apps/web/src/app/signup/address/page.tsx
export default function SignupAddressPage(): JSX.Element;

// apps/web/src/app/signup/address/kakao-postcode.ts
/** 팝업을 띄우고 사용자가 고른 주소를 돌려준다. 닫으면 null */
export function openPostcodePopup(): Promise<AddressSelection | null>;
```

팝업 모듈을 파일로 분리하는 이유는 **화면 테스트에서 그 모듈만 모킹**하기 위해서다.
카카오 스크립트를 테스트에서 내려받지 않는다.

가입한 회원의 `id`는 #2 화면이 `sessionStorage`에 남긴다. #2가 #1에게서 이메일을
그렇게 받은 것과 같은 방식이며, 이유도 같다 — 주소창에 실으면 이력·공유 링크에 남는다.

### 이 이슈에서 만들지 않는 것

| 항목                              | 어디 소관                                         |
| --------------------------------- | ------------------------------------------------- |
| 상세주소(동·호수) 입력            | AC에 없다. 필요해지면 별도 이슈                   |
| 주소 목록 조회·수정·삭제          | #4(마이페이지)·이후                               |
| 기본 주소 지정 플래그             | 라벨로 구분한다. 기본 지정 UI는 근무 주소(#12)    |
| 관리자 시/도 → 시/군/구 필터 화면 | #33 (회원 목록). 이 이슈는 **저장 구조**만 만든다 |
| 로그인 토큰으로 본인 확인         | #4. 아래 "판단이 갈렸던 지점" 참고                |
| 실제 카카오 로컬 호출 테스트      | 승인 범위 밖. 포트 뒤 가짜 구현으로 검증한다      |

### 판단이 갈렸던 지점

**`userId`를 경로에서 받는다 — 지금은 본인 확인이 없다.**
이슈 순서가 답을 정한다. #3의 선행은 #2이지 #4가 아니다. 즉 **주소 등록 시점에는
아직 토큰이 없다**(`spec-fixed.md` §2.2에서 주소 입력은 가입 흐름 4단계, 로그인 전이다).
그래서 이번에는 경로의 `userId`를 그대로 믿는다. 남의 회원번호를 알면 그 사람에게
주소를 하나 더 붙일 수 있다는 뜻이므로, `FIXME(#4)`를 코드에 남기고
`docs/result/security-exceptions.md`에 기록한다. #4가 인증 가드를 들고 오면 해소된다.

**좌표 변환 실패를 서비스가 삼킨다.** 포트가 `null`을 주기로 했지만, 실제 구현이
네트워크 예외를 던질 수 있다. 컨트롤러까지 올라가면 500이 되어 AC3이 깨진다.
`try/catch`로 서비스에서 끊고 로그만 남긴다.

**시/도·시/군/구를 우리가 문자열에서 잘라내지 않는다.** 카카오 우편번호 팝업이
`sido`·`sigungu`를 따로 준다. 통 주소를 우리가 파싱하면 "경기도 광주시"와
"광주광역시"를 가르는 규칙을 우리가 떠안게 된다.

**우편번호 정규식을 5자리로 고정했다.** 2015년 이후 새 우편번호는 5자리 고정이고
카카오 `zonecode`가 그 값이다. 6자리 옛 우편번호는 받지 않는다.

---

## 테스트 시나리오

### 정상

- [ ] [정상] `parseKakaoPostcodeResult` — should map zonecode, roadAddress and jibunAddress into a postal code and two address lines
- [ ] [정상] `parseKakaoPostcodeResult` — should carry sido and sigungu through unchanged
- [ ] [정상] `parseKakaoCoordinate` — should read lng from x and lat from y of the first document
- [ ] [정상] `register` — should store the decomposed address with sido and sigungu when the member exists
- [ ] [정상] `register` — should store the coordinate that the geocoder returned
- [ ] [정상] `register` — should label the address 기본 when no label was given

### 경계

- [ ] [경계] `parseKakaoPostcodeResult` — should keep sigungu empty when the popup returns an empty sigungu
- [ ] [경계] `parseKakaoPostcodeResult` — should fall back to autoRoadAddress when roadAddress is empty
- [ ] [경계] `parseKakaoCoordinate` — should return null when documents is an empty array
- [ ] [경계] `register` — should store lat and lng as null when the geocoder returns null
- [ ] [경계] `register` — should reject a label that is only whitespace
- [ ] [경계] `register` — should not touch the address store when the input fails validation

### 예외

- [ ] [예외] `parseKakaoPostcodeResult` — should reject when both the road address and the jibun address are empty
- [ ] [예외] `parseKakaoPostcodeResult` — should reject when the postal code is not 5 digits
- [ ] [예외] `parseKakaoCoordinate` — should return null when the response has no documents field
- [ ] [예외] `register` — should still store the address when the geocoder throws
- [ ] [예외] `register` — should throw MEMBER_NOT_FOUND when the member does not exist
- [ ] [예외] `register` — should not call the geocoder at all when the member does not exist

### 경계 · HTTP

- [ ] [정상] `POST /members/:userId/addresses` — should return 201 with the created address
- [ ] [정상] `POST /members/:userId/addresses` — should return 201 with null lat and lng when geocoding failed
- [ ] [예외] `POST /members/:userId/addresses` — should return 404 with MEMBER_NOT_FOUND when the member does not exist
- [ ] [예외] `POST /members/:userId/addresses` — should return 400 with VALIDATION_FAILED and a postalCode field error when the postal code is malformed
- [ ] [예외] `POST /members/:userId/addresses` — should let an unknown error through so it becomes 500

### 화면

AC1의 "폼에 채워진다"는 화면 없이는 확인할 수 없다.

- [ ] [화면] `SignupAddressPage` — should fill the road address, jibun address and postal code when the popup returns a selection
- [ ] [화면] `SignupAddressPage` — should keep the form empty when the popup is closed without choosing
- [ ] [화면] `SignupAddressPage` — should send the chosen address and show the completion state when saving succeeds
- [ ] [화면] `SignupAddressPage` — should send no request when no address has been chosen yet
- [ ] [화면] `SignupAddressPage` — should show the server message when the server rejects the save
- [ ] [화면] `SignupAddressPage` — should guide back to signup when no signed-up member was carried over

**총 29개** (정상 6 / 경계 6 / 예외 6 / HTTP 5 / 화면 6)

---

## AC 대조

| #   | AC                                                                                                             | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Given 가입한 회원, When 우편번호 팝업에서 주소를 고르면, Then 도로명·지번·우편번호가 폼에 채워진다             | `[정상] parseKakaoPostcodeResult — should map zonecode, roadAddress and jibunAddress...`<br>`[경계] parseKakaoPostcodeResult — should fall back to autoRoadAddress...`<br>`[예외] parseKakaoPostcodeResult — should reject when both the road address and the jibun address are empty`<br>`[예외] parseKakaoPostcodeResult — should reject when the postal code is not 5 digits`<br>`[화면] should fill the road address, jibun address and postal code...`<br>`[화면] should keep the form empty when the popup is closed...`<br>`[화면] should guide back to signup when no signed-up member...`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | Given 선택된 주소, When 저장하면, Then 좌표(lat/lng)와 시/도·시/군/구가 분해되어 저장된다                      | `[정상] parseKakaoPostcodeResult — should carry sido and sigungu through unchanged`<br>`[정상] parseKakaoCoordinate — should read lng from x and lat from y...`<br>`[정상] register — should store the decomposed address with sido and sigungu...`<br>`[정상] register — should store the coordinate that the geocoder returned`<br>`[정상] register — should label the address 기본 when no label was given`<br>`[경계] parseKakaoPostcodeResult — should keep sigungu empty...`<br>`[경계] register — should reject a label that is only whitespace`<br>`[경계] register — should not touch the address store when the input fails validation`<br>`[예외] register — should throw MEMBER_NOT_FOUND...`<br>`[예외] register — should not call the geocoder at all when the member does not exist`<br>`[정상] POST — should return 201 with the created address`<br>`[예외] POST — should return 404...`<br>`[예외] POST — should return 400 ... postalCode field error`<br>`[예외] POST — should let an unknown error through so it becomes 500`<br>`[화면] should send the chosen address and show the completion state...`<br>`[화면] should send no request when no address has been chosen yet`<br>`[화면] should show the server message when the server rejects the save` |
| 3   | Given 좌표 변환 API가 실패했을 때, When 저장하면, Then 주소는 저장되고 좌표는 비어 있으며 저장 자체는 성공한다 | `[경계] parseKakaoCoordinate — should return null when documents is an empty array`<br>`[경계] register — should store lat and lng as null when the geocoder returns null`<br>`[예외] parseKakaoCoordinate — should return null when the response has no documents field`<br>`[예외] register — should still store the address when the geocoder throws`<br>`[정상] POST — should return 201 with null lat and lng when geocoding failed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**커버리지: AC 3개 전부 커버 / 시나리오 29개 / 미커버 0개**

### AC에 없는데 추가한 시나리오

| 시나리오                      | 왜 추가했나                                                                                                    | 조치    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | ------- |
| `MEMBER_NOT_FOUND`            | AC2의 "Given 가입한 회원"의 뒷면이다. 없으면 FK 위반이 그대로 올라가 500이 된다                                | 범위 안 |
| 세종특별자치시(시/군/구 없음) | 카카오가 실제로 빈 문자열을 준다. 필수로 막으면 세종 주민이 가입을 못 한다                                     | 범위 안 |
| `autoRoadAddress` 대체        | 지번만 있는 주소를 고르면 `roadAddress`가 빈 문자열로 온다. 그대로 저장하면 도로명이 빈 행이 쌓인다            | 범위 안 |
| x/y ↔ lng/lat 매핑            | 카카오는 `x`가 경도, `y`가 위도다. 뒤집으면 거리 검색이 통째로 어긋나는데 테스트 없이는 아무도 눈치채지 못한다 | 범위 안 |
| 라벨 공백 거절 / 기본 라벨    | 라벨은 `spec-fixed.md` §3이 요구한 컬럼이다. 공백이 통과하면 주소 목록이 빈칸으로 찬다                         | 범위 안 |
| HTTP 상태 매핑 5개            | #1에서 서비스만 보다 검증 실패가 500으로 나가는 버그를 놓쳤다. #2부터 처음부터 함께 쓴다                       | 범위 안 |

이슈 #3의 AC를 고칠 필요는 없다. 위는 전부 기존 AC를 지키기 위한 보조 시나리오다.

---

## 다음 단계

`/tdd-red 3` — 위 29개를 실패하는 테스트로 옮긴다.

**테스트 배치:**

| 파일                                                | 담을 것                                      |
| --------------------------------------------------- | -------------------------------------------- |
| `packages/shared/src/address.test.ts`               | 카카오 응답 파싱 (팝업 결과 · 로컬 API 응답) |
| `apps/api/src/auth/user-address.service.test.ts`    | 회원 확인·좌표 실패 흡수·저장 값 (DB는 가짜) |
| `apps/api/src/auth/user-address.controller.test.ts` | HTTP 상태·본문 매핑                          |
| `apps/web/src/app/signup/address/page.test.tsx`     | 팝업 결과가 폼에 채워짐, 저장 흐름           |
