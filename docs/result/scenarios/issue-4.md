# 이슈 #4 — 로그인하고 내 정보를 본다

> GitHub: https://github.com/Ikara777/fixer/issues/4
> PRD: `docs/result/prd/auth-member.md`
> 담당: **A**
> 선행: #2 (인증된 이메일로 가입)
> 상태: **Green 완료 — 시나리오 25개 전부 통과** · 다음: `@ac-verifier 4`

---

## 시그니처

### 관련 ADR

**`ADR-AUTH-1` — Refresh 토큰을 로그인 세션당 한 행으로 둔다.** (PRD §3, 확정 완료)

이 이슈의 구조는 전부 여기서 나온다.

- 로그인할 때마다 `RefreshToken` 행을 **추가**한다. `userId`에 유니크를 걸지 않고 `tokenHash`에 건다
- **회전(rotation, 갱신마다 새 토큰을 발급하고 옛 것을 폐기)하지 않는다.** 갱신해도 Refresh 토큰 값은 그대로다
- 갱신 = `findUnique(tokenHash)` 후 만료 확인
- 토큰은 해시로 저장한다 (`EmailVerification.codeHash`와 같은 방식)

**`spec-fixed.md` §2.5** — Access는 JWT(JSON Web Token, 서명이 붙어 있어 위조를
검출할 수 있는 문자열 토큰) 15분, Refresh는 14일, 둘 다 httpOnly(자바스크립트가
읽을 수 없는) + Secure + SameSite=Lax 쿠키. **이 값들은 이미 정해져 있어 여기서
다시 정하지 않는다.**

**`ADR-AUTH-3`(계정 생명주기)은 아직 TODO다.** 그래서 `User.deactivatedAt`을
보고 "비활성화된 계정은 로그인 불가"를 판정하는 일은 이 이슈에서 하지 않는다.
컬럼 자체가 없다. #9·#10이 컬럼과 함께 그 판정을 들고 온다.

### AC3의 "주소"를 어떻게 좁혔나

AC3은 "내 이메일·이름·주소가 보인다"고 하지만, **주소 등록(#3)이 아직 구현되지
않아 `User`에 주소 컬럼이 없다.** 이 이슈에서 주소 기능을 만들지 않는다 — #3의
몫이다.

그래서 AC3을 이렇게 좁혀 해석한다.

> 마이페이지가 **이메일과 이름을 보여주고**, 주소 자리는 **"아직 등록하지
> 않았습니다"로 비어 있음을 명시**한다.

응답 스키마에는 `address: string | null` 자리를 만들어 두고 지금은 항상 `null`을
내보낸다. 자리를 아예 비워두면 #3이 응답 모양을 바꾸게 되고, 그때 웹이 함께
깨진다. 자리만 만들고 채우는 것은 #3에 맡긴다. **주소 입력·검색·좌표 저장은
어느 것도 만들지 않는다.**

### 규칙 상수

```typescript
// packages/shared/src/auth.ts
export const AUTH_TOKEN_RULES = {
  /** spec-fixed §2.5 — Access 토큰 15분 */
  accessTokenMinutes: 15,
  /** spec-fixed §2.5 — Refresh 토큰 14일 */
  refreshTokenDays: 14,
} as const;

/**
 * 쿠키 이름. 웹 미들웨어(#5)와 API가 같은 문자열을 봐야 하므로 shared에 둔다.
 */
export const AUTH_COOKIES = {
  access: 'fixer_access',
  refresh: 'fixer_refresh',
} as const;
```

### 에러 코드

```typescript
// packages/shared/src/auth.ts
export const LOGIN_ERRORS = {
  /** 이메일이 없거나 비밀번호가 틀렸다. 둘을 구분해서 알려주지 않는다 */
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  /** 유효한 Access도, 살아 있는 Refresh도 없다 */
  UNAUTHENTICATED: 'AUTH_UNAUTHENTICATED',
} as const;

export type LoginErrorCode = (typeof LOGIN_ERRORS)[keyof typeof LOGIN_ERRORS];
```

`AUTH_INVALID_CREDENTIALS`는 AC2에 적힌 문자열 그대로다. `AUTH_UNAUTHENTICATED`는
AC4의 "보호 API"가 실패할 때 필요한 코드라 새로 만든다 — AC에 코드 문자열이
지정돼 있지 않은 유일한 자리다.

### 타입

```typescript
// packages/shared/src/auth.ts
export const loginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** 로그인 성공 응답. 토큰은 본문이 아니라 쿠키로만 나간다 */
export const signedInSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
});
export type SignedIn = z.infer<typeof signedInSchema>;

/** 마이페이지가 읽는 내 정보 */
export const myProfileSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  /** 주소는 #3이 채운다. 그전까지 항상 null이다 */
  address: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type MyProfile = z.infer<typeof myProfileSchema>;
```

```typescript
// apps/api/src/auth/access-token.ts

/** JWT 서명·검증에 쓰는 비밀키와 유효기간 */
export interface AccessTokenConfig {
  secret: string;
  /** 테스트가 만료를 앞당길 수 있도록 분 단위를 주입받는다 */
  expiresInMinutes?: number;
}

export interface AccessTokenPayload {
  /** 회원 id */
  sub: string;
  /** 발급 시각 (초) */
  iat: number;
  /** 만료 시각 (초) */
  exp: number;
}

export class AccessTokenSigner {
  constructor(config: AccessTokenConfig);
  sign(userId: string, now?: Date): { value: string; expiresAt: Date };
  /** 위조·만료면 null. 예외를 던지지 않는 이유는 호출부가 곧바로 갱신 경로로 넘어가기 때문이다 */
  verify(token: string, now?: Date): AccessTokenPayload | null;
}
```

```typescript
// apps/api/src/auth/login.service.ts

/** 이 도메인이 내는 실패. HTTP 경계가 `code`로 분기한다 */
export class LoginError extends Error {
  constructor(readonly code: LoginErrorCode);
}

/** `RefreshToken` 한 행. ADR-AUTH-1의 "로그인 세션 하나"에 대응한다 */
export interface RefreshTokenRecord {
  id: string;
  userId: string;
  /** 평문 저장 금지. 유출돼도 토큰을 알 수 없어야 한다 */
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

/** 회전하지 않으므로 갱신에 쓰는 메서드가 없다. 읽고 만들고 지우는 것뿐이다 */
export interface RefreshTokenStore {
  create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshTokenRecord>;
  findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
}

/**
 * 로그인이 쓰는 회원 조회 포트.
 *
 * #2의 `UserStore`를 그대로 쓰지 않는 이유는 필요한 것이 다르기 때문이다 —
 * 가입은 `create`가 필요하고 로그인은 `findById`가 필요하다. 좁은 포트를
 * 따로 두면 각자의 가짜 저장소가 남의 메서드를 구현하지 않아도 된다.
 * (Prisma 구현체 `PrismaUserStore`는 두 포트를 함께 만족한다)
 */
export interface AuthUserStore {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
}

/** 로그인이 발급한 것. 컨트롤러가 이걸 쿠키 두 개로 옮긴다 */
export interface IssuedSession {
  user: SignedIn;
  accessToken: { value: string; expiresAt: Date };
  refreshToken: { value: string; expiresAt: Date };
}

/**
 * 인증 결과. `renewedAccessToken`이 있으면 컨트롤러가 쿠키를 다시 심는다.
 * Refresh 토큰은 회전하지 않으므로 여기에 자리가 없다. (ADR-AUTH-1)
 */
export interface AuthenticatedSession {
  userId: string;
  renewedAccessToken?: { value: string; expiresAt: Date };
}

class LoginService {
  /** 조회 → 비밀번호 대조 → 토큰 두 개 발급 → Refresh 행 추가 */
  login(input: LoginRequest, now?: Date): Promise<IssuedSession>;

  /** Access가 살아 있으면 그대로, 만료됐고 Refresh가 유효하면 Access만 다시 발급 */
  authenticate(
    cookies: { accessToken?: string; refreshToken?: string },
    now?: Date,
  ): Promise<AuthenticatedSession>;

  /** 마이페이지가 읽는 내 정보 */
  getMyProfile(userId: string): Promise<MyProfile>;
}
```

```typescript
// apps/api/src/auth/login.controller.ts
@Controller('auth')
class LoginController {
  @Post('login') @HttpCode(HttpStatus.OK)
  login(body: unknown, res: Response): Promise<SignedIn>;

  @Get('me')
  me(req: Request, res: Response): Promise<MyProfile>;
}
```

### Prisma 모델

```prisma
/// 로그인 세션 하나. (이슈 #4, ADR-AUTH-1)
///
/// 로그인할 때마다 행을 추가한다. 회원당 여러 행이 쌓인다 — 휴대폰과 PC에
/// 동시에 로그인할 수 있어야 하기 때문이다. 회전하지 않으므로 갱신해도
/// 이 행은 그대로 있다.
model RefreshToken {
  id        String   @id @default(cuid())
  userId    String
  /// 평문 저장 금지. 조회 키라서 유니크는 여기에 건다.
  tokenHash String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// 전체 무효화(`deleteMany(userId)`)와 만료 행 정리에 쓰인다.
  @@index([userId])
}
```

### 에러 케이스

| 상황                                      | 에러 코드                  | HTTP | 출처      |
| ----------------------------------------- | -------------------------- | ---- | --------- |
| 없는 이메일 / 틀린 비밀번호               | `AUTH_INVALID_CREDENTIALS` | 401  | AC2       |
| 유효한 Access도, 살아 있는 Refresh도 없음 | `AUTH_UNAUTHENTICATED`     | 401  | AC4       |
| 이메일 형식 오류 / 비밀번호 빈칸          | `VALIDATION_FAILED` + 필드 | 400  | #2와 동일 |

없는 이메일과 틀린 비밀번호가 **같은 코드·같은 문구·같은 상태**여야 한다는 것이
AC2의 요지다. 다르면 이메일만 넣어보고 가입 여부를 알아낼 수 있다.

### 컴포넌트 Props

```typescript
// apps/web/src/app/login/page.tsx
export default function LoginPage(): JSX.Element; // props 없음

// apps/web/src/app/my/page.tsx
export default function MyPage(): JSX.Element; // props 없음
```

두 화면 모두 클라이언트 컴포넌트다. #1·#2 화면과 같은 방식으로 `fetch`를 직접
부르고, 쿠키는 브라우저가 알아서 실어 보낸다.

### 판단이 갈렸던 지점

**JWT 라이브러리를 새로 넣지 않고 `node:crypto`로 HS256을 직접 서명한다.**
JWT의 HS256은 `base64url(헤더).base64url(페이로드).HMAC-SHA256` 세 조각이 전부라
직접 만드는 데 40줄이 들지 않는다. 의존성을 늘리지 않는 대신, 손으로 만든 서명이
빠뜨리기 쉬운 두 구멍을 **시나리오로 못 박는다** — (1) `alg`를 `none`으로 바꾼
토큰을 받아주지 않는가, (2) 서명 비교가 상수 시간(timingSafeEqual)인가.
`bcrypt`(#2)를 대체하지 않은 것과는 반대 판단인데, 그쪽은 AC가 알고리즘을
지정했고 순수 JS 구현이 느려서였다. 여기는 표준 알고리즘을 그대로 쓴다.

**`authenticate`를 Nest 가드가 아니라 서비스 메서드로 뒀다.** 가드로 만들면
HTTP 컨텍스트 없이는 테스트할 수 없어서, AC4의 "만료됐지만 갱신되어 성공한다"를
검증하려면 매번 요청을 흉내내야 한다. 서비스 메서드면 쿠키 두 개를 인자로 주고
결과를 보면 끝난다. 가드가 필요해지는 것은 보호 API가 여럿이 되는 시점이고,
그때 이 메서드를 감싸면 된다.

**갱신을 `POST /auth/refresh` 같은 별도 엔드포인트로 만들지 않았다.** AC4가
"보호 API를 부르면 **토큰이 갱신되고 요청이 성공한다**"라고 쓰여 있다. 웹이 401을
받고 갱신을 따로 호출한 뒤 재시도하는 흐름이 아니라, 한 번의 호출로 끝나야 한다.

**로그아웃을 만들지 않는다.** ADR-AUTH-1이 `delete(tokenHash)`로 정해두었지만
이 이슈의 AC 넷 어디에도 없다. #5(보호 라우팅·로그아웃)의 몫이다.

**`now`를 인자로 주입받는다.** 15분·14일 경계를 실제로 기다릴 수 없다. #1이
같은 이유로 쓴 방식이다.

### 이 이슈에서 만들지 않는 것

| 항목                                 | 어디 소관                     |
| ------------------------------------ | ----------------------------- |
| 주소 등록·검색·좌표                  | #3                            |
| 로그아웃 / Next 미들웨어 보호 라우팅 | #5                            |
| 비밀번호 재설정 + 전체 토큰 무효화   | #6                            |
| 비활성화 계정 로그인 차단            | #9·#10 (`ADR-AUTH-3` 확정 후) |
| 만료된 `RefreshToken` 행 정리 배치   | #39                           |
| 로그인 이력·접속 기기 화면           | PRD Out of Scope              |

---

## 테스트 시나리오

### 정상

- [x] [정상] `login` — should issue an access token and a refresh token when the email and password match
- [x] [정상] `login` — should store the refresh token as a hash instead of the raw value
- [x] [정상] `login` — should add one refresh token row per login instead of replacing the previous one
- [x] [정상] `authenticate` — should return the member id when the access token is still valid
- [x] [정상] `authenticate` — should renew the access token when it expired and the refresh token is valid
- [x] [정상] `getMyProfile` — should return the email and name of the logged-in member

### 경계

- [x] [경계] `login` — should find the member case-insensitively when the email case differs from signup
- [x] [경계] `login` — should expire the access token in 15 minutes and the refresh token in 14 days
- [x] [경계] `authenticate` — should keep the refresh token value unchanged when it renews the access token
- [x] [경계] `authenticate` — should reject a refresh token whose expiresAt is exactly the current time
- [x] [경계] `getMyProfile` — should return a null address until the address feature exists

### 예외

- [x] [예외] `login` — should throw AUTH_INVALID_CREDENTIALS when no member has that email
- [x] [예외] `login` — should throw AUTH_INVALID_CREDENTIALS when the password does not match
- [x] [예외] `login` — should give the same error code and message for a wrong email and a wrong password
- [x] [예외] `authenticate` — should throw AUTH_UNAUTHENTICATED when neither cookie is present
- [x] [예외] `authenticate` — should throw AUTH_UNAUTHENTICATED when the access token expired and the refresh token is unknown
- [x] [예외] `AccessTokenSigner` — should reject a token whose payload, signature or alg header was tampered with

### 경계 · HTTP

- [x] [정상] `POST /auth/login` — should set the access and refresh tokens as httpOnly, secure, SameSite=Lax cookies and keep them out of the body
- [x] [예외] `POST /auth/login` — should return 401 with AUTH_INVALID_CREDENTIALS when the credentials are rejected
- [x] [정상] `GET /auth/me` — should return the profile and set a renewed access cookie when the access token expired
- [x] [예외] `GET /auth/me` — should return 401 with AUTH_UNAUTHENTICATED when no cookie is sent

### 화면

- [x] [화면] `LoginPage` — should send the email and password and move to the my page when login succeeds
- [x] [화면] `LoginPage` — should show the server message without telling which field was wrong when the credentials are rejected
- [x] [화면] `MyPage` — should show my email and name
- [x] [화면] `MyPage` — should show that no address is registered yet

**총 25개** (정상 6 / 경계 5 / 예외 6 / HTTP 4 / 화면 4)

---

## AC 대조

| #   | AC                                                                                                                  | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Given 가입한 회원, When 올바른 이메일·비밀번호로 로그인하면, Then Access·Refresh 토큰이 httpOnly 쿠키로 내려온다    | `[정상] login — should issue an access token and a refresh token…`<br>`[정상] login — should store the refresh token as a hash…`<br>`[정상] login — should add one refresh token row per login…`<br>`[경계] login — should expire … 15 minutes … 14 days`<br>`[경계] login — case-insensitively`<br>`[정상] POST /auth/login — httpOnly, secure, SameSite=Lax…`<br>`[화면] LoginPage — should send … and move to the my page`   |
| 2   | Given 틀린 비밀번호, When 로그인하면, Then `AUTH_INVALID_CREDENTIALS`로 거절되고 어느 쪽이 틀렸는지 알려주지 않는다 | `[예외] login — …when no member has that email`<br>`[예외] login — …when the password does not match`<br>`[예외] login — should give the same error code and message…`<br>`[예외] POST /auth/login — should return 401…`<br>`[화면] LoginPage — without telling which field was wrong`                                                                                                                                          |
| 3   | Given 로그인 상태, When 마이페이지를 열면, Then 내 이메일·이름·주소가 보인다                                        | `[정상] getMyProfile — should return the email and name…`<br>`[경계] getMyProfile — should return a null address…`<br>`[화면] MyPage — should show my email and name`<br>`[화면] MyPage — should show that no address is registered yet`<br>`[정상] authenticate — …when the access token is still valid`                                                                                                                       |
| 4   | Given Access 토큰이 만료됐고 Refresh는 유효할 때, When 보호 API를 부르면, Then 토큰이 갱신되고 요청이 성공한다      | `[정상] authenticate — should renew the access token…`<br>`[경계] authenticate — should keep the refresh token value unchanged…`<br>`[경계] authenticate — …expiresAt is exactly the current time`<br>`[예외] authenticate — …when neither cookie is present`<br>`[예외] authenticate — …refresh token is unknown`<br>`[정상] GET /auth/me — should set a renewed access cookie…`<br>`[예외] GET /auth/me — should return 401…` |

**커버리지: AC 4개 전부 커버 / 시나리오 25개 / 미커버 0개**

### AC에 없는데 추가한 시나리오

| 시나리오                           | 왜 추가했나                                                                                                | 조치    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| Refresh 토큰을 해시로 저장         | ADR-AUTH-1이 정한 저장 방식이다. 평문으로 넣으면 DB 유출이 곧 계정 탈취가 된다                             | 범위 안 |
| 로그인마다 행 추가 (덮어쓰기 아님) | ADR-AUTH-1의 핵심. 덮어쓰면 휴대폰 로그인이 PC를 조용히 끊는다                                             | 범위 안 |
| 갱신해도 Refresh 값이 그대로       | ADR-AUTH-1이 회전을 명시적으로 기각했다. 못 박지 않으면 나중에 "보안상 좋아 보여서" 회전이 슬며시 들어온다 | 범위 안 |
| 15분 / 14일 만료                   | `spec-fixed.md` §2.5가 정한 값. 상수가 바뀌면 테스트가 잡는다                                              | 범위 안 |
| 이메일 대소문자 무시               | #2가 소문자로 저장한다. 로그인이 정규화하지 않으면 가입은 됐는데 로그인이 안 되는 상태가 된다              | 범위 안 |
| `alg`·서명·페이로드 위조 거절      | 라이브러리 대신 직접 서명하기로 했으므로, 라이브러리가 대신 막아주던 구멍을 테스트가 막아야 한다           | 범위 안 |
| 토큰이 응답 본문에 없다            | 쿠키로 내리기로 해놓고 본문에도 실으면 httpOnly가 무의미해진다. 회귀를 막는 못                             | 범위 안 |

이슈 #4의 AC를 고칠 필요는 없다. 위는 전부 기존 AC와 확정된 ADR을 지키기 위한
보조 시나리오다.

---

## Green 결과

Red에서 25개 전부 실패(통과 0개)를 확인한 뒤 Green으로 넘어갔다. 지금은 25개
전부 통과한다. 기존 #1·#2 테스트도 그대로 통과한다. (api 81 / web 13)

### 구현하면서 정한 것

**JWT 라이브러리를 넣지 않고 `node:crypto`로 HS256을 서명한다.** 시그니처
단계에서 정한 대로다. 헤더는 `{"alg":"HS256","typ":"JWT"}` 하나만 받아주도록
**문자열 통째로 대조**했다 — `alg`를 파싱해서 검사하면 대소문자·공백 변형이
남는데, 우리가 만든 헤더와 같은지만 보면 그 변형이 전부 한 번에 걸린다.
서명 비교는 `timingSafeEqual`로 상수 시간이다.

**Refresh 토큰은 sha256으로 해시한다.** 비밀번호와 달리 bcrypt를 쓰지 않은
이유는 둘이다 — 값이 사람이 고른 것이 아니라 32바이트 난수라 사전 공격이
성립하지 않고, `tokenHash`가 조회 키(유니크)라서 같은 입력이 항상 같은 해시로
나와야 찾을 수 있다. `EmailVerification.codeHash`(#1)와 같은 방식이다.

**`AUTH_JWT_SECRET`이 없으면 API가 켜지지 않는다.** 기본값을 주면 그 값으로
서명한 토큰을 누구나 만들 수 있어, 개발 편의가 그대로 인증 우회가 된다.
`.env.example`에 이름과 생성 방법만 적었다.

**쿠키 파싱을 직접 했다.** `cookie-parser`를 들일 만큼 쓸 곳이 없다.
`Cookie` 헤더를 `;`로 가르는 열 줄이 전부이며, 컨트롤러 테스트가 이 경로를
지난다.

**`secure`를 개발 중에도 켰다.** 브라우저가 `localhost`를 안전한 출처로
취급하므로 http로도 쿠키가 저장된다. 환경마다 속성이 달라지면 "로컬에서는
되는데 배포하면 안 되는" 종류의 문제가 생긴다.

### 커버리지와 남은 갭

`apps/api` 전체 75.47%(구문), `auth` 디렉터리 80.32%.
`login.service.ts` 96.9%, `access-token.ts` 82.9%, `login.controller.ts` 74.4%.

미커버 구간은 셋이다.

1. **Prisma 어댑터가 0%** — `prisma-refresh-token.store.ts`,
   `prisma-user.store.ts`. 판정은 서비스에 있고 이 파일들은 조회·쓰기만 하므로
   단위 테스트로는 의미 있게 덮이지 않는다. #1·#2가 남긴 것과 같은 갭이다.
2. **컨트롤러의 입력 검증 분기** (`login.controller.ts` 134, 146-159) —
   본문이 스키마에 맞지 않을 때의 400 경로다. #2가 같은 코드를 이미 테스트로
   덮고 있어 시나리오에서 뺐는데, 코드를 복사해 온 자리라 **중복을 지우는 것이
   Refactor의 후보**다.
3. `access-token.ts` 122 — `JSON.parse`가 던지는 경로. base64url로 디코드는
   되는데 JSON이 아닌 페이로드다. 서명 검증을 이미 통과한 뒤라 실제로는
   우리가 만든 토큰만 여기 도달한다.

- [ ] [통합] 실제 Postgres에서 같은 회원으로 두 번 로그인하면 `RefreshToken`
      행이 두 개 쌓이는가 — 유니크가 `userId`가 아니라 `tokenHash`에 걸렸다는
      것은 스키마 제약이라 가짜 저장소로는 확인되지 않는다. Testcontainers로
      옮겨야 한다.

---

## 다음 단계

`@ac-verifier 4` — AC 4개가 실제로 충족됐는지 구현하지 않은 눈으로 검증한다.

**테스트 배치:**

| 파일                                         | 담을 것                                   |
| -------------------------------------------- | ----------------------------------------- |
| `apps/api/src/auth/access-token.test.ts`     | 서명·검증·위조 거절                       |
| `apps/api/src/auth/login.service.test.ts`    | 자격 대조·토큰 발급·갱신 판정 (DB는 가짜) |
| `apps/api/src/auth/login.controller.test.ts` | 쿠키 속성·HTTP 상태 매핑                  |
| `apps/web/src/app/login/page.test.tsx`       | 로그인 폼, 실패 문구                      |
| `apps/web/src/app/my/page.test.tsx`          | 내 정보 표시, 주소 없음 안내              |
