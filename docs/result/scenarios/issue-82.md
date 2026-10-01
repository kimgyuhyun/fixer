# 이슈 #82 — 가입 화면이 이어지지 않고, 주소·서명 API가 클라이언트의 userId를 믿는다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/82
> PRD: `docs/result/prd/auth-member.md` · `docs/result/prd/agreement.md`
> 담당: B · 선행: 없음 (#2·#3·#7·#69 머지됨)
> 상태: 시그니처 확정 / 시나리오 승인 (2026-10-01)

---

## 시그니처

### 관련 ADR

- **ADR-AUTH-5 (가입 직후 세션을 발급한다)** — 이 이슈가 새로 기록한다. 가입·재활성화가 성공하면
  로그인과 같은 쿠키 두 개를 심고, 주소·동의서 API는 #69의 `MemberGuard` + `CurrentMember`로
  회원을 판정한다. 가입 전용 토큰은 만들지 않는다.
- **ADR-AUTH-1 (Refresh 토큰을 로그인 세션당 한 행으로 둔다)** — 가입도 "로그인 한 번"으로 친다.
  `startSession`이 행을 하나 **추가**하고 회전하지 않는다. `login()`도 같은 메서드를 쓴다.
- **ADR-AUTH-2 (주소를 분해해 `UserAddress`에 저장한다)** — 회원당 주소가 여럿일 수 있으므로
  마이페이지에 보일 "기본 주소"의 규칙이 필요하다. #12 공고의 근무 주소 기본값
  (`PrismaMemberAddressReader.defaultAddressOf`)과 같은 규칙 — **가장 먼저 등록한 주소** — 을 쓴다.

### 타입

```typescript
// apps/api/src/auth/login.service.ts

/** 세션 하나를 이루는 토큰 두 개. 컨트롤러가 쿠키 두 개로 옮긴다 */
export interface SessionTokens {
  accessToken: { value: string; expiresAt: Date };
  refreshToken: { value: string; expiresAt: Date };
}

/** 로그인이 발급한 것. 모양은 그대로다 */
export interface IssuedSession extends SessionTokens {
  user: SignedIn;
}

/** 마이페이지에 보일 기본 주소. 가장 먼저 등록한 주소의 도로명, 비어 있으면 지번 */
export interface ProfileAddressReader {
  defaultAddressOf(userId: string): Promise<string | null>;
}

class LoginService {
  constructor(
    users: AuthUserStore,
    refreshTokens: RefreshTokenStore,
    accessTokens: AccessTokenSigner,
    addresses: ProfileAddressReader, // ← 추가
  );

  /** Refresh 행을 하나 추가하고 토큰 두 개를 돌려준다. login()도 이걸 쓴다 */
  startSession(userId: string, now?: Date): Promise<SessionTokens>;

  /** address를 실제로 채운다 (지금은 항상 null) */
  getMyProfile(userId: string): Promise<MyProfile>;
}
```

```typescript
// apps/api/src/auth/auth-cookie.ts (새 파일)
// login.controller.ts의 AUTH_COOKIE_OPTIONS·setAuthCookie를 옮긴다

/** 두 쿠키를 httpOnly·Secure·SameSite=Lax·path=/ 와 각 토큰의 만료로 심는다 */
export function setSessionCookies(res: Response, tokens: SessionTokens): void;
```

```typescript
// apps/api/src/auth/prisma-user-address.store.ts
@Injectable()
export class PrismaProfileAddressReader implements ProfileAddressReader {
  defaultAddressOf(userId: string): Promise<string | null>;
}
```

### 라우트

| 라우트                                                                             | 바뀌는 것                                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `POST /api/auth/signup` (201)                                                      | 응답 본문 `SignedUp` 그대로. `fixer_access`·`fixer_refresh` 쿠키를 함께 심는다              |
| `POST /api/auth/reactivate` (200)                                                  | 같은 처리                                                                                   |
| `POST /api/members/:userId/addresses` → **`POST /api/members/me/addresses`** (201) | `MemberGuard`. 회원은 `@CurrentMember()`. 옛 경로는 사라진다                                |
| `POST /api/agreements` (201)                                                       | `MemberGuard`. `readUserId` 삭제. 본문의 `userId`는 `signAgreementRequestSchema`가 떨어낸다 |
| `GET /api/agreements/template`                                                     | **그대로 공개.** 가입 전에도 읽는 문서다                                                    |

```typescript
// apps/api/src/auth/signup.controller.ts
class SignupController {
  constructor(service: SignupService, logins: LoginService);
  signup(body: unknown, res: Response): Promise<SignedUp>;
}

// apps/api/src/auth/reactivation.controller.ts
class ReactivationController {
  constructor(service: ReactivationService, logins: LoginService);
  reactivate(body: unknown, res: Response): Promise<SignedUp>;
}

// apps/api/src/auth/user-address.controller.ts
@Controller('members/me/addresses')
class UserAddressController {
  @Post() @UseGuards(MemberGuard)
  register(@CurrentMember() userId: string, @Body() body: unknown): Promise<RegisteredAddress>;
}

// apps/api/src/agreement/agreement.controller.ts
class AgreementController {
  @Post() @UseGuards(MemberGuard)
  sign(@CurrentMember() userId: string, @Body() body: unknown, @Req() req: Request): Promise<SignedAgreement>;
}
```

### 에러 케이스

새 에러 코드는 없다.

| 상황                                           | 에러 코드                        | HTTP |
| ---------------------------------------------- | -------------------------------- | ---- |
| 주소·서명 요청에 쿠키가 없거나 세션이 무효하다 | `AUTH_UNAUTHENTICATED`           | 401  |
| 주소·서명 본문 형식이 틀렸다                   | `VALIDATION_FAILED`              | 400  |
| 토큰은 유효한데 회원 행이 없다 (주소)          | `MEMBER_NOT_FOUND`               | 404  |
| 가입·재활성화 실패 (기존 코드 그대로)          | 기존 `SIGNUP_*`·`REACTIVATION_*` | 기존 |

가입·재활성화가 실패하면 **쿠키를 심지 않는다.**

### 컴포넌트 Props

```typescript
// apps/web/src/app/signup/SignupSteps.tsx (새 컴포넌트)
// 단계: 1 이메일 인증 · 2 계정 · 3 주소 · 4 동의서
// "2/4"가 글자로 보이고, 현재 단계에 aria-current="step"을 단다
interface SignupStepsProps {
  current: 1 | 2 | 3 | 4;
}
```

| 화면                  | 동작                                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signup/verify-email` | 상단에 `SignupSteps current={1}`                                                                                                                                                                                                  |
| `signup/account`      | `current={2}`. 가입 성공 → `router.replace('/signup/address')` (완료 화면 삭제). 재활성화 성공 → `router.replace('/my')`                                                                                                          |
| `signup/address`      | `current={3}`. sessionStorage를 읽지 않는다. `POST /api/members/me/addresses`. 성공 → `router.replace('/signup/agreement')`. 401 → "로그인이 필요합니다" + `/login` 링크                                                          |
| `signup/agreement`    | `current={4}`. 진입 시 `GET /api/agreements/mine` — 204면 서명 폼, 200이면 "이미 서명한 동의서가 있습니다" + `/my` 링크, 401이면 로그인 안내. 제출 본문은 `{ signaturePngBase64 }`뿐. 성공 → "가입이 끝났습니다" + `/`·`/my` 링크 |
| `my`                  | 주소가 null이면 "주소 등록하기"(`/signup/address`). `GET /api/agreements/mine` 204면 "동의서 서명하기"(`/signup/agreement`), 200이면 "내 동의서 보기"(`/my/agreement`). 낡은 문구 삭제                                            |

### 판단이 갈린 지점

- **주소 경로를 `me`로 바꾼다.** 가드를 붙이고 `:userId`를 남겨두면 "경로의 id는 무시된다"는 함정이 생긴다. `/api/points/me`·`/api/notifications/me`와 결도 맞다.
- **동의서 여부는 기존 `/api/agreements/mine`으로 묻는다.** `MyProfile`에 넣으면 인증 서비스가 동의서 도메인을 알게 된다. 주소는 `MyProfile.address` 자리가 이미 있어 채우기만 한다.
- **동의서 화면이 "이미 서명함"을 처리한다.** 마이페이지에서 주소만 등록하러 와도 저장 후 동의서 화면으로 넘어가므로, 중복 서명을 막는다.
- **주소·동의서 화면을 미들웨어 보호 경로에 넣지 않는다.** 지금 미들웨어는 Access 쿠키만 보므로 가입 15분 뒤 튕긴다. 화면이 401을 받아 안내한다. 미들웨어는 #83.
- **가입 단계 이동은 `replace`다.** 뒤로 가기로 계정 폼에 돌아가 다시 제출하면 "이미 가입된 이메일"만 난다.

### 이 이슈에서 만들지 않는 것

- 미들웨어 변경 (#83), 홈·헤더 (#84)
- `MemberGuard`·`AdminGuard`에 복사된 쿠키 옵션 정리 — 갱신 쿠키만 심고 이번 경로와 무관
- 동의서 미서명 회원의 이용 제한
- 마이페이지에서 들어와도 단계 표시가 "3/4"로 보이는 것 — 그대로 둔다
- `FIXME(#4)` 주석이 가리키는 `security-exceptions.md` 항목 — 대장에 실제로 없으므로 고칠 것이 없다

---

## 테스트 시나리오

> **#72의 테스트 두 개를 의도적으로 뒤집는다.** `agreement.route.test.ts`의
> `POST /agreements — should stay guardless so the signup flow is not blocked`와
> `should still sign during signup when the request carries no cookie`는 "가입 시점에 세션이 없다"는
> 전제를 지키던 테스트다. ADR-AUTH-5가 그 전제를 바꾸므로 아래 시나리오로 대체한다.
> 같은 이유로 `user-address.controller.test.ts`의 경로 `:userId` 전제와 웹 화면 테스트의
> `fixer.signup.userId` 주입도 새 시나리오로 대체한다.

### 정상

**API — 세션 발급**

- [x] [정상] `LoginService.startSession` — should return an access token and a refresh token when given a member id
- [x] [정상] `LoginService.startSession` — should store one refresh row holding the hash of the returned refresh token, not the token itself
- [x] [정상] `setSessionCookies` — should set fixer_access and fixer_refresh as httpOnly, secure, sameSite lax, path / cookies expiring with each token
- [x] [정상] `POST /auth/signup` — should set both auth cookies from a session started for the new member when signup succeeds
- [x] [정상] `POST /auth/signup` — should answer the SignedUp body without any token when signup succeeds
- [x] [정상] `POST /auth/reactivate` — should set both auth cookies from a session started for the reactivated member when reactivation succeeds

**API — 주소·서명이 토큰 주체를 쓴다**

- [x] [정상] `UserAddressController` — should be mounted at members/me/addresses with MemberGuard on register
- [x] [정상] `POST /members/me/addresses` — should register the address for the token subject
- [x] [정상] `POST /agreements` — should carry MemberGuard on the sign route
- [x] [정상] `POST /agreements` — should sign for the token subject

**API — 마이페이지 주소**

- [x] [정상] `LoginService.getMyProfile` — should return the default address from the address reader when the member has one
- [x] [정상] `PrismaProfileAddressReader.defaultAddressOf` — should return the road address of the member's address (통합)

**웹 — 단계 표시**

- [x] [정상] `SignupSteps` — should show "2/4" and mark only the second step with aria-current="step" when current is 2
- [x] [정상] `VerifyEmailPage` — should show step 1/4
- [x] [정상] `SignupAccountPage` — should show step 2/4
- [x] [정상] `SignupAddressPage` — should show step 3/4
- [x] [정상] `AgreementPage` — should show step 4/4 with the signature form

**웹 — 화면 전이**

- [x] [정상] `SignupAccountPage` — should replace the route with /signup/address when signup succeeds
- [x] [정상] `SignupAccountPage` — should replace the route with /my when reactivation succeeds
- [x] [정상] `SignupAddressPage` — should show the address form when sessionStorage holds no signup value
- [x] [정상] `SignupAddressPage` — should post the chosen address to /api/members/me/addresses with no userId in the url or body
- [x] [정상] `SignupAddressPage` — should replace the route with /signup/agreement when saving succeeds
- [x] [정상] `AgreementPage` — should show the signature form when /api/agreements/mine answers 204
- [x] [정상] `AgreementPage` — should post a body holding only signaturePngBase64 to /api/agreements
- [x] [정상] `AgreementPage` — should show the signup-finished screen with links to / and /my when signing succeeds

**웹 — 마이페이지**

- [x] [정상] `MyPage` — should show the registered address when the profile carries one
- [x] [정상] `MyPage` — should show a link to /my/agreement when /api/agreements/mine answers 200

### 경계

- [x] [경계] `LoginService.startSession` — should set the refresh expiry exactly 14 days and the access expiry exactly 15 minutes after now
- [x] [경계] `LoginService.startSession` — should add a new refresh row without deleting the member's existing rows when the member already has a session
- [x] [경계] `LoginService.getMyProfile` — should return a null address when the member registered no address
- [x] [경계] `PrismaProfileAddressReader.defaultAddressOf` — should return the earliest registered address when the member has two (통합)
- [x] [경계] `PrismaProfileAddressReader.defaultAddressOf` — should fall back to the jibun address when the road address is empty (통합)
- [x] [경계] `PrismaProfileAddressReader.defaultAddressOf` — should return null when the member has no address (통합)
- [x] [경계] `SignupSteps` — should show "1/4" and mark the first step when current is 1
- [x] [경계] `SignupSteps` — should show "4/4" and mark the last step when current is 4
- [x] [경계] `AgreementPage` — should show an already-signed message with a link to /my instead of the form when /api/agreements/mine answers 200
- [x] [경계] `MyPage` — should show a link to /signup/address when the profile address is null
- [x] [경계] `MyPage` — should show a link to /signup/agreement when /api/agreements/mine answers 204
- [x] [경계] `MyPage` — should not show the old note about issue #3

### 예외

**API**

- [x] [예외] `POST /auth/signup` — should set no cookie and start no session when the email already exists
- [x] [예외] `POST /auth/signup` — should set no cookie and start no session when the input is invalid
- [x] [예외] `POST /auth/reactivate` — should set no cookie and start no session when the email is not verified
- [x] [예외] `POST /members/me/addresses` — should answer 401 AUTH_UNAUTHENTICATED and register nothing when the request carries no cookie
- [x] [예외] `POST /members/me/addresses` — should ignore a userId in the body and register for the token subject
- [x] [예외] `POST /agreements` — should answer 401 AUTH_UNAUTHENTICATED and sign nothing when the request carries no cookie even though the body carries a userId
- [x] [예외] `POST /agreements` — should ignore another member's userId in the body and sign for the token subject

**웹**

- [x] [예외] `SignupAccountPage` — should stay on the form with the server message and not move when signup fails
- [x] [예외] `SignupAddressPage` — should show a login-required message with a link to /login when saving answers 401
- [x] [예외] `AgreementPage` — should show a login-required message with a link to /login instead of the form when /api/agreements/mine answers 401
- [x] [예외] `AgreementPage` — should show the login-required message when submitting answers 401

---

## AC 대조

| AC                                                                                                | 커버하는 시나리오                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 계정 만들기에 성공하면 로그인 쿠키가 심기고 주소 등록 화면으로 넘어간다                        | `[정상] startSession` ×2 · `[경계] startSession` ×2 · `[정상] setSessionCookies` · `[정상] POST /auth/signup` ×2 · `[예외] POST /auth/signup` ×2 · `[정상] POST /auth/reactivate` · `[예외] POST /auth/reactivate` · `[정상] SignupAccountPage — replace /signup/address`·`/my` · `[예외] SignupAccountPage — stay on the form` |
| 2. 주소를 저장하면 동의서 화면으로 넘어간다                                                       | `[정상] SignupAddressPage — show form without sessionStorage` · `— post to /me` · `— replace /signup/agreement`                                                                                                                                                                                                                 |
| 3. 서명하고 동의하면 가입 완료 화면이 뜨고 홈·마이페이지로 갈 수 있다                             | `[정상] AgreementPage — form on 204` · `— post only signature` · `— signup-finished screen with links`                                                                                                                                                                                                                          |
| 4. 가입 화면마다 몇 번째 단계인지 보인다                                                          | `[정상] SignupSteps — 2/4` · `[경계] SignupSteps — 1/4`·`4/4` · `[정상] VerifyEmailPage`·`SignupAccountPage`·`SignupAddressPage`·`AgreementPage — step n/4`                                                                                                                                                                     |
| 5. 쿠키 없는 요청으로 주소·동의서 API를 부르면 401                                                | `[예외] POST /members/me/addresses — 401` · `[예외] POST /agreements — 401` · `[정상] UserAddressController — MemberGuard` · `[정상] POST /agreements — MemberGuard`                                                                                                                                                            |
| 6. 남의 `userId`를 담아 보내면 무시되고 토큰 주체로 처리된다                                      | `[정상] POST /members/me/addresses — token subject` · `[예외] — ignore body userId` · `[정상] POST /agreements — token subject` · `[예외] — ignore another member's userId`                                                                                                                                                     |
| 7. 주소·동의서가 없는 회원이 마이페이지를 열면 링크가 보이고, 저장하면 마이페이지에 반영된다      | `[경계] MyPage — /signup/address`·`/signup/agreement` 링크 · `[정상] MyPage — registered address`·`/my/agreement` 링크 · `[정상]/[경계] getMyProfile` ×2 · `[정상]/[경계] PrismaProfileAddressReader` ×4 · `[경계] AgreementPage — already signed` · `[예외] AgreementPage` ×2                                                  |
| 8. 웹에서 `fixer.signup.userId`·`userId` 전송 코드가 사라지고 `FIXME(#4)`·`readUserId`가 사라진다 | `[정상] SignupAddressPage — no userId in url or body` · `[정상] AgreementPage — body holds only signaturePngBase64` · `[정상] SignupAddressPage — form without sessionStorage` + **ac-verifier가 grep으로 확인** (코드 부재는 테스트로 증명하지 않는다)                                                                         |
| 9. 마이페이지의 낡은 문구가 사라진다                                                              | `[경계] MyPage — should not show the old note about issue #3`                                                                                                                                                                                                                                                                   |

**AC에 없는데 넣은 시나리오**

- `[경계] AgreementPage — already signed` · `[예외] AgreementPage — mine 401`·`submit 401` — AC 7의 "마이페이지에서 들어와 저장"이 동의서 화면을 거치므로, 중복 서명과 세션 만료를 막는 경계다. AC 3·7의 이웃이라 범위 안으로 본다.
- `[예외] SignupAddressPage — 401` — 세션 없이 들어온 경우의 안내. 이전의 "가입이 필요합니다" 화면을 대신한다.

**커버리지:** AC 9개 / 시나리오 50개 / 미커버 0개 (AC 8의 "코드 부재"는 ac-verifier가 grep으로 확인)

---

## AC 검증

`ac-verifier` 에이전트의 판정 요약 (2026-10-01). **AC 9개 중 ✅ 9 / ⚠️ 0 / ❌ 0.**

| AC                                             | 판정 | 근거 요약                                                                                                                       |
| ---------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1. 가입 성공 → 쿠키 + 주소 화면                | ✅   | `signup.controller.ts`·`reactivation.controller.ts`가 성공·파싱 뒤에만 `startSession` → `setSessionCookies`. 실패 시 0회 테스트 |
| 2. 주소 저장 → 동의서 화면                     | ✅   | `address/page.tsx`가 `/api/members/me/addresses`로 POST 후 `replace('/signup/agreement')`                                       |
| 3. 서명 → 완료 화면, 홈·마이페이지             | ✅   | `agreement/page.tsx`의 `done` 단계. 본문은 `{ signaturePngBase64 }`뿐                                                           |
| 4. 가입 화면마다 단계 표시                     | ✅   | `SignupSteps` + 화면 네 개의 1/4~4/4 테스트. 분기 화면(401 안내·완료 등)에는 없다 — 폼 화면 기준으로 판정                       |
| 5. 쿠키 없으면 401                             | ✅   | 두 라우트에 `MemberGuard`. 실제 가드 인스턴스를 세워 가드 → 핸들러 순서로 단언                                                  |
| 6. 남의 `userId`는 무시                        | ✅   | 회원 id는 `@CurrentMember()`에서만. 본문 스키마에 `userId` 자리가 없다                                                          |
| 7. 마이페이지 링크·반영                        | ✅   | `getMyProfile`이 `ProfileAddressReader` 사용, 모듈 배선 확인. Prisma 정렬은 실제 Postgres로 검증                                |
| 8. `userId` 전송·`FIXME(#4)`·`readUserId` 제거 | ✅   | grep 확인 — 코드에는 없고 ADR 서술에만 남는다                                                                                   |
| 9. 낡은 문구 제거                              | ✅   | `queryByText(/이슈 #3/)` 부재 단언                                                                                              |

**선택적 보강으로 제안됐으나 넣지 않은 것:** 재활성화 404 경로의 쿠키 0회 테스트(같은 `try` 구조라 위험 없음), `AuthModule` 부팅 수준 배선 테스트(로컬 브라우저로 주소 반영을 확인함).

### 로컬 브라우저 확인 (구현자)

`pnpm dev`로 이메일 인증 → 계정(→ `/signup/address` 자동 이동) → 주소 → 마이페이지(주소 반영, "동의서 서명하기") → 동의서 서명(201) → "가입이 끝났습니다" → 마이페이지 "내 동의서 보기" → 동의서 화면 재진입 시 "이미 서명한 동의서가 있습니다"까지 이어지는 것을 확인했다. curl로 쿠키 없는 서명·주소 요청 401, 옛 경로 `POST /api/members/:userId/addresses` 404.

**확인하지 못한 것:** 카카오 우편번호 팝업. 브라우저 패널이 팝업을 막아 열리지 않아(카카오 스크립트는 로드됨), 팝업이 돌려줄 값을 페이지 안에서 같은 세션 쿠키로 직접 POST해 대체했다. 운영(https://fixer.kozow.com)에서 사람이 확인해야 한다.

---

## 보안 점검

`/security-review 82` (2026-10-01). 빌드·타입 오류 0, 전체 테스트(shared 70 · web 161 · api 1037) 통과 상태에서 수행했다.

### 🔴 즉시 수정 필요

없음.

### 🟡 권장 수정 (이 이슈 범위 밖)

| 항목                                                                                | 판단                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 대장에 없는 개발 의존성 권고 — `js-yaml`·`undici`·`brace-expansion`·`@grpc/grpc-js` | 경로가 전부 `@commitlint/cli`·`eslint`·`@nestjs/cli`·`testcontainers`·`vitest`다. `pnpm audit --prod`에는 대장 1~3번만 잡힌다. 판정은 ⚪지만 대장이 이미 3건이라 넣으면 규칙을 넘는다 — 대장 정리를 별도 작업으로 권한다 |

### ⚪ 무시 가능

| 항목                               | 이유                                                                                                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deepmerge-ts`·`mysql2`·`fast-uri` | 대장 1~3번. `@prisma/client`의 peer인 Prisma CLI 경로이고 재검토일(2026-11-30) 전이다. 이 PR은 의존성을 바꾸지 않았다                                                                              |
| 가입 응답이 쿠키를 심는 것의 CSRF  | 쿠키는 `SameSite=Lax`라 교차 사이트 POST에 실리지 않는다. 가입 자체도 이메일 인증을 거쳐야 하고, 본문이 JSON이라 교차 사이트 단순 요청(`text/plain`)으로는 파싱되지 않는다. 로그인과 같은 조건이다 |
| 재활성화가 세션을 여는 것          | 재활성화는 최근 이메일 인증을 요구한다(`ReactivationService`). 메일함을 가진 사람만 세션을 얻는다 — 로그인보다 약하지 않다                                                                         |

### 이 이슈의 변경을 직접 본 것

| 확인                  | 결과                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 비밀값 노출           | 없음. 키 패턴·알려진 접두사 grep 0건. `.env`는 추적되지 않는다                                                                                                |
| `NEXT_PUBLIC_` 오용   | 없음. 환경변수를 건드리지 않았다                                                                                                                              |
| 개인정보 로깅         | 없음. 이번 diff에 `console`·`Logger` 추가 없음                                                                                                                |
| 쿠키 옵션             | 가입·재활성화·로그인이 같은 `setSessionCookies`(`auth-cookie.ts`)로 `httpOnly`·`secure`·`sameSite: 'lax'`·`path: '/'`를 심는다. 테스트가 옵션 전체를 단언한다 |
| 토큰 노출             | 가입·재활성화 응답 본문은 `signedUpSchema`로 파싱돼 토큰 자리가 없다. 테스트가 본문에 토큰 문자열이 없음을 단언한다                                           |
| 에러 응답의 내부 정보 | 401은 `errorCode`와 안내 문구뿐이다                                                                                                                           |
| 입력 검증             | 주소·서명 컨트롤러가 여전히 zod로 `parse`한다. 회원 id만 본문·경로에서 가드로 옮겼다                                                                          |
