# 이슈 #27 — 포인트 원장 코어

> 선행 없음 · 도메인 point-money · 크기 L · **A+B 페어 이슈**
> 브랜치 `feat/point-money/issue-27` (base: `main`)

원장 쓰기·잔액 계산·멱등성만 만든다. **화면이 없다.** 통합 테스트 결과가 데모다.

---

## ⚠️ 페어로 하기로 한 이슈다

이슈 본문의 요구:

> **이 이슈만 페어로 한다.** 원장 유형 7개 중 5개를 B가, 2개를 A가 부른다.
> 한 사람만 알면 이후 모든 돈 관련 버그가 그 사람에게 몰린다.

**이번 구현은 A 혼자 했다.** 그 취지를 지키지 못했으므로, 김규현이 이 코드를
읽고 원장 유형별로 무엇이 어떻게 되는지 확인하는 절차가 필요하다. PR에도 적었다.

---

## 시그니처

### 데이터 (`ADR-PAY-1`·`ADR-PAY-3`·`ADR-PAY-7`)

```prisma
/// 포인트 증감 내역. 잔액은 이 표의 합이다 (spec-fixed §6.1).
model PointTransaction {
  id             String   @id @default(cuid())
  userId         String
  type           PointTransactionType
  /// 부호까지 담는다. HOLD는 음수, RELEASE는 양수.
  amount         Int
  /// 웹훅 중복 수신 방어. DB 제약이 최후 방어선이다 (ADR-PAY-3).
  idempotencyKey String   @unique
  /// 어느 결제 건에서 나왔나. FIFO 소진과 환불 대상 선택에 쓴다 (ADR-PAY-7).
  sourcePaymentId String?
  /// 무엇 때문에 생긴 행인가 (공고 id, 환전 요청 id 등). 추적용.
  referenceId    String?
  createdAt      DateTime @default(now())

  @@index([userId, createdAt])
  @@index([sourcePaymentId])
}

enum PointTransactionType {
  CHARGE
  HOLD
  RELEASE
  PAYOUT
  EXCHANGE_REQUEST
  EXCHANGE_REVERT
  REFUND
}
```

`User`에 `cachedBalance Int @default(0)` 추가. **표시용이다** (`ADR-PAY-1`).

### 서버

```ts
export interface PointLedgerStore {
  /**
   * 원장 행 하나를 쓰고 캐시를 함께 갱신한다.
   *
   * **잔액 검증까지 한 문장으로 한다** (ADR-PAY-2) — 읽고 쓰는 사이의 틈으로
   * 동시 요청 두 개가 모두 통과하는 것을 막는다.
   *
   * 이미 있는 `idempotencyKey`면 아무것도 안 쓰고 `null`을 돌려준다.
   */
  append(entry: LedgerEntry): Promise<PointTransactionRecord | null>;
  /** 원장 합계. **금전 판정은 항상 이걸로 한다** (ADR-PAY-1) */
  sumBalance(userId: string): Promise<number>;
  /** 표시용 캐시 */
  readCachedBalance(userId: string): Promise<number>;
}

/** 원장에 한 줄 쓴다. 잔액이 모자라면 POINT_INSUFFICIENT_BALANCE로 거절 */
record(entry: LedgerEntry): Promise<PointTransactionRecord>

/** 잔액. 진실의 원천은 원장이다 */
balanceOf(userId: string): Promise<number>
```

---

## 판단이 갈렸던 지점

**잔액 검증을 조건부 UPDATE 한 문장으로 한다** (`ADR-PAY-2`).
`SELECT`로 읽고 `INSERT`하면 그 사이에 다른 요청이 끼어든다. §4.4가 정원 초과에
쓴 것과 같은 패턴이고, 새 패턴을 도입하지 않는다.

**멱등은 DB 유니크 제약이 최후 방어선이다** (`ADR-PAY-3`).
먼저 조회해서 있으면 건너뛰는 방식은 조회와 삽입 사이에 틈이 있다. 삽입을
시도하고 **유니크 위반(P2002)을 "이미 처리됨"으로 해석**한다.

**부호를 `amount`에 담는다.**
`HOLD`가 −6000이면 합계가 곧 잔액이다. 타입별로 부호를 다시 계산하면 그 계산이
여러 곳에 흩어지고, 한 곳만 틀려도 잔액이 어긋난다.

**`PAYOUT`은 한 행이 아니라 두 행이다.**
사양 §6.1의 부호가 `−(구인자) / +(구직자)`라 한 행으로 보이지만, `userId`가
달라 한 행에 담을 수 없다. **같은 `referenceId`로 묶인 두 행**으로 쓰고, 둘이
같은 트랜잭션에서 함께 커밋된다.

---

## 시나리오

### 잔액 계산 (AC1·AC6)

- [x] [정상] `record` — should make the balance 10000 after CHARGE 10000
- [x] [정상] `balanceOf` — should return zero for a member with no ledger rows
- [x] [정상] `record` — should keep the cached balance equal to the ledger sum
- [x] [경계] `balanceOf` — should sum many rows of mixed types correctly

### 잔액 부족 (AC2)

- [x] [예외] `record` — should reject HOLD 12000 with POINT_INSUFFICIENT_BALANCE when the balance is 10000
- [x] [예외] `record` — should leave nothing in the ledger when it rejected
- [x] [경계] `record` — should allow spending exactly the whole balance
- [x] [경계] `record` — should reject spending one point more than the balance

### 입력 검증

- [x] [경계] `record` — should reject a zero amount
- [x] [경계] `record` — should reject a fractional amount

### 잠금과 반환 (AC3)

- [x] [정상] `record` — should bring the balance back after HOLD 6000 then RELEASE 6000
- [x] [정상] `record` — should allow a second HOLD after the first was released

### 멱등 (AC4)

- [x] [정상] `record` — should write only one row for the same idempotencyKey
- [x] [정상] `record` — should return the existing row when the key was already used
- [x] [경계] `record` — should not change the balance on the duplicate write

### 동시성 (AC5) — 통합 테스트

- [x] [통합] `record` — should never let the balance go negative when CHARGE and HOLD race
- [x] [통합] `record` — should let exactly one of two concurrent HOLDs succeed when only one fits
- [x] [통합] `record` — should keep the cached balance equal to the ledger sum after a race

### 실제 DB (AC4·AC6) — 통합 테스트

- [x] [통합] `append` — should reject a duplicate idempotencyKey at the database level
- [x] [통합] `sumBalance` — should match the cached balance after many writes
- [x] [통합] `append` — should not change the balance when a duplicate is rejected
- [x] [통합] `append` — should leave nothing in the ledger when the balance is short
- [x] [통합] `append` — should allow spending exactly the whole balance

**총 22개** (정상 8 / 경계 6 / 예외 2 / 통합 7 — 일부 중복 집계 없음)

---

## AC 대조

| #   | AC                                             | 커버하는 시나리오                                                                                             |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `CHARGE 10000` 후 잔액 10000                   | `record — balance 10000 after CHARGE` · `balanceOf — zero for no rows` · `— mixed types`                      |
| 2   | `HOLD 12000` 거절 + 원장에 아무것도 안 남음    | `record — reject HOLD 12000` · `— leave nothing` · `— exactly the whole balance` · `— one point more`         |
| 3   | `HOLD 6000` 후 `RELEASE 6000` → 잔액 10000     | `record — bring the balance back` · `— second HOLD after release`                                             |
| 4   | 같은 `idempotencyKey` 두 번 → 한 건만          | `record` 3건 · `[통합] append — duplicate key at the database level`                                          |
| 5   | 동시 `CHARGE`·`HOLD` → 잔액이 음수가 되지 않음 | `[통합]` 3건                                                                                                  |
| 6   | 캐시 잔액과 원장 합계가 일치                   | `record — cached equals ledger sum` · `[통합] sumBalance — match after many writes` · `[통합] — after a race` |

**커버리지: AC 6개 전부 커버 / 시나리오 22개 / 미커버 0개**

---

## 이번 범위 밖

| 항목                     | 어디서                                           |
| ------------------------ | ------------------------------------------------ |
| 결제창·충전 화면         | #28                                              |
| 환불 FIFO 소진 실제 구현 | #29. 이 이슈는 `sourcePaymentId` 자리만 만든다   |
| 환전 요청·승인           | #31·#34 (B 몫)                                   |
| 캐시-원장 대조 배치      | `ADR-PAY-1`이 정했으나 운영 도구다. #39에 얹는다 |
| 화면 전부                | **이 이슈에는 화면이 없다** (수직 슬라이스 예외) |
