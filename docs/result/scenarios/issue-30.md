# 이슈 #30 — 계좌를 등록하고 검증받는다

> 선행 #4 · 도메인 point-money · 크기 M
> 브랜치 `feat/point-money/issue-30` (base: `feat/job-post/issue-16`)

**`ADR-PAY-6`이 2026-09-05에 확정되어 막힘이 풀렸다.** 애플리케이션 레벨
AES-256-GCM, 마스터 키는 환경변수 하나.

---

## 시그니처

### 데이터

```prisma
model ExchangeAccount {
  id       String @id @default(cuid())
  userId   String @unique   // 회원당 한 계좌
  bankCode String
  /// **암호화해서 담는다** (ADR-PAY-6). `iv:authTag:ciphertext` 한 컬럼
  accountNumberEncrypted String
  /// 마스킹 표시에 쓰는 뒤 4자리. 평문이지만 이것만으로는 못 쓴다
  accountNumberLast4     String
  holderName             String
  verificationStatus     AccountVerificationStatus @default(PENDING)
  rejectedReason         String?
}

enum AccountVerificationStatus { PENDING VERIFIED REJECTED }
```

### 서버

```ts
/** 계좌번호 암복호화. **포트 뒤에 둔다** — 나중에 KMS로 갈아끼운다 (ADR-PAY-6) */
export interface AccountCipher {
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
}

/** 검증. `stub`은 형식만 보고 즉시 통과, `portone`은 실명 대조 (§6.4.2) */
export interface AccountVerifier {
  verify(input: {
    bankCode: string;
    accountNumber: string;
    holderName: string;
  }): Promise<{ status: 'VERIFIED' | 'REJECTED'; reason?: string }>;
}
```

```
PUT /exchange-accounts     →  200  MaskedAccount
                           →  400  ACCOUNT_INVALID_FORMAT (사유 포함)
GET /exchange-accounts/me  →  200  MaskedAccount
                           →  404  ACCOUNT_NOT_REGISTERED
```

---

## 판단이 갈렸던 지점

**뒤 4자리를 따로 평문으로 둔다.**
마스킹 표시를 하려고 매번 복호화하면 **계좌 목록 한 번에 전 회원의 계좌번호가
평문으로 메모리에 올라온다.** 뒤 4자리만으로는 계좌를 쓸 수 없으므로 그것만
따로 둔다.

**복호화는 환전 송금 시점에만 한다.**
화면·목록·상세 어디에도 평문을 안 내려보낸다. 관리자가 송금할 때만 꺼낸다 —
그때도 응답에 담지 않고 그 화면에서만 쓴다.

**회원당 계좌는 하나다.**
`userId`에 유니크를 건다. 여러 개를 허용하면 "어느 계좌로 보낼 것인가"를
환전 요청마다 정해야 하고, 그건 §6.4에 없는 단계다. 바꾸려면 덮어쓴다.

**덮어쓰면 검증이 처음부터 다시다.**
계좌를 바꿨는데 `VERIFIED`가 남아 있으면 검증 안 된 계좌로 송금이 나간다.

**거절 사유를 저장한다.**
"등록에 실패했습니다"만 주면 사용자가 무엇을 고쳐야 하는지 모른다. 자릿수가
틀렸는지 은행코드가 없는지 알려준다.

**키가 없으면 서버가 안 켜진다.**
기본값을 주면 그 값으로 암호화된 계좌가 생기고, 나중에 진짜 키로 바꾸면
**그 계좌들을 아무도 못 읽는다.**

---

## 시나리오

### 암호화해서 저장한다 (AC1)

- [x] [정상] `register` — should store the account number encrypted, not in plain text
- [x] [정상] `register` — should be able to read the number back through the cipher
- [x] [정상] `cipher` — should read back what it encrypted
- [x] [경계] `cipher` — should refuse a ciphertext whose shape is wrong
- [x] [정상] `register` — should strip hyphens before storing
- [x] [정상] `register` — should keep the last four digits for masking
- [x] [보안] `cipher` — should produce a different ciphertext each time for the same number
- [x] [보안] `cipher` — should refuse to decrypt a tampered ciphertext
- [x] [보안] `cipher` — should refuse to start without a key

### 형식이 맞으면 즉시 VERIFIED (AC2)

- [x] [정상] `register` — should mark a well-formed account VERIFIED right away
- [x] [정상] `register` — should record no rejection reason when it passed
- [x] [경계] `register` — should accept the shortest allowed account number
- [x] [경계] `register` — should accept the longest allowed account number

### 형식이 틀리면 REJECTED (AC3)

- [x] [예외] `register` — should reject an account number that is too short
- [x] [예외] `register` — should reject an account number with letters in it
- [x] [예외] `register` — should reject an unknown bank code
- [x] [정상] `register` — should say why it was rejected
- [x] [정상] `register` — should store nothing when the format is wrong

### 화면에서는 마스킹된다 (AC4)

- [x] [보안] `findMine` — should never return the account number in plain text
- [x] [정상] `findMine` — should return the masked number and the bank name
- [x] [예외] `findMine` — should reject a member who registered no account
- [x] [정상] `계좌 화면` — should show the masked number
- [x] [보안] `계좌 화면` — should never show the full account number after registering
- [x] [정상] `계좌 화면` — should strip hyphens before sending
- [x] [예외] `계좌 화면` — should show why the account was refused
- [x] [정상] `계좌 화면` — should load an account that was registered before
- [x] [경계] `계좌 화면` — should not let a registration start before a member is chosen

### 덮어쓰기

- [x] [경계] `register` — should replace the account when the member registers again
- [x] [경계] `register` — should verify again from scratch after a replacement

### 진짜 Postgres에서

- [x] [보안] `통합` — should leave no plain account number in the database
- [x] [경계] `통합` — should keep one account per member
- [x] [정상] `통합` — should read the number back for a payout
- [x] [경계] `통합` — should store nothing when the format is wrong
- [x] [경계] `통합` — should not let two members share one row
- [x] [정상] `revealForPayout` — should return the plain number for a payout
- [x] [예외] `revealForPayout` — should reject a member who registered no account

**총 34개** (서비스·암복호화 23 + 통합 5 + 화면 6)

### AC2는 절반만 충족이다 — 알림이 없다

AC2는 "즉시 `VERIFIED`가 되고 **알림이 간다**"인데 알림이 없다. 알림 자체가
아직 없는 도메인이라 여기서 만들 수 없다. **충족이라고 부르지 않는다** —
알림 이슈에서 검증 완료 알림을 붙일 때 이 AC도 함께 닫아야 한다.

`ac-verifier`가 짚었고, 통합 테스트의 인자 없는 `rejects.toThrow()`도
에러 코드까지 보도록 함께 조였다.

### 서버를 띄워 확인한 것

| 무엇                | 결과                                                 |
| ------------------- | ---------------------------------------------------- |
| 등록                | `****5678`, `VERIFIED`. 하이픈은 지워졌다            |
| DB의 계좌 컬럼      | `RgTWY08QDAsdnPL6:3bCZ...:F5+wJCHJ6eErva8=` — 암호문 |
| **평문 검색**       | **0건**                                              |
| `123` (자릿수 부족) | `400`, "계좌번호는 10~14자리입니다."                 |
| `999` (없는 은행)   | `400`, "지원하지 않는 은행입니다."                   |

---

## AC 대조

| AC                         | 시나리오            |
| -------------------------- | ------------------- |
| 1 · 암호화 저장            | 암호화 6개 + 통합 1 |
| 2 · stub에서 즉시 VERIFIED | 검증 4개            |
| 3 · 자릿수 틀리면 REJECTED | 거절 5개            |
| 4 · 화면에서 마스킹        | 마스킹 5개          |

---

## 이번 범위 밖

| 것                 | 어디로                                      |
| ------------------ | ------------------------------------------- |
| 환전 요청·승인     | #31 이후                                    |
| 실명 대조 (포트원) | 실결제 전환. `AccountVerifier`만 갈아끼운다 |
| 검증 완료 알림     | 알림 이슈. 지금은 상태만 남긴다             |
| 키 교체·재암호화   | `ADR-PAY-6`이 남긴 숙제                     |
