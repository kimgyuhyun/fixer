# 이슈 #29 — 결제를 취소하면 포인트가 회수된다

> 선행 #28 (충전) · 도메인 point-money · 크기 M
> 브랜치 `feat/point-money/issue-29` (base: `feat/point-money/issue-28`)

**환불은 잔액을 줄이는 일이 아니라 특정 카드 결제 건을 취소하는 일이다**
(`ADR-PAY-7`). 어느 `paymentId`에서 얼마를 빼는지가 정해져야 한다.

---

## 먼저 고칠 것 — #28이 ADR을 어겼다

`ADR-PAY-7`은 이렇게 정했다.

> lot 잔여 — 컬럼으로 두지 않고 **원장에서 계산**한다. 원장 행이
> `sourcePaymentId`를 참조한다

그런데 #28이 `Payment.refundedAmount` 컬럼을 만들었다. **숫자가 두 벌이 되어
어긋날 수 있고**, 어긋났을 때 어느 쪽이 맞는지 판단할 근거가 없다 —
`ADR-PAY-1`이 캐시를 두고 내린 것과 같은 판단이다.

이 이슈에서 그 컬럼을 지우고, ADR이 정한 대로 `refundableUntil`을 만든다.

```prisma
model Payment {
  refundedAmount Int      @default(0)   // ← 지운다
  /// 카드 취소 기한. 값은 지금 비워 둔다 — 실결제 전환 때 채운다 (ADR-PAY-7)
  refundableUntil DateTime?             // ← 만든다
}
```

**lot 잔여 = 그 `sourcePaymentId`를 가진 원장 행들의 합.** 충전이 `+50,000`,
환불이 `-20,000`이면 잔여는 30,000이다. 나중에 `HOLD`·`PAYOUT`이 같은 lot을
소진해도 같은 식이 그대로 맞는다.

---

## 시그니처

```ts
/** 한 lot에서 얼마를 뺐나. 환불 한 번이 lot 여러 개에 걸칠 수 있다 */
export interface RefundLot {
  paymentId: string;
  amount: number;
}

/**
 * 금액만큼 환불한다. **오래된 결제 건부터 소진한다** (ADR-PAY-7 FIFO).
 *
 * 카드 취소 기한이 오래된 건부터 먼저 만료되므로, 오래된 것을 먼저 쓰면
 * 취소 불가로 굳는 금액이 최소가 된다.
 */
refund(input: { userId: string; amount: number }): Promise<RefundResult>

/** 결제 건 하나를 통째로 취소한다. 두 번 불러도 한 번만 반영된다 */
cancelPayment(input: { userId: string; paymentId: string }): Promise<RefundResult>
```

```
POST /payments/:id/cancel  →  200  { refunded, balance, lots[] }
                           →  409  PAYMENT_INSUFFICIENT_BALANCE
                           →  403  PAYMENT_NOT_OWNED
                           →  404  PAYMENT_NOT_FOUND
POST /refunds              →  200  { refunded, balance, lots[] }
                           →  409  PAYMENT_INSUFFICIENT_BALANCE
```

---

## 판단이 갈렸던 지점

**잔액 부족은 "환불 금액 > 잔액"으로 본다.**
lot 잔여가 아니라 **원장 합계**다. 포인트를 이미 썼으면 그 돈은 우리 손을
떠났으므로 카드로 돌려줄 수 없다. lot에 남아 있는지를 먼저 보면 "lot에는
있는데 잔액에는 없는" 상태에서 통과해 잔액이 음수가 된다.

**멱등 키는 lot과 그 lot의 누적 환불액으로 만든다.**
`refund:{paymentId}:{누적}`이다. 같은 결제 건을 두 번 취소하면 두 번째는
같은 키가 나와 유니크 위반으로 막힌다 (AC3). 요청마다 새 키를 만들면
재시도가 두 번 빠져나간다.

**전액 취소도 FIFO 경로를 그대로 탄다.**
`cancelPayment`는 "그 lot의 잔여만큼 그 lot에서 뺀다"이고, 금액 환불은
"여러 lot에서 순서대로 뺀다"이다. 코드를 나누면 한쪽만 고쳐 잔액 검사가
빠지는 날이 온다 — #28에서 웹훅과 확정을 한 함수로 합친 것과 같은 이유다.

**PG 취소 호출은 이 이슈에 없다.**
`ADR-PAY-7`이 "환불 한 번에 카드 취소가 여러 번 나갈 수 있고, 중간에 하나가
실패하면 부분만 취소된 상태가 된다"고 이미 적었다. **원장은 lot별로 나눠
기록하므로 그 구조는 지금 만들어 둔다** — 실제 PG 호출만 실결제 전환 때
각 lot 뒤에 붙는다.

**기한이 지난 lot은 건너뛴다.**
`refundableUntil`이 지났으면 FIFO 순서에서 빼고 다음 lot으로 간다. 지금은
값이 비어 있어 아무것도 걸리지 않지만, 판정 자리를 지금 만들어 두지 않으면
실결제 전환 때 FIFO 루프를 다시 열어야 한다.

---

## 시나리오

### 쓰지 않은 포인트를 환불한다 (AC1)

- [ ] [정상] `cancelPayment` — should record a REFUND for the whole payment
- [ ] [정상] `cancelPayment` — should reduce the balance by the refunded amount
- [ ] [정상] `cancelPayment` — should mark the payment CANCELLED
- [ ] [정상] `cancelPayment` — should point the REFUND row at the payment it came from

### 잔액이 모자라면 막힌다 (AC2)

- [ ] [예외] `cancelPayment` — should reject with PAYMENT_INSUFFICIENT_BALANCE when the points were already spent
- [ ] [정상] `cancelPayment` — should record nothing when the balance is short
- [ ] [경계] `cancelPayment` — should allow a refund that leaves the balance exactly zero
- [ ] [예외] `cancelPayment` — should reject a payment that belongs to another member
- [ ] [예외] `cancelPayment` — should reject a payment that was never paid

### 두 번 취소해도 한 번 (AC3)

- [ ] [경계] `cancelPayment` — should record nothing more on the second cancel
- [ ] [경계] `cancelPayment` — should report the same balance on the second cancel
- [ ] [경계] `cancelPayment` — should say it was not applied on the second cancel

### 오래된 결제 건부터 소진한다 (ADR-PAY-7)

- [ ] [정상] `refund` — should take from the oldest payment first
- [ ] [정상] `refund` — should spread one refund across two lots when the first is not enough
- [ ] [경계] `refund` — should take only what is left in a partly refunded lot
- [ ] [경계] `refund` — should skip a lot whose refund deadline has passed
- [ ] [예외] `refund` — should reject when the amount is larger than the balance
- [ ] [경계] `refund` — should record one ledger row per lot so each card cancel is traceable

### lot 잔여는 원장에서 나온다 (ADR-PAY-7)

- [ ] [정상] `lotRemaining` — should report the charge minus every refund of that payment
- [ ] [경계] `lotRemaining` — should report zero for a fully refunded payment

### 진짜 Postgres에서

- [ ] [경계] `통합` — should refund only once when the same cancel arrives twice at once
- [ ] [정상] `통합` — should leave the ledger sum matching the remaining lots

**총 23개** (정상 10 / 경계 9 / 예외 4)

---

## AC 대조

| AC                            | 시나리오                |
| ----------------------------- | ----------------------- |
| 1 · 취소하면 REFUND·잔액 감소 | 환불 4개                |
| 2 · 잔액 부족이면 막힌다      | 부족 5개                |
| 3 · 두 번이면 한 번           | 멱등 3개 + 통합 1개     |
| (ADR-PAY-7) FIFO·부분환불     | FIFO 6개 + lot 잔여 2개 |

---

## 이번 범위 밖

| 것                       | 어디로                                      |
| ------------------------ | ------------------------------------------- |
| 실제 카드 취소 API 호출  | 실결제 전환. 구조는 이 이슈가 만든다        |
| `refundableUntil` 채우기 | 실결제 전환. 컬럼과 판정 자리만 지금 만든다 |
| `HOLD`·`PAYOUT`의 FIFO   | #16 이후. 같은 lot 잔여 계산을 그대로 쓴다  |
