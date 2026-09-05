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

**인증은 "언젠가"가 아니라 "지금"이어야 한다.**
처음엔 가입이 쓰는 `isVerified`를 그대로 썼다. `ac-verifier`가 잡았다 — 그건
"언젠가 인증한 적 있다"라서 **최초 가입 때 남은 행 하나로 영구히 참**이 된다.
되살리기는 기존 계정에 새 비밀번호를 심는 작업이므로, 그 조건이면 **이메일
주소만 아는 사람이 남의 탈퇴 계정을 가져간다.** 그래서 30분 안에 소비된
인증만 인정하는 포트를 따로 뒀다. 30분은 비밀번호 재설정 토큰(#6)과 같은
값이다 — 두 경로가 주는 권한이 같으므로 유효 시간도 같아야 하고, 한쪽만
길면 공격자는 긴 쪽으로 온다.

"탈퇴 시각 이후"로 잡을 수도 있었지만 그러려면 회원을 먼저 조회해야 하고,
그러면 인증하지 않은 사람에게 **그 계정이 탈퇴 상태라는 것**이 새어나간다.

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

- [x] [예외] `signup` — should reject with AUTH_REACTIVATION_AVAILABLE when the email belongs to a deactivated account
- [x] [정상] `signup` — should not create a new member when the email belongs to a deactivated account
- [x] [경계] `signup` — should still throw MEMBER_EMAIL_ALREADY_EXISTS when the account is active
- [x] [예외] `POST /auth/signup` — should return 409 with AUTH_REACTIVATION_AVAILABLE for a deactivated account

### 재활성화 (AC2)

- [x] [정상] `reactivate` — should clear deactivatedAt
- [x] [정상] `reactivate` — should replace the password hash with the newly given password
- [x] [정상] `POST /auth/reactivate` — should return 200 with the member
- [x] [예외] `POST /auth/reactivate` — should return 403 when the email was not verified
- [x] [예외] `POST /auth/reactivate` — should return 404 when there is nothing to revive
- [x] [경계] `POST /auth/reactivate` — should return 400 when the password does not meet the rules
- [x] [예외] `reactivate` — should reject with AUTH_EMAIL_NOT_VERIFIED when the email was not verified
- [x] [보안] `reactivate` — should reject an email verified before the window instead of accepting an old record
- [x] [경계] `reactivate` — should accept an email verified just inside the window
- [x] [보안] `reactivate` — should not reveal that the account is deactivated to someone who did not verify
- [x] [경계] `reactivate` — should reject when the account is already active
- [x] [경계] `reactivate` — should reject when no member has that email
- [x] [경계] `reactivate` — should find the member case-insensitively when the email case differs

### 이력이 그대로 남는다 (AC3)

- [x] [정상] `reactivate` — should keep the same member id instead of creating a new row
- [x] [정상] `reactivate` — should keep the original name and createdAt

### 화면 (AC1 · AC2)

- [x] [정상] `가입 화면` — should ask whether to reactivate instead of showing a plain error
- [x] [정상] `가입 화면` — should send the newly typed password to /api/auth/reactivate when confirmed
- [x] [정상] `가입 화면` — should show the completion screen after reactivating
- [x] [경계] `가입 화면` — should go back to the form when cancelled
- [x] [경계] `가입 화면` — should still show a plain error for an active duplicate email
- [x] [정상] `login` — should let an active account log in as before (#9이 쓴 테스트가 그대로 이 AC를 덮는다. `deactivatedAt`이 `null`이면 통과다)

**총 27개** (정상 12 / 경계 9 / 예외 4 / 보안 2) — 시나리오 14개 + 컨트롤러·화면에서 늘어난 10개

### 서버를 띄워 확인한 것

단위 테스트는 가짜 저장소를 쓰므로 "같은 행을 되살린다"가 진짜인지는
실물로 봐야 한다. 개발 DB에 탈퇴 상태 회원을 하나 두고 확인했다.

| 무엇             | 결과                                                         |
| ---------------- | ------------------------------------------------------------ |
| 가입 시도        | `409 AUTH_REACTIVATION_AVAILABLE`, **User 행 수는 1 그대로** |
| 재활성화         | `200`, id·이름·가입일이 전부 이전 값                         |
| 되살린 뒤 로그인 | `200` (새로 입력한 비밀번호로)                               |
| 이미 활성인데 또 | `404 AUTH_MEMBER_NOT_DEACTIVATED`                            |

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
