# 이슈 #31 — 환전을 요청한다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/31
> PRD: `docs/result/prd/point-money.md`
> 담당: A 최동훈
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 시그니처

### 관련 ADR

| 결정                   | 이 시그니처에 미치는 영향                                                 |
| ---------------------- | ------------------------------------------------------------------------- |
| `spec-fixed.md` §6.4.1 | 최소 5,000원 · 10원 단위 · `PAYOUT` 후 7일. 상수 3개로 박는다             |
| `ADR-PAY-1`            | 성숙액 판정은 `cachedBalance`가 아니라 **원장 합산**이다                  |
| `ADR-PAY-2`            | 잔액 검증은 조건부 UPDATE 한 문장. 행 잠금·직렬화 격리를 따로 쓰지 않는다 |
| `ADR-PAY-4`            | 요청 행과 원장 행이 **한 트랜잭션**이다. 보상 트랜잭션을 두지 않는다      |
| `spec-fixed.md` §6.1   | 부호는 `amount`에 담는다. `EXCHANGE_REQUEST`는 `amount: -10000`으로 쓴다  |

### 타입

```typescript
// packages/shared/src/exchange.ts (신규)

/** 환전 최소 금액 (§6.4.1) */
export const EXCHANGE_MIN_AMOUNT = 5_000;
/** 환전 금액 단위 (§6.4.1) */
export const EXCHANGE_AMOUNT_UNIT = 10;
/** 지급받은 뒤 환전 가능해지기까지 (§6.4.1) */
export const EXCHANGE_MATURITY_DAYS = 7;

/** 환전 요청 상태 (§6.4.1). 이 이슈가 만드는 것은 `REQUESTED`까지다 */
export const EXCHANGE_REQUEST_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'COMPLETED',
  'REJECTED',
] as const;
export type ExchangeRequestStatus = (typeof EXCHANGE_REQUEST_STATUSES)[number];

export const EXCHANGE_ERRORS = {
  /** 5,000원 미만 */
  BELOW_MIN_AMOUNT: 'EXCHANGE_BELOW_MIN_AMOUNT',
  /** 10원 단위가 아니다 */
  INVALID_UNIT: 'EXCHANGE_INVALID_UNIT',
  /** 지급받은 지 7일이 안 된 포인트다 */
  NOT_MATURED: 'EXCHANGE_NOT_MATURED',
  /** 계좌가 검증되지 않았거나 등록조차 안 됐다 */
  ACCOUNT_NOT_VERIFIED: 'EXCHANGE_ACCOUNT_NOT_VERIFIED',
} as const;
export type ExchangeErrorCode =
  (typeof EXCHANGE_ERRORS)[keyof typeof EXCHANGE_ERRORS];

/**
 * 환전 요청. **금액 규칙은 여기서 보지 않는다** — zod(런타임에 데이터 모양을
 * 검사하고 TypeScript 타입까지 만들어주는 라이브러리)가 5,000원 미만을 거르면
 * `VALIDATION_FAILED`가 나가는데 AC는 `EXCHANGE_BELOW_MIN_AMOUNT`를 요구한다.
 */
export const requestExchangeSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().int().positive(),
});
export type RequestExchange = z.infer<typeof requestExchangeSchema>;

export const exchangeRequestSummarySchema = z.object({
  id: z.string(),
  amount: z.number().int(),
  status: z.enum(EXCHANGE_REQUEST_STATUSES),
  requestedAt: z.string(),
});
export type ExchangeRequestSummary = z.infer<
  typeof exchangeRequestSummarySchema
>;

/**
 * 금액 규칙. #30의 `checkAccountFormat`과 같은 자리다.
 *
 * **최소금액이 단위보다 먼저다.** 4,005원처럼 둘 다 걸리는 값에서 어느 쪽이
 * 나오는지 정해두지 않으면 테스트가 구현을 따라가게 된다.
 */
export function checkExchangeAmount(
  amount: number,
): { ok: true } | { ok: false; code: ExchangeErrorCode };
```

```typescript
// apps/api/src/exchange/exchange-request.service.ts (신규)

export class ExchangeError extends Error {
  constructor(readonly code: ExchangeErrorCode);
}

/** 저장된 환전 요청 한 건 */
export interface ExchangeRequestRecord {
  id: string;
  userId: string;
  amount: number;
  status: ExchangeRequestStatus;
  createdAt: Date;
}

/**
 * 성숙한 포인트를 읽는 포트.
 *
 * `maturedBefore` 이전에 `PAYOUT`된 합계에서 이미 환전에 쓴 만큼을 빼고 반려로
 * 되돌아온 만큼을 더한다. **캐시가 아니라 원장을 합산한다** (`ADR-PAY-1`).
 */
export interface MaturedPointReader {
  maturedBalanceOf(userId: string, maturedBefore: Date): Promise<number>;
}

/**
 * 환전 요청 저장소.
 *
 * **게이트 재확인이 트랜잭션 안에 있다.** 서비스의 성숙액 검사는 1차 방어이고,
 * 우리가 읽은 뒤 다른 요청이 먼저 쓴 경우는 여기가 잡는다.
 */
export interface ExchangeRequestStore {
  create(input: {
    userId: string;
    amount: number;
  }): Promise<ExchangeRequestRecord | 'INSUFFICIENT' | 'NOT_MATURED'>;
}

class ExchangeRequestService {
  constructor(
    store: ExchangeRequestStore,
    accounts: ExchangeAccountStore,
    matured: MaturedPointReader,
  );
  request(input: RequestExchange): Promise<ExchangeRequestSummary>;
}
```

```prisma
// apps/api/prisma/schema.prisma (추가)

model ExchangeRequest {
  id        String                @id @default(cuid())
  userId    String
  amount    Int
  status    ExchangeRequestStatus @default(REQUESTED)
  createdAt DateTime              @default(now())
  updatedAt DateTime              @updatedAt
  user      User                  @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  /// 관리자 환전 목록이 상태로 거른다 (§11.5)
  @@index([status, createdAt])
}

enum ExchangeRequestStatus {
  REQUESTED
  APPROVED
  COMPLETED
  REJECTED
}
```

### 에러 케이스

**판정 순서가 정해져 있다.** 입력값(1·2)이 전제조건(3·4)보다 먼저다 — 잘못 친
숫자 때문에 DB를 읽지 않는다.

| #   | 상황                                | 에러 코드                       | HTTP |
| --- | ----------------------------------- | ------------------------------- | ---- |
| 1   | `amount < 5000`                     | `EXCHANGE_BELOW_MIN_AMOUNT`     | 400  |
| 2   | `amount % 10 !== 0`                 | `EXCHANGE_INVALID_UNIT`         | 400  |
| 3   | 계좌가 `VERIFIED`가 아니거나 미등록 | `EXCHANGE_ACCOUNT_NOT_VERIFIED` | 409  |
| 4   | 성숙액 < 요청액                     | `EXCHANGE_NOT_MATURED`          | 409  |
| 5   | 성숙액은 되나 잔액이 모자람         | `POINT_INSUFFICIENT_BALANCE`    | 409  |
| —   | 형식 오류 (`amount` 누락·소수·음수) | `VALIDATION_FAILED`             | 400  |

5번은 새 코드를 만들지 않고 #27의 것을 쓴다. 자기 공고에 `HOLD`가 걸린 사람은
성숙한 포인트가 있어도 잔액이 잠겨 있을 수 있다.

### 판단이 갈렸던 지점

**1. 성숙액을 서비스와 저장소 양쪽에서 본다.** 조건부 UPDATE(`ADR-PAY-2`)는
`cachedBalance`만 지키는데 **성숙액은 컬럼이 아니라 원장 질의 결과라 그 보호를
못 받는다.** 잔액 20,000(성숙 10,000 + 미성숙 10,000)인 사람이 10,000짜리 요청을
동시에 두 번 보내면 잔액 검사는 둘 다 통과하고 미성숙 포인트가 환전된다. 그래서
트랜잭션 안에서 조건부 UPDATE를 **먼저** 실행해 그 회원의 `User` 행을 잠근 뒤
성숙액을 다시 센다. 뒤에 온 트랜잭션은 앞 것이 커밋된 뒤에 세므로 이미 빠진
금액을 본다. `application.service`의 "서비스는 1차 방어, 저장소가 최종 판정"과
같은 모양이다.

**2. 계좌는 `ExchangeAccountStore`를 그대로 주입한다.** 같은 모듈·같은 도메인이라
`JobPostReader` 같은 새 포트를 만들지 않는다. 미등록도
`EXCHANGE_ACCOUNT_NOT_VERIFIED`로 합친다 — 요청하는 쪽에서 "검증 안 됨"과 "등록
안 됨"의 대응이 같다.

**3. 성숙액 질의를 환전 폴더에 둔다.** `prisma-point-ledger.store.ts`가 아니라
`prisma-exchange-request.store.ts`가 갖는다. 읽기 전용 집계라 원장 쪽에 없어도
손해가 없고, 원장 파일의 변경면을 넓히지 않는다.

### 이 이슈에서 만들지 않는 것

- **화면.** AC 5개가 전부 백엔드다 (#30은 화면 AC가 있었지만 #31에는 없다)
- 관리자 승인·반려와 `EXCHANGE_REVERT` 쓰기. 상태 enum만 지금 만들고 전이는 다음 이슈
- 환전 요청 조회·목록
- 계좌 스냅샷. 계좌를 바꾸면 `upsert`가 검증 상태까지 덮으므로 미검증 계좌로 송금될 길이 없다

---

## 테스트 시나리오

### 정상

- [x] [정상] `request` — should create a REQUESTED request and append a -10000 `EXCHANGE_REQUEST` entry when 20000 matured points exist and 10000 is requested
- [x] [정상] `request` — should return the id, amount, status and requestedAt of the stored request
- [x] [정상] `create` — should point the ledger entry at the request through referenceId when both rows are written
- [x] [정상] `POST /exchange-requests` — should respond 201 with the summary when every gate passes

### 경계

- [x] [경계] `checkExchangeAmount` — should accept exactly 5000
- [x] [경계] `checkExchangeAmount` — should reject 4990 with `EXCHANGE_BELOW_MIN_AMOUNT`
- [x] [경계] `checkExchangeAmount` — should reject 4005 with `EXCHANGE_BELOW_MIN_AMOUNT` when both the minimum and the unit are violated
- [x] [경계] `request` — should accept when the matured amount equals the requested amount exactly
- [x] [경계] `maturedBalanceOf` — should include a payout made exactly 7 days ago
- [x] [경계] `maturedBalanceOf` — should exclude a payout made 1 second short of 7 days
- [x] [경계] `maturedBalanceOf` — should subtract earlier `EXCHANGE_REQUEST` amounts so the same points cannot be exchanged twice
- [x] [경계] `maturedBalanceOf` — should add `EXCHANGE_REVERT` amounts back so a rejected request becomes exchangeable again
- [x] [경계] `create` — should let only one of two concurrent requests succeed when the matured amount covers only one

### 예외

- [x] [예외] `request` — should throw `EXCHANGE_BELOW_MIN_AMOUNT` when 4000 is requested
- [x] [예외] `request` — should throw `EXCHANGE_INVALID_UNIT` when 10005 is requested
- [x] [예외] `request` — should throw `EXCHANGE_NOT_MATURED` when the points were paid out 3 days ago
- [x] [예외] `request` — should throw `EXCHANGE_ACCOUNT_NOT_VERIFIED` when the account is PENDING
- [x] [예외] `request` — should throw `EXCHANGE_ACCOUNT_NOT_VERIFIED` when the account is REJECTED
- [x] [예외] `request` — should throw `EXCHANGE_ACCOUNT_NOT_VERIFIED` when no account is registered
- [x] [예외] `request` — should throw `EXCHANGE_BELOW_MIN_AMOUNT` without reading the account when 4000 is requested by a member who has no account
- [x] [예외] `request` — should throw `POINT_INSUFFICIENT_BALANCE` when matured points exist but the balance is held by an open job post
- [x] [예외] `create` — should leave neither a request row nor a ledger entry when the balance is short
- [x] [예외] `POST /exchange-requests` — should respond 400 with `EXCHANGE_BELOW_MIN_AMOUNT`
- [x] [예외] `POST /exchange-requests` — should respond 409 with `EXCHANGE_ACCOUNT_NOT_VERIFIED`
- [x] [예외] `POST /exchange-requests` — should respond 400 with `VALIDATION_FAILED` when amount is missing or not an integer
- [x] [예외] `request` — should throw `EXCHANGE_NOT_MATURED` when the store rejects the write after another request has committed
- [x] [예외] `POST /exchange-requests` — should respond 409 with `POINT_INSUFFICIENT_BALANCE`

---

## AC 대조

| AC                                                                                                                                  | 커버하는 시나리오                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Given 지급받은 지 7일 지난 포인트 20000, When 10000을 환전 요청하면, Then `REQUESTED`가 생기고 `EXCHANGE_REQUEST`로 잔액이 줄어든다 | `[정상] request — should create a REQUESTED request and append a -10000 EXCHANGE_REQUEST entry ...`<br>`[정상] create — should point the ledger entry at the request through referenceId ...`<br>`[경계] maturedBalanceOf — should include a payout made exactly 7 days ago` |
| Given 4000원 요청, When 제출하면, Then `EXCHANGE_BELOW_MIN_AMOUNT`로 막힌다                                                         | `[예외] request — should throw EXCHANGE_BELOW_MIN_AMOUNT when 4000 is requested`<br>`[경계] checkExchangeAmount — should reject 4990 ...`<br>`[경계] checkExchangeAmount — should accept exactly 5000`                                                                       |
| Given 10005원 요청, When 제출하면, Then `EXCHANGE_INVALID_UNIT`으로 막힌다                                                          | `[예외] request — should throw EXCHANGE_INVALID_UNIT when 10005 is requested`                                                                                                                                                                                                |
| Given 지급된 지 3일된 포인트, When 환전 요청하면, Then `EXCHANGE_NOT_MATURED`로 막힌다                                              | `[예외] request — should throw EXCHANGE_NOT_MATURED when the points were paid out 3 days ago`<br>`[경계] maturedBalanceOf — should exclude a payout made 1 second short of 7 days`                                                                                           |
| Given 계좌가 `VERIFIED`가 아닐 때, When 요청하면, Then `EXCHANGE_ACCOUNT_NOT_VERIFIED`로 막힌다                                     | `[예외] request — ... when the account is PENDING`<br>`[예외] request — ... when the account is REJECTED`<br>`[예외] request — ... when no account is registered`                                                                                                            |

### AC에 없는데 추가한 시나리오

| 시나리오                                                     | 왜 넣었나                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `maturedBalanceOf` — 이미 쓴 `EXCHANGE_REQUEST`를 뺀다       | 안 빼면 **같은 포인트를 여러 번 환전할 수 있다.** AC1만 통과시키면 이 구멍이 열린 채로 초록불이 된다   |
| `maturedBalanceOf` — `EXCHANGE_REVERT`를 다시 더한다         | 반려된 금액이 영영 환전 불가로 굳는 것을 막는다 (§6.4.1 5번)                                           |
| `create` — 동시 요청 2건 중 하나만 성공                      | 성숙액은 컬럼이 아니라 조건부 UPDATE의 보호를 못 받는다. 문장으로 못 박지 않으면 Green에서 사라진다    |
| `create` — 실패 시 요청 행도 원장 행도 안 남는다             | `ADR-PAY-4`의 한 트랜잭션 결정을 검증한다                                                              |
| `request` — 성숙액은 되나 잔액이 잠겨 있다                   | 구인자이면서 구직자인 회원에게 실제로 생기는 경로다                                                    |
| `checkExchangeAmount` — 4005는 최소금액이 이긴다             | 판정 순서를 못 박는다. 안 정하면 테스트가 구현을 따라간다                                              |
| `request` — 4000원이면 계좌를 읽지 않는다                    | 입력값이 전제조건보다 먼저라는 순서를 못 박는다                                                        |
| `POST /exchange-requests` 3건                                | HTTP 상태 코드 매핑(400/409)은 서비스 테스트가 못 잡는다                                               |
| `request` — 저장소가 늦게 `'NOT_MATURED'`를 돌려준 경우      | Green 뒤 커버리지가 잡았다. 경합 테스트가 저장소를 직접 불러 **서비스의 매핑 한 줄이 검증되지 않았다** |
| `POST /exchange-requests` — 409 `POINT_INSUFFICIENT_BALANCE` | 같은 이유. 승인된 에러 표 5번인데 시나리오가 없어 8줄이 미검증이었다                                   |

**커버리지:** AC 5개 / 시나리오 27개 / 미커버 0개

> 뒤의 2개는 Green을 마친 뒤 커버리지 측정에서 발견해 추가했다. 구현이 이미
> 있었으므로 **매핑을 잠시 지워 빨간불을 확인하고 되돌리는** 방식으로 테스트가
> 실제로 무언가를 지키는지 증명했다.
