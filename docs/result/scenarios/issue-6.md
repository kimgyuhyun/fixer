# 이슈 #6 — 비밀번호를 재설정한다

> 선행 #4 (로그인) · 도메인 auth-member · 크기 M
> 브랜치 `feat/auth-member/issue-6` (base: `feat/auth-member/issue-5`)

마이페이지 변경은 막고 재설정만 연다. (`spec-fixed.md` §2.4)

---

## 시그니처

### 데이터

```prisma
/// 재설정 링크 토큰. 발급마다 행을 쌓는다 (ADR-AUTH-4와 같은 방식).
model PasswordReset {
  id         String    @id @default(cuid())
  userId     String
  /// 평문 저장 금지. 유출돼도 토큰을 알 수 없어야 한다.
  tokenHash  String    @unique
  expiresAt  DateTime
  /// 사용된 시각. 1회용이므로 값이 있으면 재사용 불가.
  consumedAt DateTime?
  createdAt  DateTime  @default(now())
  user       User      @relation(fields: [userId], references: [id])

  @@index([userId, createdAt])
}
```

### 서버

```ts
export interface PasswordResetStore {
  create(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | null>;
  consume(id: string, at: Date): Promise<void>;
}

// 기존 포트에 추가
export interface RefreshTokenStore {
  deleteAllForUser(userId: string): Promise<void>;   // ← 추가 (§2.4 "모든 Refresh 토큰 무효화")
}
export interface AuthUserStore {
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;  // ← 추가
}
export interface MailProvider {
  sendPasswordResetLink(email: string, token: string): Promise<void>;       // ← 추가
}

/**
 * 재설정 메일을 요청한다.
 *
 * **회원이 없어도 성공으로 응답한다.** 없다고 알려주면 이메일만 넣어보고
 * 가입 여부를 알아낼 수 있다. #4 AC2에서 응답 시간으로 새어나갔던 것과 같은 문제다.
 */
requestReset(email: string, now: Date): Promise<void>

/**
 * 새 비밀번호를 설정한다. 토큰을 소비하고 그 회원의 Refresh를 전부 지운다.
 */
resetPassword(input: { token: string; newPassword: string }, now: Date): Promise<void>
```

```ts
POST /auth/password-reset          →  204   (요청. 회원 없어도 204)
POST /auth/password-reset/confirm  →  204   (재설정)
```

### 웹

```
/password-reset          비밀번호 찾기 — 이메일 입력
/password-reset/confirm  링크로 들어오는 화면 — 새 비밀번호 입력 (?token=...)
```

---

## 판단이 갈렸던 지점

**`EmailVerification`을 재사용하지 않고 `PasswordReset`을 새로 만든다.**
목적도 수명도 모양도 다르다. #1은 사람이 손으로 옮겨 적는 6자리 코드(10분)이고,
이건 링크에 실리는 32바이트 난수(30분)다. 한 테이블에 섞으면 "이 행이 어느 쪽인가"를
가르는 컬럼이 하나 더 필요해지고, 쿨다운·시도 횟수 규칙도 서로 달라 조건문이 갈린다.

**회원이 없어도 204를 준다.**
`#4 AC2`가 "어느 쪽이 틀렸는지 알려주지 않는다"를 요구했는데 구현이 응답 시간으로
새어나갔던 전례가 있다. 여기서는 아예 분기 자체를 응답에 반영하지 않는다.

**토큰을 해시로 저장한다.**
`RefreshToken.tokenHash`와 같다. 난수라 사전 공격이 성립하지 않으므로 sha256이고,
조회 키라서 같은 입력이 항상 같은 해시가 되어야 한다.

**재설정 성공 시 Refresh를 전부 지운다 (§2.4).**
`deleteByTokenHash`(#5)가 아니라 `deleteAllForUser`다. 비밀번호가 털려서 재설정하는
상황이라면 남의 세션이 살아 있으면 안 된다. #5의 "그 기기만"과 반대 방향이고, 그게 맞다.

---

## 시나리오

### 재설정 요청 (AC1)

- [ ] [정상] `requestReset` — should store a hashed token that expires in 30 minutes
- [ ] [정상] `requestReset` — should send the reset link to the member email
- [ ] [경계] `requestReset` — should resolve without sending anything when no member has that email
- [ ] [경계] `requestReset` — should find the member case-insensitively
- [ ] [정상] `POST /auth/password-reset` — should return 204
- [ ] [경계] `POST /auth/password-reset` — should return 204 even when the email belongs to nobody

### 재설정 실행 (AC2)

- [ ] [정상] `resetPassword` — should replace the password hash with a bcrypt hash of the new password
- [ ] [정상] `resetPassword` — should delete every refresh token of that member
- [ ] [정상] `resetPassword` — should mark the token consumed
- [ ] [경계] `resetPassword` — should reject a new password shorter than 8 characters and change nothing
- [ ] [정상] `POST /auth/password-reset/confirm` — should return 204

### 토큰 재사용·만료 (AC3)

- [ ] [예외] `resetPassword` — should reject with AUTH_RESET_TOKEN_INVALID when the token was already consumed
- [ ] [예외] `resetPassword` — should reject when the token has expired
- [ ] [예외] `resetPassword` — should reject when the token does not exist
- [ ] [경계] `resetPassword` — should reject exactly at the expiry instant
- [ ] [예외] `POST /auth/password-reset/confirm` — should return 400 with AUTH_RESET_TOKEN_INVALID for a used token

### 마이페이지에 변경 메뉴가 없다 (AC4)

- [ ] [화면] `MyPage` — should not offer a 비밀번호 변경 menu
- [ ] [화면] `PasswordResetPage` — should show a sent notice after requesting a reset mail

**총 18개** (정상 8 / 경계 5 / 예외 3 / 화면 2)

---

## AC 대조

| #   | AC                                                               | 커버하는 시나리오                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 재설정 메일을 요청하면 30분 유효·1회용 토큰 링크가 발송된다      | `requestReset — should store a hashed token that expires in 30 minutes` 외 3<br>`POST /auth/password-reset` 2건<br>`PasswordResetPage — should show a sent notice...`                                                                                                                                          |
| 2   | 유효한 토큰으로 새 비밀번호를 설정하면 모든 Refresh가 무효화된다 | `resetPassword — should replace the password hash...`<br>`resetPassword — should delete every refresh token of that member`<br>`resetPassword — should mark the token consumed`<br>`resetPassword — should reject a new password shorter than 8...`<br>`POST /auth/password-reset/confirm — should return 204` |
| 3   | 이미 쓴 토큰을 다시 쓰면 거절된다                                | `resetPassword — ...already consumed`<br>`...has expired`<br>`...does not exist`<br>`...exactly at the expiry instant`<br>`POST .../confirm — should return 400...`                                                                                                                                            |
| 4   | 마이페이지에 "비밀번호 변경" 메뉴가 없다                         | `MyPage — should not offer a 비밀번호 변경 menu`                                                                                                                                                                                                                                                               |

**커버리지: AC 4개 전부 커버 / 시나리오 18개 / 미커버 0개**

---

## 이번 범위 밖

| 항목                         | 이유                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| 재설정 요청 쿨다운·횟수 제한 | AC에 없다. #1의 인증 쿨다운이 앞을 막지 않는 경로라 후속 건으로 남긴다 |
| 실제 메일 발송               | `ConsoleMailProvider`가 콘솔에 찍는다. Resend는 #37                    |
| 비밀번호 재사용 금지         | AC에 없다                                                              |
| 실제 링크 클릭 E2E           | Playwright 미설정                                                      |
