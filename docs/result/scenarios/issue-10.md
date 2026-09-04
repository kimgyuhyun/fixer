# 이슈 #10 — 비활성화 계정을 재활성화한다

> 선행 #9 (탈퇴) · 도메인 auth-member · 크기 S
> 브랜치 `feat/auth-member/issue-10` (base: `feat/auth-member/issue-9`)

**이 이슈의 존재 이유는 마지막 AC다.** 경고 4건 쌓인 사람이 탈퇴하고 다시
가입해서 이력을 세탁하는 것을 막는다. 그러려면 재활성화가 **같은 행을
되살리는 것**이어야 한다. 새 행을 만들면 이력이 끊기고 세탁이 성공한다.

---

## 시그니처

### 데이터

새 컬럼이 없다. #9이 만든 `User.deactivatedAt`을 `null`로 되돌리는 것이 전부다.

### 서버

```ts
/** 가입 시도가 재활성화 대상을 만났다 */
export class ReactivationAvailableError extends Error {
  readonly code = 'AUTH_REACTIVATION_AVAILABLE';
}

/**
 * 비활성화된 계정을 되살린다.
 *
 * 이메일 인증을 마쳤어야 한다 — 메일함을 쥐고 있다는 증명이고, 비밀번호
 * 재설정과 같은 수준의 권한이다.
 */
reactivate(input: { email: string; password: string }): Promise<SignedUp>
```

```
POST /auth/signup      →  409 AUTH_REACTIVATION_AVAILABLE  (비활성 계정일 때)
POST /auth/reactivate  →  200 SignedUp
                       →  403 AUTH_EMAIL_NOT_VERIFIED
                       →  404 AUTH_MEMBER_NOT_FOUND        (활성이거나 없는 계정)
```

---

## 판단이 갈렸던 지점

**재활성화가 비밀번호를 새로 받는다.**
처음엔 옛 비밀번호를 그대로 두려 했다. 그런데 사용자는 방금 가입 화면에서
비밀번호를 입력했고 그게 자기 비밀번호가 될 거라고 생각한다. 옛것을 유지하면
바로 다음 로그인에서 틀린다. 새 구멍도 아니다 — **메일함을 쥔 사람은 이미
비밀번호 재설정(#6)으로 계정을 가져갈 수 있다.** 같은 권한이다.

**이름은 건드리지 않는다.**
가입 폼에 이름 칸이 있지만 재활성화는 옛 이름을 유지한다. 이력이 붙어 있는
것은 그 사람이지 그 이름이 아니고, 이름까지 새로 받으면 "되살린 것"보다
"새로 만든 것"에 가까워 보인다.

**새 행을 만들지 않는다는 것을 테스트가 직접 본다.**
"이력이 남아 있다"는 것을 평점·경고로 확인하려면 그 모델(#20·#25)이 있어야
하는데 아직 없다. 대신 **회원 id가 그대로인지**를 본다. id가 같으면 그 id를
참조하는 모든 이력이 그대로 붙어 있다는 뜻이다. 이게 지금 검증할 수 있는
가장 강한 형태다.

**가입 시도에 "재활성화하시겠습니까"를 알려주는 것은 정보 노출이 아니다.**
가입은 이미 이메일 인증을 마친 사람만 도달한다(#2). 메일함을 쥔 본인에게
자기 계정 상태를 알려주는 것이다.

**파기된 계정은 이 경로를 타지 않는다.**
#39가 4개월 뒤 행을 지우면 `findByEmail`이 `null`이라 그냥 신규 가입이 된다.
따로 분기할 것이 없다.

---

## 시나리오

### 비활성 계정 이메일로 가입 시도 (AC1)

- [ ] [예외] `signup` — should reject with AUTH_REACTIVATION_AVAILABLE when the email belongs to a deactivated account
- [ ] [정상] `signup` — should not create a new member when the email belongs to a deactivated account
- [ ] [경계] `signup` — should still reject with AUTH_EMAIL_ALREADY_EXISTS when the account is active
- [ ] [예외] `POST /auth/signup` — should return 409 with AUTH_REACTIVATION_AVAILABLE

### 재활성화 (AC2)

- [ ] [정상] `reactivate` — should clear deactivatedAt
- [ ] [정상] `reactivate` — should replace the password hash with the newly given password
- [ ] [정상] `POST /auth/reactivate` — should return 200 with the member
- [ ] [예외] `reactivate` — should reject with AUTH_EMAIL_NOT_VERIFIED when the email was not verified
- [ ] [경계] `reactivate` — should reject when the account is already active
- [ ] [경계] `reactivate` — should reject when no member has that email
- [ ] [경계] `reactivate` — should find the member case-insensitively when the email case differs

### 이력이 그대로 남는다 (AC3)

- [ ] [정상] `reactivate` — should keep the same member id instead of creating a new row
- [ ] [정상] `reactivate` — should keep the original name and createdAt
- [ ] [정상] `reactivate` — should let the member log in right after reactivation

**총 14개** (정상 7 / 경계 4 / 예외 3)

---

## AC 대조

| AC                                                   | 시나리오                     |
| ---------------------------------------------------- | ---------------------------- |
| 1 · 가입 시도 시 새 계정을 만들지 않고 재활성화 안내 | 가입 시도 4개                |
| 2 · 동의 + 인증 후 `deactivatedAt`이 지워지고 로그인 | 재활성화 7개 + 로그인 1개    |
| 3 · 탈퇴 전 이력이 그대로                            | 같은 id·이름·가입일 유지 2개 |

---

## 이번 범위 밖

| 것                  | 어디로            |
| ------------------- | ----------------- |
| 평점·경고 이력 자체 | #20 · #25         |
| 4개월 뒤 파기       | #39               |
| 재활성화 안내 화면  | 이 이슈의 웹 작업 |
