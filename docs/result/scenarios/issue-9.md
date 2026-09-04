# 이슈 #9 — 탈퇴한다 (보류 조건 판정)

> 선행 #4 (로그인) · #27 (원장) · 도메인 auth-member · 크기 M
> 브랜치 `feat/auth-member/issue-9` (base: `feat/auth-member/issue-6` + `feat/point-money/issue-27` 병합)

**물리 삭제하지 않는다.** 소프트 삭제로 비활성화한다 (`spec-fixed.md` §2.6).

---

## 시그니처

### 데이터

`ADR-AUTH-3`대로 **상태 컬럼을 만들지 않는다.** `User.deactivatedAt` 하나로 판정한다.

```prisma
model User {
  deactivatedAt DateTime?   // ← 추가. null이면 활성
}
```

### 서버

```ts
/**
 * 탈퇴 보류 조건. **다른 도메인에 묻는다.**
 *
 * 진행 중 계약(#17)과 본인 공고(#12)는 아직 모델이 없다. 포트를 지금 만들고
 * 구현체는 항상 `false`를 돌려주다가, 그 이슈가 들어오면 진짜로 센다.
 */
export interface WithdrawalGuard {
  hasActiveContract(userId: string): Promise<boolean>;
  hasOpenJobPost(userId: string): Promise<boolean>;
}

/**
 * 탈퇴한다. 보류 조건에 걸리면 거절한다.
 *
 * 성공하면 `deactivatedAt`을 찍고 **그 회원의 Refresh 토큰을 전부 지운다** (§2.6).
 */
withdraw(userId: string, now: Date): Promise<void>
```

```
POST /auth/withdraw   →  204
                      →  409 AUTH_WITHDRAWAL_BLOCKED  (보류 조건, reason 포함)
```

로그인이 비활성화 계정을 막는다 (`login.service.ts` 확장):

```
POST /auth/login  →  403 AUTH_ACCOUNT_DEACTIVATED
```

---

## 판단이 갈렸던 지점

**보류 조건을 포트 뒤에 둔다.**
AC4·AC5가 참조하는 `Application`(#17)과 `JobPost`(#12) 모델이 아직 없다. 포트를
지금 만들고 구현체는 `false`를 돌려준다 — **판정 로직과 AC는 지금 검증할 수 있고**,
그 이슈가 들어오면 어댑터만 채운다. 모델이 생길 때까지 기다리면 #9가 A 몫의
끝까지 밀린다.

**잔액 검사는 원장 합계로 한다.**
`cachedBalance`가 아니다. `ADR-PAY-1`대로 금전 판정은 원장을 합산한다 — 캐시가
틀렸는데 잔액이 0인 줄 알고 탈퇴시키면 돈이 묶인 채 계정이 잠긴다.

**보류 사유를 응답에 담는다.**
셋 중 무엇에 걸렸는지 알려주지 않으면 사용자가 무엇을 해야 하는지 모른다.
가입 여부처럼 감출 정보가 아니다 — 본인 계정의 상태다.

**비활성화 계정 로그인은 403이지 401이 아니다.**
비밀번호는 맞았다. 401을 주면 사용자가 비밀번호를 다시 입력한다.

---

## 시나리오

### 탈퇴 성공 (AC1)

- [ ] [정상] `withdraw` — should stamp deactivatedAt
- [ ] [정상] `withdraw` — should delete every refresh token of that member
- [ ] [정상] `POST /auth/withdraw` — should return 204

### 잔액이 남으면 막힌다 (AC3)

- [ ] [예외] `withdraw` — should reject with AUTH_WITHDRAWAL_BLOCKED when the balance is positive
- [ ] [예외] `withdraw` — should say 남은 포인트를 환전한 뒤 as the reason
- [ ] [경계] `withdraw` — should allow withdrawing when the balance is exactly zero
- [ ] [정상] `withdraw` — should check the ledger sum, not the cached balance

### 진행 중 계약이 있으면 막힌다 (AC4)

- [ ] [예외] `withdraw` — should reject when an active contract exists
- [ ] [예외] `withdraw` — should say 진행 중인 일거리 as the reason

### 본인 공고가 있으면 막힌다 (AC5)

- [ ] [예외] `withdraw` — should reject when an open job post exists
- [ ] [예외] `withdraw` — should say 등록한 공고를 마감한 뒤 as the reason

### 여러 조건에 걸릴 때

- [ ] [경계] `withdraw` — should report every blocking reason, not just the first
- [ ] [정상] `withdraw` — should not touch the member when it rejected

### 비활성화 계정은 로그인 못 한다 (AC2)

- [ ] [예외] `login` — should reject a deactivated account with AUTH_ACCOUNT_DEACTIVATED
- [ ] [경계] `login` — should reject before checking the password
- [ ] [예외] `POST /auth/login` — should return 403 for a deactivated account
- [ ] [예외] `POST /auth/withdraw` — should return 409 with the reasons

**총 17개** (정상 6 / 경계 4 / 예외 7)

---

## AC 대조

| #   | AC                                                    | 커버하는 시나리오                                                                |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | 탈퇴하면 `deactivatedAt`이 찍히고 Refresh가 모두 삭제 | `withdraw — stamp deactivatedAt` · `— delete every refresh token` · `POST — 204` |
| 2   | 비활성화 계정은 `AUTH_ACCOUNT_DEACTIVATED`로 막힌다   | `login` 2건 · `POST /auth/login — 403`                                           |
| 3   | 포인트 잔액이 남으면 막히고 환전 안내                 | `withdraw` 4건                                                                   |
| 4   | `ACCEPTED` 신청이 있으면 막히고 일거리 안내           | `withdraw` 2건                                                                   |
| 5   | `OPEN` 공고가 있으면 막히고 공고 마감 안내            | `withdraw` 2건 · `POST /auth/withdraw — 409`                                     |

**커버리지: AC 5개 전부 커버 / 시나리오 17개 / 미커버 0개**

---

## 이번 범위 밖

| 항목                              | 어디서                                               |
| --------------------------------- | ---------------------------------------------------- |
| 재활성화                          | #10                                                  |
| 개인정보 마스킹·파기              | #39 (비활성화 후 4개월 배치)                         |
| `Application`·`JobPost` 실제 조회 | #17·#12. **포트만 만들고 구현체는 false를 돌려준다** |
| 탈퇴 화면                         | AC에 없다. API까지만                                 |
