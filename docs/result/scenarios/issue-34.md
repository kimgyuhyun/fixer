# 이슈 #34 — 관리자가 환전을 승인하고 완료 처리한다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/34
> PRD: `docs/result/prd/point-money.md` · 사양: `spec-fixed.md` §6.4.1 §6.4.2 §11.5
> 담당: A · 선행 #31(환전을 요청한다) — 머지 완료
> 브랜치 `feat/point-money/issue-34` (base: `main`)
> 상태: Green 완료 — 시나리오 31개 전부 통과

---

## 이 이슈가 닫는 자리

#31이 `ExchangeRequest`를 `REQUESTED`까지만 만들어 두고 **나머지 세 상태를 enum에만
선언해 두었다.** 이 이슈가 그 전이를 쓴다.

`AdminAuditLog`도 #35가 만들면서 주석에 **"#34(환전 승인·계좌 열람)가 같은 표에
쌓는다"**고 자리를 예고해 두었다. `reason`이 nullable인 이유가 이 이슈의 계좌 열람이다.

**스키마 변경이 없다.** `ExchangeRequest`·`ExchangeRequestStatus`·`AdminAuditLog`·
`PointTransactionType.EXCHANGE_REVERT`가 전부 이미 있다. 마이그레이션을 만들지 않는다.

---

## 시그니처

### 관련 ADR

| 결정                   | 이 시그니처에 미치는 영향                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `spec-fixed.md` §6.4.1 | 상태는 `REQUESTED` → `APPROVED` → `COMPLETED` / `REJECTED`. 반려는 `EXCHANGE_REVERT`로 원복한다 |
| `spec-fixed.md` §6.4.2 | `ManualExchangeProvider` — **승인은 상태만 바꾼다.** 실송금 호출이 없다                         |
| `spec-fixed.md` §11.5  | 모든 관리자 조치는 `AdminAuditLog`에. **계좌번호 열람도 조치다**                                |
| `ADR-PAY-1`            | 금전 판정은 원장이다. 반려는 원장에 `+amount` 한 줄을 쌓는 것이지 잔액을 되돌리는 게 아니다     |
| `ADR-PAY-4`            | 상태 전이·원장·감사 로그가 **한 트랜잭션**이다. 보상 트랜잭션을 두지 않는다                     |
| `ADR-PAY-6`            | 평문 계좌번호는 `AccountCipher` 뒤에만 있다. 목록에는 뒤 4자리만 나간다                         |
| `ADR-JOB-3` (차용)     | 상태 전이는 표로 판정한다. 표에 없는 전이는 거부한다 — #35의 `transition()`과 같은 모양         |
| `ADR-JOB-5` (차용)     | 관리자 목록은 오프셋 페이징. 전체 건수를 함께 준다                                              |

### 타입

```typescript
// packages/shared/src/admin.ts (추가)

/** #35가 열어 둔 표에 환전 조치 넷을 더한다 */
export const ADMIN_ACTIONS = {
  JOB_POST_FORCE_CANCEL: 'JOB_POST_FORCE_CANCEL',
  EXCHANGE_APPROVE: 'EXCHANGE_APPROVE',
  EXCHANGE_COMPLETE: 'EXCHANGE_COMPLETE',
  EXCHANGE_REJECT: 'EXCHANGE_REJECT',
  /** 계좌번호 전체 열람. **조치가 아니라 조회인데도 남긴다** (§11.5) */
  EXCHANGE_ACCOUNT_REVEAL: 'EXCHANGE_ACCOUNT_REVEAL',
} as const;
```

```typescript
// packages/shared/src/exchange.ts (추가)

/** 관리자 환전 목록 한 페이지 건수 */
export const EXCHANGE_PAGE_SIZE = 20;

export const EXCHANGE_ERRORS = {
  // ...#31의 넷 그대로
  /** 그런 환전 요청이 없다 */
  REQUEST_NOT_FOUND: 'EXCHANGE_REQUEST_NOT_FOUND',
  /** 표에 없는 상태 전이다 */
  INVALID_TRANSITION: 'EXCHANGE_INVALID_TRANSITION',
} as const;

/**
 * 전이표 (§6.4.1). **표에 없으면 거부한다.**
 *
 * `COMPLETED`·`REJECTED`는 종착역이다 — 이체가 끝난 뒤에 반려되거나
 * 원복된 뒤에 다시 승인되면 돈이 두 번 움직인다.
 */
export function canTransitionExchange(
  from: ExchangeRequestStatus,
  to: ExchangeRequestStatus,
): boolean;

/** 관리자 환전 목록 필터 (§11.5). 상태와 페이지만 본다 */
export const adminExchangeFilterSchema = z.object({
  status: z.enum(EXCHANGE_REQUEST_STATUSES).optional(),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});
export type AdminExchangeFilter = z.infer<typeof adminExchangeFilterSchema>;

/**
 * 목록 한 줄. AC1이 요구하는 네 칸이 그대로 필드다.
 *
 * **계좌 블록이 통째로 nullable이다.** 파기 배치(#39)가 계좌를 지운 뒤에도
 * 환전 이력은 남는다 — 그때 빈 문자열을 채우면 "없음"과 "빈 값"이 섞인다.
 */
export const adminExchangeRequestSummarySchema = z.object({
  id: z.string(),
  requesterName: z.string(),
  amount: z.number().int(),
  status: z.enum(EXCHANGE_REQUEST_STATUSES),
  requestedAt: z.iso.datetime(),
  account: z
    .object({
      bankName: z.string(),
      /** `****1234`. **평문은 이 스키마를 통과하지 못한다** */
      maskedAccountNumber: z.string(),
      holderName: z.string(),
      verificationStatus: z.enum(ACCOUNT_VERIFICATION_STATUSES),
    })
    .nullable(),
});
export type AdminExchangeRequestSummary = z.infer<
  typeof adminExchangeRequestSummarySchema
>;

export const adminExchangeListSchema = z.object({
  items: z.array(adminExchangeRequestSummarySchema),
  /** **필터를 적용한 뒤의** 건수 */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminExchangeList = z.infer<typeof adminExchangeListSchema>;

/** 승인·이체 완료의 응답. 바뀐 상태만 돌려준다 */
export const exchangeActionResultSchema = z.object({
  id: z.string(),
  status: z.enum(EXCHANGE_REQUEST_STATUSES),
});
export type ExchangeActionResult = z.infer<typeof exchangeActionResultSchema>;

/** 반려 요청. **사유가 필수다** (§11.5) */
export const rejectExchangeRequestSchema = z.object({
  reason: z.string().trim().min(1, { error: '반려 사유를 입력해 주세요.' }),
});
export type RejectExchangeRequest = z.infer<typeof rejectExchangeRequestSchema>;

/** 반려 응답. 되돌린 금액을 함께 준다 — 화면이 다시 묻지 않아도 된다 */
export const rejectExchangeResultSchema = z.object({
  id: z.string(),
  status: z.enum(EXCHANGE_REQUEST_STATUSES),
  reverted: z.number().int(),
});
export type RejectExchangeResult = z.infer<typeof rejectExchangeResultSchema>;

/**
 * 계좌번호 전체 열람의 응답.
 *
 * **은행명·예금주는 담지 않는다.** 목록에 이미 있고, 응답에 한 벌 더 실으면
 * 평문 계좌번호가 담긴 페이로드가 그만큼 커진다.
 */
export const revealedAccountSchema = z.object({
  accountNumber: z.string(),
});
export type RevealedAccount = z.infer<typeof revealedAccountSchema>;
```

```typescript
// apps/api/src/admin/admin-exchange.service.ts (신규)

/** 목록 한 줄에 필요한 것들. 신청자 이름과 계좌를 조인해서 함께 온다 */
export interface AdminExchangeRow {
  id: string;
  userId: string;
  amount: number;
  status: ExchangeRequestStatus;
  createdAt: Date;
  requesterName: string;
  account: {
    bankCode: string;
    accountNumberLast4: string;
    holderName: string;
    verificationStatus: AccountVerificationStatus;
  } | null;
}

/**
 * 관리자 환전 저장소.
 *
 * **상태 전이·원장·감사 로그가 저장소 한 메서드 안에서 한 트랜잭션이다**
 * (`ADR-PAY-4`). 서비스가 세 번 부르면 그 사이에 죽었을 때 "승인은 됐는데
 * 누가 했는지 없는" 건이 남는다.
 */
export interface AdminExchangeStore {
  listAll(
    filter: AdminExchangeFilter,
    pageSize: number,
  ): Promise<{ items: AdminExchangeRow[]; total: number }>;

  findById(id: string): Promise<ExchangeRequestRecord | null>;

  /**
   * 상태만 옮기고 감사 로그를 남긴다 (승인·이체 완료).
   *
   * `expectedStatus`가 아니면 `'STALE'`. 우리가 읽은 뒤 다른 관리자가 먼저
   * 눌렀다는 뜻이다 — 덮어쓰지 않는다.
   */
  updateStatus(input: {
    requestId: string;
    expectedStatus: ExchangeRequestStatus;
    nextStatus: ExchangeRequestStatus;
    adminId: string;
    action: AdminAction;
  }): Promise<ExchangeRequestRecord | 'STALE'>;

  /** 반려 — 상태 전이 + `EXCHANGE_REVERT` 원장 + 감사 로그가 한 트랜잭션 */
  reject(input: {
    requestId: string;
    userId: string;
    amount: number;
    expectedStatus: ExchangeRequestStatus;
    adminId: string;
    reason: string;
  }): Promise<ExchangeRequestRecord | 'STALE'>;

  /** 감사 로그만 남긴다 (계좌 열람) */
  recordAudit(input: {
    adminId: string;
    action: AdminAction;
    targetId: string;
  }): Promise<void>;
}

/**
 * 평문 계좌번호를 꺼내는 포트. `ExchangeAccountService.revealForPayout`이
 * 이미 그 모양이라 새 구현을 만들지 않는다 (`ADR-PAY-6`).
 */
export interface AccountRevealer {
  revealForPayout(userId: string): Promise<string>;
}

export class AdminExchangeService {
  constructor(
    store: AdminExchangeStore,
    accounts: AccountRevealer,
    notifications: NotificationPublisher,
  );

  list(filter: AdminExchangeFilter): Promise<AdminExchangeList>;
  approve(input: {
    adminId: string;
    requestId: string;
  }): Promise<ExchangeActionResult>;
  complete(input: {
    adminId: string;
    requestId: string;
  }): Promise<ExchangeActionResult>;
  reject(input: {
    adminId: string;
    requestId: string;
    reason: string;
  }): Promise<RejectExchangeResult>;
  revealAccount(input: {
    adminId: string;
    requestId: string;
  }): Promise<RevealedAccount>;
}
```

```typescript
// apps/api/src/admin/admin-exchange.controller.ts (신규)
// 가드는 클래스에 붙인다 — #35와 같은 모양이다.

@Controller('admin/exchange-requests')
@UseGuards(AdminGuard)
class AdminExchangeController {
  list(query: unknown): Promise<AdminExchangeList>;
  approve(id: string, adminId: string): Promise<ExchangeActionResult>;
  complete(id: string, adminId: string): Promise<ExchangeActionResult>;
  reject(
    id: string,
    body: unknown,
    adminId: string,
  ): Promise<RejectExchangeResult>;
  /** **`POST`다.** 감사 로그를 쓰므로 `GET`으로 두면 안 된다 */
  reveal(id: string, adminId: string): Promise<RevealedAccount>;
}
```

### 에러 케이스

| #   | 상황                                     | 에러 코드                     | HTTP |
| --- | ---------------------------------------- | ----------------------------- | ---- |
| 1   | 그런 요청이 없다                         | `EXCHANGE_REQUEST_NOT_FOUND`  | 404  |
| 2   | 표에 없는 전이 (이미 승인·완료·반려됨)   | `EXCHANGE_INVALID_TRANSITION` | 409  |
| 3   | 반려 사유가 비었다                       | `ADMIN_REASON_REQUIRED`       | 400  |
| 4   | 관리자가 아니다                          | `ADMIN_FORBIDDEN`             | 403  |
| 5   | 열람하려는데 계좌가 없다                 | `ACCOUNT_NOT_REGISTERED`      | 404  |
| —   | 우리가 읽은 뒤 다른 관리자가 먼저 눌렀다 | `EXCHANGE_INVALID_TRANSITION` | 409  |

3·4·5는 새로 만들지 않는다 — #35의 `ADMIN_ERRORS`와 #30의 `ACCOUNT_ERRORS`를 그대로 쓴다.

### 전이표 (§6.4.1)

| from        | 갈 수 있는 곳           |
| ----------- | ----------------------- |
| `REQUESTED` | `APPROVED`, `REJECTED`  |
| `APPROVED`  | `COMPLETED`, `REJECTED` |
| `COMPLETED` | —                       |
| `REJECTED`  | —                       |

### 컴포넌트 Props

```typescript
// apps/web/src/app/admin/exchange-requests/AdminExchangeList.tsx (신규)

export interface AdminExchangeListProps {
  items: AdminExchangeRequestSummary[];
  total: number;
  page: number;
  pageSize: number;
  filter: AdminExchangeFilter;
  /** 403을 받았다. 표 대신 안내를 그린다 (#35와 같다) */
  forbidden?: boolean;
}
```

### 판단이 갈렸던 지점

**1. 반려는 `APPROVED`에서도 된다.** §6.4.1이 `REQUESTED` → `APPROVED` →
`COMPLETED` / `REJECTED`로 적어 두어 `REJECTED`가 `APPROVED` **뒤**에 온다.
AC2가 "`REQUESTED` 건"이라 못 박은 것과 달리 AC5는 "요청 건"이라고만 했다.
둘을 합치면 반려는 아직 이체하지 않은 두 상태 모두에서 가능하다. **`COMPLETED`
뒤에는 안 된다** — 돈이 이미 나갔는데 포인트까지 돌려주면 두 번 준 것이다.

**2. 승인은 원장을 건드리지 않는다.** 포인트는 #31의 요청 시점에 이미
`EXCHANGE_REQUEST`로 빠졌다. 승인에서 또 빼면 두 번 빠진다. 승인은 상태와
감사 로그뿐이다 — §6.4.2의 `ManualExchangeProvider`가 하는 일이 그것뿐이다.

**3. 계좌 열람은 `POST`다.** 감사 로그를 쓰는 요청을 `GET`으로 두면 브라우저
프리페치나 새로고침에 열람 기록이 늘어난다. "누가 언제 봤나"가 근거가 되려면
사람이 누른 것만 남아야 한다.

**4. 반려 사유는 검사만 서비스가 하고 알림은 저장소 밖이다.** 저장소가
`'STALE'`을 돌려주면 알림을 보내지 않는다 — 아무것도 안 바뀌었는데
"반려됐습니다"가 가면 안 된다.

### 이 이슈에서 만들지 않는 것

- **스키마 변경·마이그레이션.** 필요한 모델·enum이 전부 이미 있다
- **실송금.** §6.4.3 — `PortOneExchangeProvider`는 사업자등록 후다
- **금액 구간·요청 기간 필터, 신청자 이름 검색** (§11.5). 상태 필터만 만든다. AC1이 요구하는 것은 목록이 보이는 것까지다
- **환전 요청 상세 화면.** 목록 한 줄에 필요한 정보가 다 있다
- **이메일 병행 발송** (#37). 인앱 알림 포트까지다

---

## 테스트 시나리오

### 정상

- [x] [정상] `list` — should return the requester name, amount, masked account and verification status of every row
- [x] [정상] `approve` — should move a REQUESTED request to APPROVED
- [x] [정상] `approve` — should record an EXCHANGE_APPROVE audit log carrying the admin id and the request id
- [x] [정상] `approve` — should ask the store for the EXCHANGE_APPROVE action rather than EXCHANGE_COMPLETE
- [x] [정상] `complete` — should move an APPROVED request to COMPLETED
- [x] [정상] `complete` — should ask the store for the EXCHANGE_COMPLETE action rather than EXCHANGE_APPROVE
- [x] [정상] `reject` — should move the request to REJECTED and append a +amount EXCHANGE_REVERT ledger entry
- [x] [정상] `reject` — should publish an EXCHANGE_REJECTED notification to the requester
- [x] [정상] `revealAccount` — should return the full account number
- [x] [정상] `revealAccount` — should record an EXCHANGE_ACCOUNT_REVEAL audit log naming the admin and the request
- [x] [정상] `AdminExchangeList` — should render the requester, amount, masked account and verification status of each row
- [x] [정상] `GET /admin/exchange-requests` — should respond 200 with the list for an admin

### 경계

- [x] [경계] `canTransitionExchange` — should allow REQUESTED to APPROVED and APPROVED to COMPLETED
- [x] [경계] `canTransitionExchange` — should allow rejecting from REQUESTED and from APPROVED
- [x] [경계] `canTransitionExchange` — should refuse every transition out of COMPLETED and out of REJECTED
- [x] [경계] `list` — should return an empty page instead of an error when the page is past the last one
- [x] [경계] `reject` — should restore the balance to exactly the amount it held before the request
- [x] [경계] `reject` — should make the reverted amount exchangeable again through `maturedBalanceOf`
- [x] [경계] `updateStatus` — should let only one of two concurrent approvals of the same request succeed
- [x] [경계] `AdminExchangeList` — should keep the account number masked until the reveal button is pressed

### 예외

- [x] [예외] `approve` — should throw `EXCHANGE_REQUEST_NOT_FOUND` when no such request exists
- [x] [예외] `approve` — should throw `EXCHANGE_INVALID_TRANSITION` when the request is already APPROVED
- [x] [예외] `approve` — should throw `EXCHANGE_INVALID_TRANSITION` when the store reports STALE after another admin committed first
- [x] [예외] `complete` — should throw `EXCHANGE_INVALID_TRANSITION` when the request is still REQUESTED
- [x] [예외] `reject` — should throw `EXCHANGE_INVALID_TRANSITION` when the request is already COMPLETED
- [x] [예외] `reject` — should throw `ADMIN_REASON_REQUIRED` when the reason is blank
- [x] [예외] `reject` — should touch neither the request nor the ledger when the reason is blank
- [x] [예외] `reject` — should not notify the requester when the store reports STALE
- [x] [예외] `revealAccount` — should throw `ACCOUNT_NOT_REGISTERED` and record no audit log when the requester has no account
- [x] [예외] `POST /admin/exchange-requests/:id/approve` — should respond 403 with `ADMIN_FORBIDDEN` for a member who is not an admin
- [x] [예외] `POST /admin/exchange-requests/:id/approve` — should respond 404 with `EXCHANGE_REQUEST_NOT_FOUND`
- [x] [예외] `POST /admin/exchange-requests/:id/complete` — should respond 409 with `EXCHANGE_INVALID_TRANSITION`
- [x] [예외] `POST /admin/exchange-requests/:id/reject` — should respond 400 with `ADMIN_REASON_REQUIRED` when the reason is missing

---

## AC 대조

| AC                                                                                               | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Given 관리자, When 환전 요청 목록을 열면, Then 신청자·금액·계좌(마스킹)·검증 상태가 보인다       | `[정상] list — should return the requester name, amount, masked account ...`<br>`[정상] AdminExchangeList — should render the requester, amount, masked account ...`<br>`[정상] GET /admin/exchange-requests — 200`<br>`[경계] list — empty page past the last one`<br>`[예외] POST .../approve — 403 ADMIN_FORBIDDEN`                                                                                                                                                                                                                                                |
| Given `REQUESTED` 건, When 승인하면, Then `APPROVED`가 되고 감사 로그가 남는다                   | `[정상] approve — should move a REQUESTED request to APPROVED`<br>`[정상] approve — should record an EXCHANGE_APPROVE audit log ...`<br>`[경계] canTransitionExchange — REQUESTED to APPROVED`<br>`[경계] updateStatus — only one of two concurrent approvals`<br>`[예외] approve — NOT_FOUND`<br>`[예외] approve — INVALID_TRANSITION when already APPROVED`<br>`[예외] approve — INVALID_TRANSITION on STALE`<br>`[예외] POST .../approve — 404`                                                                                                                    |
| Given `APPROVED` 건, When "이체 완료"를 누르면, Then `COMPLETED`가 된다                          | `[정상] complete — should move an APPROVED request to COMPLETED`<br>`[경계] canTransitionExchange — APPROVED to COMPLETED`<br>`[경계] canTransitionExchange — nothing leaves COMPLETED`<br>`[예외] complete — INVALID_TRANSITION when still REQUESTED`<br>`[예외] POST .../complete — 409`                                                                                                                                                                                                                                                                            |
| Given 계좌번호 전체 열람 버튼, When 누르면, Then 전체가 보이고 열람 사실이 감사 로그에 남는다    | `[정상] revealAccount — should return the full account number`<br>`[정상] revealAccount — should record an EXCHANGE_ACCOUNT_REVEAL audit log ...`<br>`[경계] AdminExchangeList — masked until the reveal button is pressed`<br>`[예외] revealAccount — ACCOUNT_NOT_REGISTERED and no audit log`                                                                                                                                                                                                                                                                       |
| Given 요청 건, When 사유를 적고 반려하면, Then `EXCHANGE_REVERT`로 포인트가 원복되고 알림이 간다 | `[정상] reject — REJECTED + a +amount EXCHANGE_REVERT entry`<br>`[정상] reject — publishes an EXCHANGE_REJECTED notification`<br>`[경계] reject — balance restored exactly`<br>`[경계] reject — reverted amount exchangeable again`<br>`[경계] canTransitionExchange — rejecting from REQUESTED and APPROVED`<br>`[예외] reject — ADMIN_REASON_REQUIRED`<br>`[예외] reject — nothing touched when the reason is blank`<br>`[예외] reject — no notification on STALE`<br>`[예외] reject — INVALID_TRANSITION when already COMPLETED`<br>`[예외] POST .../reject — 400` |

### AC에 없는데 추가한 시나리오

| 시나리오                                                  | 왜 넣었나                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `canTransitionExchange` — `COMPLETED`·`REJECTED`가 종착역 | AC는 갈 수 있는 길만 말한다. **막지 않으면 이체가 끝난 건을 반려해 포인트를 두 번 줄 수 있다**                                 |
| `updateStatus` — 동시 승인 2건 중 하나만 성공             | 관리자가 둘일 때 실제로 생기는 경로다. 문장으로 못 박지 않으면 Green에서 사라진다 (#31의 동시 요청 시나리오와 같은 이유)       |
| `reject` — 되돌린 금액이 다시 환전 가능해진다             | #31의 `maturedBalanceOf`가 `EXCHANGE_REVERT`를 더하도록 이미 짜여 있다. 반려 쪽에서 그 계약이 실제로 맞물리는지는 미검증이었다 |
| `reject` — `'STALE'`이면 알림을 보내지 않는다             | 아무것도 안 바뀌었는데 "반려됐습니다"가 가면 사용자가 잔액을 다시 확인하러 온다                                                |
| `revealAccount` — 계좌가 없으면 감사 로그도 없다          | 열람하지 못한 것을 열람 기록으로 남기면 그 표가 근거가 되지 못한다                                                             |
| `list` — 범위를 넘은 페이지는 빈 목록                     | #35·#13과 같은 규칙이다. 오류로 만들면 관리자 화면이 페이지 이동에서 깨진다                                                    |
| `POST .../approve` — 403                                  | 가드가 이 컨트롤러에도 실제로 걸렸는지는 서비스 테스트가 못 잡는다                                                             |
| HTTP 상태 코드 매핑 3건 (404·409·400)                     | 서비스가 던지는 코드와 화면이 받는 상태 코드의 대응은 컨트롤러에서만 검증된다                                                  |
| `approve`·`complete` — 저장소에 넘기는 조치 이름          | `@ac-verifier`가 AC2를 부분 충족으로 판정해 더했다. 아래 참조                                                                  |

**커버리지:** AC 5개 / 시나리오 33개 / 미커버 0개

> 뒤의 2개는 Green을 마친 뒤 `@ac-verifier`의 AC2 판정에서 나왔다. 승인과 이체
> 완료는 같은 몸통(`move`)을 공유하고 **다른 것이 조치 이름 하나뿐**이라, 둘이
> 뒤바뀌어도 나머지 32개가 전부 초록불로 남았다. 그러면 감사 로그의 "무엇을
> 했나"가 틀린 채로 쌓인다. 구현이 이미 있었으므로 **승인의 조치 이름을 잠시
> `EXCHANGE_COMPLETE`로 바꿔 빨간불을 확인하고 되돌리는** 방식으로 새 테스트가
> 실제로 무언가를 지키는지 증명했다 (#31과 같은 절차).
