# 이슈 #1 — 이메일로 인증 코드를 받고 검증한다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/1
> PRD: `docs/result/prd/auth-member.md`
> 담당: **미지정** — 기능을 먼저 다 만들고, 유지보수를 2명이 나눈다
> 상태: **Green 완료 — 시나리오 28개 전부 통과** · 다음: `@ac-verifier 1`

---

## 시그니처

### 관련 ADR

**`ADR-AUTH-4` — 인증 코드를 발급 이력 테이블에 쌓는다.** (PRD §3)

발급할 때마다 행을 추가하고, 유효한 코드는 **"가장 최근의, 소비되지 않은, 만료되지 않은"** 행 하나다. 쿨다운은 최근 행의 `createdAt`으로, 시간당 5회는 최근 1시간 내 행 수로 판정한다.

이 결정이 시그니처에 미친 영향:

- 반환에 `resendAvailableAt`이 들어간다 — 쿨다운을 화면이 표시해야 하고, 그 값을 계산할 수 있는 쪽은 서버다
- 코드를 평문으로 저장하지 않으므로 조회로 비교하지 않고 **해시 대조**한다

### 규칙 상수

```typescript
// packages/shared/src/auth.ts
export const EMAIL_VERIFICATION_RULES = {
  codeLength: 6,
  expiryMinutes: 10,
  resendCooldownSeconds: 60,
  maxSendsPerHour: 5,
  /** 확정: 코드 하나당 3회까지 틀릴 수 있고, 3번째 실패에서 코드가 폐기된다 */
  maxAttempts: 3,
} as const;
```

테스트에서 짧은 값을 주입할 수 있게 상수를 한 곳에 모은다. 10분을 기다릴 수는 없다.

### 타입

```typescript
// packages/shared/src/auth.ts
import { z } from 'zod';

export const emailVerificationRequestSchema = z.object({
  email: z.email(),
});
export type EmailVerificationRequest = z.infer<
  typeof emailVerificationRequestSchema
>;

export const emailVerificationSentSchema = z.object({
  /** 이 시각이 지나면 코드가 만료된다 */
  expiresAt: z.iso.datetime(),
  /** 이 시각 전에는 재발송이 거절된다. 화면이 남은 초를 표시한다 */
  resendAvailableAt: z.iso.datetime(),
});
export type EmailVerificationSent = z.infer<typeof emailVerificationSentSchema>;

export const verifyEmailCodeRequestSchema = z.object({
  email: z.email(),
  code: z.string().regex(/^\d{6}$/),
});
export type VerifyEmailCodeRequest = z.infer<
  typeof verifyEmailCodeRequestSchema
>;

export const emailVerifiedSchema = z.object({
  email: z.email(),
  verifiedAt: z.iso.datetime(),
});
export type EmailVerified = z.infer<typeof emailVerifiedSchema>;
```

```typescript
// apps/api/src/auth/email-verification.service.ts
class EmailVerificationService {
  /** 6자리 코드를 발급하고 메일로 보낸다. 쿨다운·발송 제한을 여기서 판정한다 */
  requestCode(email: string): Promise<EmailVerificationSent>;

  /** 코드를 대조해 이메일을 인증됨으로 만든다 */
  verifyCode(email: string, code: string): Promise<EmailVerified>;
}
```

### Prisma 모델

```prisma
model EmailVerification {
  id           String    @id @default(cuid())
  email        String
  /** 평문 저장 금지. 유출돼도 코드를 알 수 없어야 한다 */
  codeHash     String
  expiresAt    DateTime
  /** 인증에 사용된 시각. 1회용이므로 이 값이 있으면 재사용 불가 */
  consumedAt   DateTime?
  /** 틀린 횟수. maxAttempts에 도달하면 이 코드는 폐기된다 */
  attemptCount Int       @default(0)
  createdAt    DateTime  @default(now())

  // 쿨다운(최근 1건)과 시간당 발송 수(최근 1시간) 판정에 함께 쓰인다
  @@index([email, createdAt])
}
```

### 에러 케이스

| 상황             | 에러 코드                               | HTTP | 출처             |
| ---------------- | --------------------------------------- | ---- | ---------------- |
| 10분이 지난 코드 | `MEMBER_VERIFICATION_CODE_EXPIRED`      | 400  | AC               |
| 60초 안에 재발송 | `MEMBER_RESEND_COOLDOWN`                | 429  | AC               |
| 1시간에 5회 초과 | `MEMBER_RESEND_LIMIT_EXCEEDED`          | 429  | AC               |
| 코드 불일치      | `MEMBER_VERIFICATION_CODE_INVALID`      | 400  | **AC 보강 필요** |
| 3회 틀림         | `MEMBER_VERIFICATION_ATTEMPTS_EXCEEDED` | 429  | **AC 보강 필요** |

마지막 두 개는 이슈의 AC에 없다. 아래 "AC 대조"의 보강 제안을 참고한다.

### 판단이 갈렸던 지점

**"발급 이력이 여러 행인데 어느 것이 유효한가."** 최신 행 하나만 유효하다고 정했다. 대안은 "만료 전이면 여러 코드를 모두 허용"인데, 그러면 재발송을 반복해 유효 코드를 여러 개 만들 수 있어 무작위 대입이 쉬워진다. **이 규칙이 지켜지는지 시나리오로 못 박는다.**

**코드 저장을 해시로 했다.** 6자리라 해시의 의미가 크진 않지만, DB가 유출됐을 때 그대로 쓸 수 있는 값을 남기지 않는 편이 낫다. 무작위 대입은 해시가 아니라 시도 3회 제한이 막는다.

### 이 이슈에서 만들지 않는 것

| 항목                   | 어디 소관                                                                 |
| ---------------------- | ------------------------------------------------------------------------- |
| 실제 메일 발송         | #37. 여기서는 `MailProvider`를 목(mock, 진짜 대신 세워두는 가짜)으로 대체 |
| `User` 레코드 생성     | #2. 여기는 "이 이메일이 인증됐다"는 상태까지만                            |
| 로그인·토큰 발급       | #4                                                                        |
| 비밀번호 재설정용 토큰 | #6. 같은 테이블을 쓸지는 그때 결정                                        |
| 발급 이력 정리 배치    | #39 (개인정보 파기)                                                       |

---

## 테스트 시나리오

### 정상

- [x] [정상] `requestCode` — should issue a 6-digit code when the email has no prior request
- [x] [정상] `requestCode` — should set expiresAt to 10 minutes ahead when a code is issued
- [x] [정상] `requestCode` — should set resendAvailableAt to 60 seconds ahead when a code is issued
- [x] [정상] `requestCode` — should store the code hashed when a code is issued
- [x] [정상] `requestCode` — should send the code through MailProvider when a code is issued
- [x] [정상] `verifyCode` — should mark the email verified when the code matches
- [x] [정상] `verifyCode` — should return verifiedAt when verification succeeds
- [x] [정상] `verifyCode` — should consume the code when verification succeeds

### 경계

- [x] [경계] `requestCode` — should reject when exactly 59 seconds have passed since the last send
- [x] [경계] `requestCode` — should succeed when exactly 60 seconds have passed since the last send
- [x] [경계] `requestCode` — should succeed on the 5th send within one hour
- [x] [경계] `requestCode` — should reject on the 6th send within one hour
- [x] [경계] `requestCode` — should succeed when the oldest of 5 sends falls outside the 1-hour window
- [x] [경계] `requestCode` — should invalidate the previous unconsumed code when a new one is issued
- [x] [경계] `verifyCode` — should succeed when the code is 1 second before expiry
- [x] [경계] `verifyCode` — should reject when the code is exactly at expiry
- [x] [경계] `verifyCode` — should succeed on the 3rd attempt when the first two were wrong
- [x] [경계] `verifyCode` — should discard the code on the 3rd wrong attempt
- [x] [경계] `verifyCode` — should consume the code only once when called twice concurrently

### 예외

- [x] [예외] `requestCode` — should throw MEMBER_RESEND_COOLDOWN when requested within 60 seconds
- [x] [예외] `requestCode` — should throw MEMBER_RESEND_LIMIT_EXCEEDED when 5 sends already happened within the hour
- [x] [예외] `requestCode` — should reject when the email format is invalid
- [x] [예외] `verifyCode` — should throw MEMBER_VERIFICATION_CODE_INVALID when the code does not match
- [x] [예외] `verifyCode` — should throw MEMBER_VERIFICATION_CODE_EXPIRED when the code is past expiry
- [x] [예외] `verifyCode` — should throw MEMBER_VERIFICATION_ATTEMPTS_EXCEEDED when 3 wrong attempts were already made
- [x] [예외] `verifyCode` — should throw when the code was already consumed
- [x] [예외] `verifyCode` — should throw when no code was ever issued for the email
- [x] [예외] `verifyCode` — should throw when the code was issued for a different email

**총 28개** (정상 8 / 경계 11 / 예외 9)

---

## AC 대조

| #   | AC                                                                                                      | 커버하는 시나리오                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Given 가입하지 않은 이메일, When 인증 요청을 보내면, Then 6자리 코드가 발송되고 10분 뒤 만료로 저장된다 | `[정상] requestCode — should issue a 6-digit code...`<br>`[정상] requestCode — should set expiresAt to 10 minutes ahead...`<br>`[정상] requestCode — should send the code through MailProvider...`                                                                              |
| 2   | Given 발송된 코드, When 그 코드를 입력하면, Then 해당 이메일이 인증됨으로 표시된다                      | `[정상] verifyCode — should mark the email verified...`<br>`[정상] verifyCode — should return verifiedAt...`                                                                                                                                                                    |
| 3   | Given 발송된 지 10분이 지난 코드, When 입력하면, Then `MEMBER_VERIFICATION_CODE_EXPIRED`로 거절된다     | `[경계] verifyCode — should reject when the code is exactly at expiry`<br>`[경계] verifyCode — should succeed when the code is 1 second before expiry`<br>`[예외] verifyCode — should throw MEMBER_VERIFICATION_CODE_EXPIRED...`                                                |
| 4   | Given 60초 안에 재발송을 요청하면, Then `MEMBER_RESEND_COOLDOWN`으로 거절되고 남은 시간이 안내된다      | `[예외] requestCode — should throw MEMBER_RESEND_COOLDOWN...`<br>`[경계] requestCode — should reject when exactly 59 seconds...`<br>`[경계] requestCode — should succeed when exactly 60 seconds...`<br>`[정상] requestCode — should set resendAvailableAt...`                  |
| 5   | Given 한 시간에 5회를 채운 이메일, When 재발송하면, Then `MEMBER_RESEND_LIMIT_EXCEEDED`로 거절된다      | `[예외] requestCode — should throw MEMBER_RESEND_LIMIT_EXCEEDED...`<br>`[경계] requestCode — should succeed on the 5th send...`<br>`[경계] requestCode — should reject on the 6th send...`<br>`[경계] requestCode — should succeed when the oldest of 5 sends falls outside...` |

**커버리지: AC 5개 전부 커버 / 시나리오 28개 / 미커버 0개**

### AC에 없는데 추가한 시나리오

| 시나리오                            | 왜 추가했나                                                                                  | 조치                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | --------------------- |
| 코드 불일치 (`INVALID`)             | AC에 "틀린 코드" 케이스가 없다. 이게 없으면 아무 코드나 넣어도 되는 구현이 테스트를 통과한다 | **이슈 AC 보강 필요** |
| 3회 시도 제한 (`ATTEMPTS_EXCEEDED`) | 이번에 확정된 규칙. AC에 반영돼야 이슈를 닫을 근거가 된다                                    | **이슈 AC 보강 필요** |
| 코드 해시 저장                      | 평문 저장을 막는다. 구현 방법이 아니라 "유출 시 코드를 알 수 없다"는 성질                    | 범위 안               |
| 이전 코드 무효화                    | 재발송을 반복해 유효 코드를 여러 개 만드는 것을 막는다                                       | 범위 안               |
| 이미 소비된 코드 재사용             | 1회용이라는 성질. AC의 "인증됨으로 표시된다"에 암묵적으로 포함                               | 범위 안               |
| 다른 이메일의 코드 사용             | 교차 사용 차단. 없으면 A의 코드로 B가 인증된다                                               | 범위 안               |
| 동시 호출 시 1회만 소비             | 같은 코드로 두 요청이 동시에 오는 경우                                                       | 범위 안               |
| 발송이 `MailProvider`를 탄다        | AC의 "발송되고"를 검증 가능한 형태로 옮긴 것                                                 | 범위 안               |

### 이슈 #1에 추가 제안하는 AC 2개

```
- [ ] Given 발송된 코드, When 틀린 코드를 입력하면, Then `MEMBER_VERIFICATION_CODE_INVALID`로 거절된다
- [ ] Given 3회 틀린 코드, When 다시 입력하면, Then `MEMBER_VERIFICATION_ATTEMPTS_EXCEEDED`로 거절되고 그 코드는 폐기된다
```

GitHub 이슈 수정은 저장소 밖 작업이므로 **별도 확인 후** 반영한다. (`CLAUDE.md`)

---

## ac-verifier 이후 추가된 시나리오

`@ac-verifier 1`이 **AC 4를 부분 충족**으로 판정했다. "60초 안 재발송은
`MEMBER_RESEND_COOLDOWN`으로 거절된다"는 검증됐지만, 뒷절인 **"남은 시간이
안내된다"**는 자동으로도 수동으로도 확인된 적이 없었다. 거절만 하고 얼마나
기다려야 하는지 알려주지 않으면 사용자는 버튼을 계속 누르게 된다.

아래를 추가해 닫았다.

- [x] [예외] `requestCode` — 쿨다운으로 거절될 때 남은 초가 에러에 실린다
- [x] [경계] `requestCode` — 남은 시간은 올림한다 (0.5초 남았는데 0초로 안내하면 곧바로 눌러 또 거절당한다)
- [x] [경계] `POST /auth/email-verification` — 429 본문에 `retryAfterSeconds`와 숫자가 들어간 문구가 함께 온다
- [x] [화면] 재발송 버튼이 남은 초를 1초마다 세어 보여주고, 그동안 비활성이다
- [x] [화면] 쿨다운이 끝나면 버튼이 다시 눌린다
- [x] [화면] 요청이 거절되면 서버가 준 문구를 그대로 보여준다

### 함께 메운 경계 테스트

컨트롤러 테스트가 하나도 없어서, 서비스 테스트 28개가 통과하는 동안
**입력 검증 실패(ZodError)가 500으로 나가는 버그가 살아 있었다.** 서비스만
보면 경계의 실수가 보이지 않는다. 아래를 추가했다.

- [x] [예외] 이메일 형식이 틀리면 400 (`VALIDATION_FAILED`)
- [x] [예외] 틀린 코드는 400, 시도 초과는 429
- [x] [예외] 우리가 모르는 에러는 그대로 올려보내 500이 되게 둔다
- [x] [정상] 코드가 맞으면 검증 결과를 그대로 돌려준다

### 남은 갭

- [ ] [통합] 같은 코드로 동시 요청이 와도 1회만 소비된다 — 단위 테스트의 가짜
      저장소로는 증명되지 않는다. `PrismaEmailVerificationStore.markConsumed()`가
      `where: { id }`만 쓰므로 실제 DB에서는 이중 소비 가능성이 남아 있다.
      Testcontainers 통합 테스트로 옮겨야 한다.

---

## 다음 단계

`/tdd-red 1` — 위 28개 시나리오를 그대로 테스트 이름으로 옮기고, stub을 만들어 전부 빨간불을 확인한다.

**테스트 배치 예정:**

| 파일                                                   | 담을 것                                            |
| ------------------------------------------------------ | -------------------------------------------------- |
| `packages/shared/src/auth.test.ts`                     | zod 스키마 검증 (이메일 형식, 6자리 형식)          |
| `apps/api/src/auth/email-verification.service.test.ts` | 시간·횟수 판정 로직 (DB는 목)                      |
| `apps/api/test/email-verification.integration.test.ts` | 동시 호출, 이전 코드 무효화 등 진짜 DB가 필요한 것 |
