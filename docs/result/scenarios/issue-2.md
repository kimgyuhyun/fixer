# 이슈 #2 — 인증된 이메일로 가입한다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/2
> PRD: `docs/result/prd/auth-member.md`
> 담당: **미지정** — 기능을 먼저 다 만들고, 유지보수를 2명이 나눈다
> 선행: #1 (이메일 인증 코드 발급·검증)
> 상태: **Green 완료 — 시나리오 29개 전부 통과** · 다음: `@ac-verifier 2`

---

## 시그니처

### 관련 ADR

**`ADR-AUTH-4` — 인증 코드를 발급 이력 테이블에 쌓는다.** (PRD §3, 이슈 #1에서 확정)

이 이슈에는 새 ADR이 없다. 다만 #1의 결정이 "인증된 이메일"의 판정 방식을 정한다.
`EmailVerification`에는 **인증됨 플래그가 따로 없고**, 코드를 맞힌 순간 그 행의
`consumedAt`이 채워진다. 따라서 이 이슈에서 "인증된 이메일"은

> 그 이메일로 발급된 행 중 **`consumedAt`이 채워진 행이 하나라도 있다**

로 판정한다. 새 컬럼도, 새 테이블도 만들지 않는다.

**`ADR-AUTH-3`(계정 생명주기 상태 표현)은 아직 TODO다.** 그래서 `User`에
`deactivatedAt`·`role` 같은 생명주기·권한 컬럼을 **지금 넣지 않는다.** 결정 전에
넣으면 나중에 뜯게 된다. 이 이슈는 "가입되는 최소한의 `User`"까지만 만든다.

### 규칙 상수

```typescript
// packages/shared/src/auth.ts
export const SIGNUP_RULES = {
  /** AC4. 8자 미만은 거절된다 */
  passwordMinLength: 8,
  /**
   * bcrypt는 72바이트를 넘는 입력을 조용히 잘라낸다. 상한을 두지 않으면
   * 73바이트부터는 뒷부분이 비밀번호에 아무 영향을 주지 않는다.
   * 글자 수가 아니라 **바이트 수**로 재는 이유가 이것이다 — 한글 한 글자는 3바이트다.
   */
  passwordMaxBytes: 72,
  /** 공백만 있는 이름을 막는다. 다듬은(trim) 뒤에 잰다 */
  nameMinLength: 1,
  /** 방어적 상한. 사양에 값이 없어 입력 폭주만 막는 선에서 정했다 */
  nameMaxLength: 20,
  /** spec-fixed §2.2 "비밀번호 설정 (bcrypt cost 12)" */
  bcryptCostFactor: 12,
} as const;
```

### 에러 코드

```typescript
// packages/shared/src/auth.ts
export const SIGNUP_ERRORS = {
  /** 이메일 인증을 마치지 않았다 */
  EMAIL_NOT_VERIFIED: 'AUTH_EMAIL_NOT_VERIFIED',
  /** 그 이메일로 이미 회원이 있다 */
  EMAIL_ALREADY_EXISTS: 'MEMBER_EMAIL_ALREADY_EXISTS',
} as const;

export type SignupErrorCode =
  (typeof SIGNUP_ERRORS)[keyof typeof SIGNUP_ERRORS];
```

두 코드 모두 이슈 AC에 적힌 문자열 그대로다. 새로 만든 코드는 없다.

### 타입

```typescript
// packages/shared/src/auth.ts
export const signupRequestSchema = z.object({
  email: z.email(),
  password: z
    .string()
    .min(SIGNUP_RULES.passwordMinLength)
    .refine(
      (v) =>
        new TextEncoder().encode(v).length <= SIGNUP_RULES.passwordMaxBytes,
    ),
  name: z
    .string()
    .trim()
    .min(SIGNUP_RULES.nameMinLength)
    .max(SIGNUP_RULES.nameMaxLength),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

/** 가입 결과. 비밀번호와 해시는 절대 나가지 않는다 */
export const signedUpSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  createdAt: z.iso.datetime(),
});
export type SignedUp = z.infer<typeof signedUpSchema>;
```

```typescript
// apps/api/src/auth/signup.service.ts

/** 이 도메인이 내는 실패. HTTP 경계가 `code`로 분기한다 */
export class SignupError extends Error {
  constructor(readonly code: SignupErrorCode);
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  /** bcrypt 해시. 평문은 어디에도 남기지 않는다 */
  passwordHash: string;
  createdAt: Date;
}

/** 회원 저장소 포트. Prisma 구현체는 `prisma-user.store.ts` */
export interface UserStore {
  findByEmail(email: string): Promise<UserRecord | null>;
  create(input: {
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<UserRecord>;
}

/**
 * "이 이메일이 인증을 마쳤는가"만 묻는 포트.
 *
 * #1의 `EmailVerificationStore`를 통째로 끌어오지 않는 이유는, 가입이 알아야
 * 하는 것이 인증 이력 전체가 아니라 **예/아니오 하나**이기 때문이다.
 */
export interface EmailVerificationChecker {
  isVerified(email: string): Promise<boolean>;
}

class SignupService {
  /** 검증 → 인증 여부 → 중복 → 해시 → 저장 순으로 판정한다 */
  signup(input: SignupRequest): Promise<SignedUp>;
}
```

```typescript
// apps/api/src/auth/signup.controller.ts
@Controller('auth/signup')
class SignupController {
  @Post() @HttpCode(HttpStatus.CREATED)
  signup(body: unknown): Promise<SignedUp>;
}
```

### Prisma 모델

```prisma
model User {
  id           String   @id @default(cuid())
  /// 소문자로 정규화해서 저장한다. 대소문자만 다른 중복 계정을 막는다.
  email        String   @unique
  /// bcrypt 해시. 평문 저장 금지.
  passwordHash String
  name         String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

주소(#3), 동의서(#7), 평점·잔액 캐시, `role`, `deactivatedAt`은 이 이슈에서
넣지 않는다. 각 이슈가 자기 컬럼을 들고 온다.

### 에러 케이스

| 상황                 | 에러 코드                       | HTTP | 출처       |
| -------------------- | ------------------------------- | ---- | ---------- |
| 인증되지 않은 이메일 | `AUTH_EMAIL_NOT_VERIFIED`       | 403  | AC2        |
| 이미 가입된 이메일   | `MEMBER_EMAIL_ALREADY_EXISTS`   | 409  | AC3        |
| 8자 미만 비밀번호    | `VALIDATION_FAILED` + 필드 오류 | 400  | AC4        |
| 이름이 비었음        | `VALIDATION_FAILED` + 필드 오류 | 400  | AC4의 형제 |
| 이메일 형식 오류     | `VALIDATION_FAILED` + 필드 오류 | 400  | #1과 동일  |

### 판단이 갈렸던 지점

**판정 순서를 "인증 여부 → 중복" 으로 고정했다.** 둘 다 해당하는 요청
(인증하지 않은 채, 이미 가입된 이메일로 가입 시도)에서 무엇을 먼저 말할지가
갈렸다. 중복을 먼저 알리면 **아무나 이메일만 넣어보고 가입 여부를 알아낼 수
있다.** 인증을 마친 사람에게만 "이미 가입된 이메일"을 알려준다. 이 순서를
시나리오로 못 박는다.

**이메일을 소문자로 정규화한다.** `A@b.com`과 `a@b.com`을 다른 계정으로 두면
같은 사람이 계정 두 개를 갖게 되고, #1에서 인증한 주소와 가입 주소가 어긋난다.
저장할 때도 조회할 때도 소문자로 맞춘다. (로컬파트 대소문자를 구분하는 메일
서버가 이론상 있지만, 실무에서 쓰는 주요 제공자는 전부 구분하지 않는다.)

**비밀번호 상한을 바이트로 잰다.** bcrypt가 72바이트에서 자르기 때문이다.
글자 수로 재면 한글 24자(72바이트)를 넘는 순간 뒷글자가 무의미해지는데
사용자는 알 수 없다.

**`AUTH_EMAIL_NOT_VERIFIED`를 403으로 옮겼다.** 요청의 *모양*은 옳고 계정
*상태*가 허락하지 않는 것이므로 400이 아니다. 409는 "이미 있다"는 충돌이라
중복에 쓴다.

**bcrypt를 목(mock)으로 바꾸지 않는다.** AC1이 "bcrypt로 저장된다"를 요구하므로
테스트가 진짜 bcrypt 해시를 보고 판정해야 한다. cost 12는 한 번에 0.2초쯤
걸리지만, 해시를 만드는 시나리오는 몇 개뿐이라 감당된다.

### 이 이슈에서 만들지 않는 것

| 항목                                      | 어디 소관                         |
| ----------------------------------------- | --------------------------------- |
| 주소 입력                                 | #3                                |
| 동의서·전자서명                           | #7                                |
| 로그인·토큰 발급                          | #4                                |
| 비밀번호 재설정                           | #6                                |
| 비활성화 계정으로 재가입 시 재활성화 안내 | #10 (`ADR-AUTH-3` 확정 후)        |
| `role` / 관리자 구분                      | #32                               |
| 인증 유효기간 (인증 후 N분 안에 가입)     | 사양에 없다. 필요해지면 별도 이슈 |

---

## 테스트 시나리오

### 정상

- [x] [정상] `signup` — should create a User when the email is verified and the input is valid
- [x] [정상] `signup` — should store the password as a bcrypt hash instead of plain text
- [x] [정상] `signup` — should store a hash that matches the original password
- [x] [정상] `signup` — should return id, email, name and createdAt of the created member
- [x] [정상] `signup` — should trim the surrounding whitespace of the name before storing

### 경계

- [x] [경계] `signup` — should accept a password of exactly 8 characters
- [x] [경계] `signup` — should reject a password of exactly 7 characters
- [x] [경계] `signup` — should accept a password of exactly 72 bytes
- [x] [경계] `signup` — should reject a password of 73 bytes
- [x] [경계] `signup` — should reject a name that is only whitespace
- [x] [경계] `signup` — should treat the email case-insensitively when looking for an existing member
- [x] [경계] `signup` — should not touch the user store at all when the input fails validation

### 예외

- [x] [예외] `signup` — should throw AUTH_EMAIL_NOT_VERIFIED when the email was never verified
- [x] [예외] `signup` — should throw AUTH_EMAIL_NOT_VERIFIED when a code was issued but never consumed
- [x] [예외] `signup` — should throw MEMBER_EMAIL_ALREADY_EXISTS when a member with that email exists
- [x] [예외] `signup` — should throw AUTH_EMAIL_NOT_VERIFIED before MEMBER_EMAIL_ALREADY_EXISTS when both apply
- [x] [예외] `signup` — should reject when the email format is invalid
- [x] [예외] `signup` — should reject a password shorter than 8 characters

### 경계 · HTTP

컨트롤러가 없던 #1에서 **입력 검증 실패가 500으로 나가는 버그**가 서비스
테스트 28개가 초록인 채로 살아 있었다. 같은 실수를 반복하지 않도록 이번에는
경계를 처음부터 함께 쓴다.

- [x] [정상] `POST /auth/signup` — should return 201 with the created member when signup succeeds
- [x] [예외] `POST /auth/signup` — should return 400 with VALIDATION_FAILED and a password field error when the password is too short
- [x] [예외] `POST /auth/signup` — should return 403 with AUTH_EMAIL_NOT_VERIFIED when the email is not verified
- [x] [예외] `POST /auth/signup` — should return 409 with MEMBER_EMAIL_ALREADY_EXISTS when the email is taken
- [x] [예외] `POST /auth/signup` — should let an unknown error through so it becomes 500
- [x] [예외] `POST /auth/signup` — should never expose the password or its hash in the response

### 화면

AC4의 "필드 오류가 **표시되고**"는 화면 없이는 확인할 수 없다.

- [x] [화면] `SignupAccountPage` — should show the verified email with the name and password fields
- [x] [화면] `SignupAccountPage` — should show a password field error and send no request when the password is shorter than 8
- [x] [화면] `SignupAccountPage` — should show the server message when the server rejects the signup
- [x] [화면] `SignupAccountPage` — should show the completion state when signup succeeds
- [x] [화면] `SignupAccountPage` — should guide back to email verification when no verified email was carried over

**총 29개** (정상 5 / 경계 7 / 예외 6 / HTTP 6 / 화면 5)

---

## AC 대조

| #   | AC                                                                                                             | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Given 인증된 이메일, When 비밀번호와 이름을 넣어 가입하면, Then `User`가 생성되고 비밀번호는 bcrypt로 저장된다 | `[정상] signup — should create a User...`<br>`[정상] signup — should store the password as a bcrypt hash...`<br>`[정상] signup — should store a hash that matches...`<br>`[정상] signup — should return id, email, name and createdAt...`<br>`[정상] POST /auth/signup — should return 201...`<br>`[화면] should show the completion state...`                                                                                                                       |
| 2   | Given 인증되지 않은 이메일, When 가입하면, Then `AUTH_EMAIL_NOT_VERIFIED`로 거절된다                           | `[예외] signup — should throw AUTH_EMAIL_NOT_VERIFIED when the email was never verified`<br>`[예외] signup — ...when a code was issued but never consumed`<br>`[예외] signup — should throw AUTH_EMAIL_NOT_VERIFIED before MEMBER_EMAIL_ALREADY_EXISTS...`<br>`[예외] POST /auth/signup — should return 403...`                                                                                                                                                      |
| 3   | Given 이미 가입된 이메일, When 가입하면, Then `MEMBER_EMAIL_ALREADY_EXISTS`로 거절된다                         | `[예외] signup — should throw MEMBER_EMAIL_ALREADY_EXISTS...`<br>`[경계] signup — should treat the email case-insensitively...`<br>`[예외] POST /auth/signup — should return 409...`                                                                                                                                                                                                                                                                                 |
| 4   | Given 8자 미만 비밀번호, When 가입하면, Then 필드 오류가 표시되고 저장되지 않는다                              | `[경계] signup — should reject a password of exactly 7 characters`<br>`[경계] signup — should accept a password of exactly 8 characters`<br>`[경계] signup — should not touch the user store at all when the input fails validation`<br>`[예외] signup — should reject a password shorter than 8 characters`<br>`[예외] POST /auth/signup — should return 400 with ... a password field error`<br>`[화면] should show a password field error and send no request...` |

**커버리지: AC 4개 전부 커버 / 시나리오 29개 / 미커버 0개**

### AC에 없는데 추가한 시나리오

| 시나리오                        | 왜 추가했나                                                                                    | 조치    |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ------- |
| 비밀번호 72바이트 경계          | bcrypt가 그 지점에서 조용히 잘라낸다. 막지 않으면 뒷글자가 무의미해지는 걸 사용자가 알 수 없다 | 범위 안 |
| 이름 공백 거절 / 앞뒤 공백 제거 | AC가 "이름을 넣어"라고만 한다. 공백 한 칸도 이름으로 통과하면 회원 목록이 빈칸으로 찬다        | 범위 안 |
| 이메일 대소문자 무시            | 없으면 `A@b.com`과 `a@b.com`이 별개 계정이 되어 AC3이 우회된다                                 | 범위 안 |
| 인증 여부를 중복보다 먼저 판정  | 순서가 반대면 가입 여부가 아무에게나 새어나간다                                                | 범위 안 |
| 응답에 해시가 없다              | 실수로 `User`를 통째로 반환하면 해시가 나간다. 회귀를 막는 못                                  | 범위 안 |
| HTTP 상태 매핑 6개              | #1에서 서비스만 보다 500 버그를 놓쳤다                                                         | 범위 안 |

이슈 #2의 AC를 고칠 필요는 없다. 위는 전부 기존 AC를 지키기 위한 보조 시나리오다.

---

## Green 결과

Red에서 29개 전부 실패(통과 0개)를 확인한 뒤 Green으로 넘어갔다. 지금은 29개
전부 통과한다. 기존 #1 테스트도 그대로 통과한다. (api 60 / web 9)

### 구현하면서 정한 것

**`bcrypt`를 의존성에 추가했다.** AC1이 알고리즘을 지정하므로 대체하지 않았다.
`prebuilds/`에 플랫폼별 바이너리를 담아 배포하는 패키지라 install 스크립트가
필요 없고, `pnpm-workspace.yaml`의 `allowBuilds`에 `bcrypt: false`로 명시했다.
명시하지 않으면 `pnpm install`이 exit 1이 되어 CI가 깨진다.

**UTF-8 바이트 길이를 직접 세는 함수를 `shared`에 뒀다.** `TextEncoder`를 쓰면
웹·API 양쪽 런타임 타입을 끌어와야 해서 소비자 한쪽이 깨진다. 비밀번호 길이
규칙 자체는 화면도 같은 문구로 검사해야 하므로(AC4의 "필드 오류가 표시되고")
`shared`가 제자리다 — 서버에만 있어야 하는 것은 해싱이고, 그건 `apps/api`에 있다.

**`isVerified`는 대소문자를 무시하고 조회한다.** #1은 사용자가 입력한 대소문자
그대로 발급 이력을 쌓는데 가입은 소문자로 정규화한 주소로 묻는다. 무시하지
않으면 "인증은 했는데 가입이 막히는" 상태가 생긴다. #1의 판정 코드는 건드리지 않았다.

**#1 화면이 인증된 이메일을 `sessionStorage`에 남기도록 한 줄 더했다.** 그러지
않으면 가입 화면이 이메일을 받을 곳이 없어 슬라이스가 이어지지 않는다. 주소창
(query string)에 싣지 않은 것은 이메일이 개인정보라 이력·공유 링크에 남으면
안 되기 때문이다.

### 커버리지와 남은 갭

`apps/api` 전체 71.42%(구문), `auth` 디렉터리 80.64%.

미커버 구간은 대부분 **Prisma 어댑터**(`prisma-user.store.ts`,
`prisma-email-verification.store.ts`)가 0%인 것이다. 판정 로직은 서비스에 있고
이 파일들은 조회·쓰기만 하므로 단위 테스트로는 의미 있게 덮이지 않는다.
#1이 남긴 것과 같은 갭이다.

- [ ] [통합] 실제 Postgres에서 `isVerified`가 소비된 행만 참으로 보는가
- [ ] [통합] `email` 유니크 제약이 동시 가입 요청 두 건 중 하나를 막는가 —
      서비스의 `findByEmail` 검사만으로는 경합(race, 두 요청이 같은 순간에
      들어오는 상황)에서 이중 생성이 가능하다. Testcontainers로 옮겨야 한다.

---

## 다음 단계

`@ac-verifier 2` — AC 4개가 실제로 충족됐는지 구현하지 않은 눈으로 검증한다.

**테스트 배치:**

| 파일                                            | 담을 것                                       |
| ----------------------------------------------- | --------------------------------------------- |
| `apps/api/src/auth/signup.service.test.ts`      | 판정 순서·검증·bcrypt 해시 (DB는 가짜 저장소) |
| `apps/api/src/auth/signup.controller.test.ts`   | HTTP 상태·본문 매핑                           |
| `apps/web/src/app/signup/account/page.test.tsx` | 필드 오류 표시, 요청이 나가지 않음            |
