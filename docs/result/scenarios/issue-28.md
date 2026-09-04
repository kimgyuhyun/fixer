# 이슈 #28 — 포인트를 충전한다

> 선행 #27 (원장) · 도메인 point-money · 크기 L
> 브랜치 `feat/point-money/issue-28` (base: `feat/auth-member/issue-39`)

**클라이언트가 준 금액을 믿지 않는다.** 서버가 포트원 API로 결제 건을 다시
조회해 대조한다(`spec-fixed.md` §6.3). 믿으면 브라우저에서 금액만 바꿔
보내는 것으로 잔액을 만들어낼 수 있다.

---

## 시그니처

### 데이터

`Payment` 모델을 새로 만든다. 원장만으로는 **어느 결제 건이 얼마 남았는지**를
알 수 없는데, `ADR-PAY-7`의 FIFO 환불이 그 값을 필요로 한다(#29).

```prisma
model Payment {
  /// 포트원이 준 결제 건 식별자. 우리가 만들지 않는다 (ADR-PAY-3)
  id             String   @id
  userId         String
  amount         Int
  /// 이 건에서 환불된 누계. 부분 환불이 여러 번 올 수 있다 (ADR-PAY-7)
  refundedAmount Int      @default(0)
  status         PaymentStatus
  createdAt      DateTime @default(now())
}

enum PaymentStatus { PAID CANCELLED }
```

### 서버

```ts
/**
 * 포트원. **테스트 모드와 실결제는 이 포트 뒤에서만 다르다** (ADR-PAY-5).
 *
 * 개발 중에는 결제창을 띄울 수 없으므로 가짜 구현체를 꽂는다.
 */
export interface PaymentGateway {
  /** 결제 건을 다시 조회한다. 없으면 null */
  find(paymentId: string): Promise<GatewayPayment | null>;
}

export interface GatewayPayment {
  id: string;
  /** 원 단위. 포트원이 준 값이 진실이다 */
  amount: number;
  status: 'PAID' | 'CANCELLED' | 'PENDING' | 'FAILED';
  currency: string;
}

/** 웹훅 서명. 위조된 요청으로 잔액을 만들 수 없어야 한다 */
export interface WebhookVerifier {
  verify(rawBody: string, headers: Record<string, string | undefined>): boolean;
}

/** 결제 건을 확정하고 CHARGE를 기록한다. **두 번 불러도 한 건이다** */
confirm(input: { userId: string; paymentId: string }): Promise<ChargeResult>
```

```
POST /payments/confirm   →  200  { balance, charged }
                         →  409  PAYMENT_AMOUNT_MISMATCH
                         →  409  PAYMENT_NOT_PAID
                         →  404  PAYMENT_NOT_FOUND
POST /payments/webhook   →  200  (중복이어도 200. 아니면 포트원이 계속 재전송한다)
                         →  401  WEBHOOK_SIGNATURE_INVALID
GET  /points/me          →  200  { balance, transactions[] }
```

---

## 판단이 갈렸던 지점

**금액 대조는 "우리가 기대한 값"이 아니라 "결제창에 넘긴 값"과 한다.**
클라이언트가 `expectedAmount`를 같이 보내면 그 값도 조작 대상이다. 그래서
**결제 시작 시점에 서버가 `Payment` 행을 먼저 만들어 금액을 박아 두고**,
확정 때 그 값과 포트원이 준 값을 대조한다. 클라이언트는 `paymentId`만
보낸다 — 조작할 수 있는 값이 없다.

**멱등 키는 포트원의 `paymentId`에서 만든다.**
`charge:{paymentId}`다. 우리가 만들면 재전송 때 같은 키가 나오는 것을
보장할 수 없다 (ADR-PAY-3). 유니크 위반은 오류가 아니라 **이미 처리됨**이다.

**웹훅과 확정 API가 같은 경로를 탄다.**
둘 다 "포트원에 다시 물어보고 원장에 쓴다"이다. 코드를 나누면 한쪽만 고쳐
금액 대조가 빠지는 날이 온다. 어느 쪽이 먼저 오든 결과가 같아야 한다는 것이
이 이슈의 핵심이라, **같은 함수를 두 입구가 부른다.**

**`PENDING`은 실패가 아니라 아직이다.**
`PAID`가 아니면 전부 거절하되, 코드를 나눠 화면이 "결제가 진행 중입니다"와
"결제가 실패했습니다"를 다르게 말할 수 있게 한다.

**개발용 게이트웨이를 만든다.**
포트원 테스트 모드조차 채널키가 있어야 결제창이 뜬다. `ConsoleMailProvider`와
같은 방식으로 `FakePaymentGateway`를 두고 환경변수로 바꿔 끼운다 (ADR-PAY-5).
**가짜는 요청한 금액을 그대로 `PAID`로 돌려준다** — 이 이슈가 검증하려는 것은
포트원의 동작이 아니라 우리 쪽 대조·멱등이다.

---

## 시나리오

### 결제 시작 (AC1)

- [x] [정상] `start` — should create a pending payment row with the amount the server decided
- [x] [경계] `start` — should reject an amount that is not a multiple of the charge unit
- [x] [경계] `start` — should reject an amount over the per-charge limit
- [x] [정상] `start` — should return a paymentId the client can open the checkout with

### 금액을 서버가 다시 확인한다 (AC2)

- [x] [정상] `confirm` — should ask the gateway for the payment instead of trusting the client
- [x] [정상] `confirm` — should record a CHARGE for the amount both sides agree on
- [x] [정상] `confirm` — should report the balance as the ledger sum
- [x] [정상] `confirm` — should mark the payment row PAID

### 금액이 다르면 거절한다 (AC3)

- [x] [예외] `confirm` — should reject with PAYMENT_AMOUNT_MISMATCH when the gateway amount differs
- [x] [정상] `confirm` — should not record anything when the amount differs
- [x] [예외] `confirm` — should reject with PAYMENT_NOT_PAID when the gateway says PENDING
- [x] [예외] `confirm` — should reject a FAILED payment too
- [x] [예외] `confirm` — should reject with PAYMENT_NOT_FOUND when the gateway knows no such payment
- [x] [경계] `confirm` — should reject a payment that belongs to another member

### 웹훅이 두 번 와도 한 건 (AC4)

- [x] [정상] `handleWebhook` — should record a CHARGE on the first delivery
- [x] [경계] `handleWebhook` — should record nothing more on the second delivery
- [x] [경계] `handleWebhook` — should succeed on the second delivery instead of failing
- [x] [예외] `handleWebhook` — should reject a body whose signature does not verify
- [x] [보안] `verify` — should reject a body signed with a different secret
- [x] [보안] `verify` — should reject when the body was changed after signing
- [x] [경계] `verify` — should reject a signature of a different length without throwing
- [x] [보안] `verify` — should refuse to start without a secret
- [x] [보안] `handleWebhook` — should ignore the amount written in the webhook body and ask the gateway
- [x] [경계] `handleWebhook` — should reject a body that carries no paymentId
- [x] [정상] `handleWebhook` — should record nothing when the signature is invalid
- [x] [경계] `confirm` + `handleWebhook` — should record one CHARGE when the confirm API and the webhook both arrive

### 내역에서 보인다 (AC5)

- [x] [정상] `readHistory` — should list the charge with its amount and time
- [x] [정상] `readHistory` — should report the balance as the ledger sum, not the cached value
- [x] [경계] `readHistory` — should list nothing for a member who never charged

### 진짜 Postgres에서

- [x] [경계] `통합` — should record exactly one CHARGE when the same webhook arrives twice at once
- [x] [경계] `통합` — should report applied exactly once across concurrent deliveries
- [x] [정상] `통합` — should leave the balance equal to the charged amount
- [x] [예외] `통합` — should not charge when the gateway reports a different amount
- [x] [정상] `통합` — should keep the payment row so a refund can find it later (#29가 쓴다)

### 화면

- [x] [정상] `포인트 화면` — should show the balance the server reported
- [x] [정상] `포인트 화면` — should list a charge with a readable label instead of the raw code
- [x] [경계] `포인트 화면` — should say there is nothing yet for a member who never charged
- [x] [경계] `포인트 화면` — should not let a charge start before a member is chosen
- [x] [정상] `포인트 화면` — should start and confirm the payment the server created
- [x] [예외] `포인트 화면` — should show the server message when the amount did not match

**총 40개** (단위 25 + 통합 5 + 화면 6 + 상수·서명 4)

### 서버를 띄워 확인한 것

| 무엇                   | 결과                                    |
| ---------------------- | --------------------------------------- |
| 결제 시작 → 확정       | `200`, 잔액 50,000                      |
| 같은 건 두 번째 확정   | `200` `applied:false`, 잔액 그대로      |
| 서명이 맞는 웹훅       | `200`, 잔액 두 배가 되지 않음           |
| 서명이 틀린 웹훅       | `401 PAYMENT_WEBHOOK_SIGNATURE_INVALID` |
| 1,500원 충전 시도      | `400 PAYMENT_INVALID_AMOUNT`            |
| 남의 결제 건 확정 시도 | `403 PAYMENT_NOT_OWNED`                 |

서명 검증은 **본문 문자열 원본**을 대상으로 하므로 `main.ts`에서
`rawBody: true`를 켜야 한다. 파싱한 뒤 다시 직렬화하면 키 순서나 공백이
달라져 맞지 않는다 — 실물로 확인한 것이 이 부분이다.

---

## AC 대조

| AC                          | 시나리오          |
| --------------------------- | ----------------- |
| 1 · 결제창이 뜬다           | 결제 시작 3개     |
| 2 · 서버가 금액 재조회 대조 | 재확인 3개        |
| 3 · 금액이 다르면 거절      | 거절 5개          |
| 4 · 웹훅 두 번이면 한 건    | 웹훅 6개 + 통합 1 |
| 5 · 내역에 보인다           | 내역 3개          |

---

## 이번 범위 밖

| 것                 | 어디로                              |
| ------------------ | ----------------------------------- |
| 결제 취소·환불     | #29                                 |
| 실제 포트원 채널키 | 실결제 전환. 지금은 가짜 게이트웨이 |
| 공고 예산 HOLD     | #16 이후                            |
