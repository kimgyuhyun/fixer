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

**비활성화 검사는 비밀번호 대조 _뒤에_ 한다.**
처음엔 앞에 두려 했는데 그러면 구멍이 생긴다 — 남의 이메일에 아무 비밀번호나
넣어도 "비활성화된 계정"이 나와서 **그 계정이 존재한다는 것과 비활성 상태라는
것이 함께 새어나간다.** #4에서 응답 시간으로 새던 것과 같은 종류다.
비밀번호가 맞은 사람에게만 알려준다 — 그건 본인 계정이다.

---

## 시나리오

### 탈퇴 성공 (AC1)

- [x] [정상] `withdraw` — should stamp deactivatedAt
- [x] [정상] `withdraw` — should delete every refresh token of that member
- [x] [정상] `POST /auth/withdraw` — should return 204

### 잔액이 남으면 막힌다 (AC3)

- [x] [예외] `withdraw` — should reject with AUTH_WITHDRAWAL_BLOCKED when the balance is positive
- [x] [예외] `withdraw` — should say 남은 포인트를 환전한 뒤 as the reason
- [x] [경계] `withdraw` — should allow withdrawing when the balance is exactly zero
- [x] [정상] `withdraw` — should check the ledger sum, not the cached balance

### 진행 중 계약이 있으면 막힌다 (AC4)

- [x] [예외] `withdraw` — should reject when an active contract exists
- [x] [예외] `withdraw` — should say 진행 중인 일거리 as the reason

### 본인 공고가 있으면 막힌다 (AC5)

- [x] [예외] `withdraw` — should reject when an open job post exists
- [x] [예외] `withdraw` — should say 등록한 공고를 마감한 뒤 as the reason

### 여러 조건에 걸릴 때

- [x] [경계] `withdraw` — should report every blocking reason, not just the first
- [x] [정상] `withdraw` — should not touch the member when it rejected

### 비활성화 계정은 로그인 못 한다 (AC2)

- [x] [예외] `login` — should reject a deactivated account with AUTH_ACCOUNT_DEACTIVATED
- [x] [경계] `login` — should not reveal deactivation to someone with the wrong password
- [x] [예외] `POST /auth/login` — should return 403 for a deactivated account
- [x] [예외] `POST /auth/withdraw` — should return 409 with every blocking reason

### 회원이 그 상태가 아닐 때 (구현 중 발견)

시나리오를 쓸 때 놓쳤다. 실제로 서버를 띄워 없는 id로 호출했더니 Prisma가
`P2025`로 터져 **500**이 나갔다 — 사용자 잘못인데 서버 고장처럼 보인다.

- [x] [예외] `withdraw` — should reject with AUTH_MEMBER_NOT_FOUND when the member does not exist
- [x] [경계] `withdraw` — should not re-stamp deactivatedAt when the member already withdrew
- [x] [예외] `POST /auth/withdraw` — should return 404, not 500
- [x] [예외] `POST /auth/withdraw` — should return 400 when userId is missing

두 번째가 특히 중요하다. 이미 탈퇴한 계정에 다시 찍으면 **파기 기한(#39,
비활성 4개월)이 그만큼 미뤄져** 개인정보가 더 오래 남는다.

**총 21개** (정상 6 / 경계 5 / 예외 10) — 처음 17개 + 구현 중 4개

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

---

## 넘겨야 할 숙제 — AC4·AC5는 아직 배선이 비어 있다

`ac-verifier` 판정: AC1·AC2·AC3 충족, **AC4·AC5는 부분 충족**.

판정 로직은 맞다. `WithdrawalGuard`가 `true`를 주면 정확히 막고 사유도 옳다.
비어 있는 것은 **배선**이다 — `auth.module.ts`의 구현체가 아직 항상 `false`를
돌려준다. `Application`(#17)과 `JobPost`(#12) 모델이 없어서 그렇다.

그래서 **오늘 배포된 시스템에서는 진행 중 계약이나 열린 공고가 있어도
탈퇴가 막히지 않는다.** 이건 #9의 결함이 아니라 순서 문제이고, #12·#17이
들어오는 시점에 반드시 채워야 한다. 그때 다음을 추가한다.

- [ ] [통합] `PrismaWithdrawalGuard.hasOpenJobPost` — `OPEN` 공고를 가진 회원의 탈퇴가 실제로 막히는가 (**#12**)
- [ ] [통합] `PrismaWithdrawalGuard.hasActiveContract` — `ACCEPTED` 신청을 가진 회원의 탈퇴가 실제로 막히는가 (**#17**)
- [ ] [회귀] `auth.module.ts` — 두 이슈가 들어온 뒤에도 `false` 고정 구현체가 남아 있지 않은가

세 번째가 실제 위험이다. 임시 구현체는 조용히 통과하므로, 지우는 것을
잊어도 아무 테스트도 빨개지지 않는다.
