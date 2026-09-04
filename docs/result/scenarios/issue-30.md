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

- [ ] [정상] `register` — should store the account number encrypted, not in plain text
- [ ] [정상] `register` — should be able to read the number back through the cipher
- [ ] [정상] `register` — should keep the last four digits for masking
- [ ] [보안] `cipher` — should produce a different ciphertext each time for the same number
- [ ] [보안] `cipher` — should refuse to decrypt a tampered ciphertext
- [ ] [보안] `cipher` — should refuse to start without a key

### 형식이 맞으면 즉시 VERIFIED (AC2)

- [ ] [정상] `register` — should mark a well-formed account VERIFIED right away
- [ ] [정상] `register` — should record no rejection reason when it passed
- [ ] [경계] `register` — should accept the shortest allowed account number
- [ ] [경계] `register` — should accept the longest allowed account number

### 형식이 틀리면 REJECTED (AC3)

- [ ] [예외] `register` — should reject an account number that is too short
- [ ] [예외] `register` — should reject an account number with letters in it
- [ ] [예외] `register` — should reject an unknown bank code
- [ ] [정상] `register` — should say why it was rejected
- [ ] [정상] `register` — should store nothing when the format is wrong

### 화면에서는 마스킹된다 (AC4)

- [ ] [보안] `findMine` — should never return the account number in plain text
- [ ] [정상] `findMine` — should return the masked number and the bank code
- [ ] [예외] `findMine` — should reject a member who registered no account
- [ ] [정상] `계좌 화면` — should show the masked number
- [ ] [보안] `계좌 화면` — should show a rejection reason when the account was refused

### 덮어쓰기

- [ ] [경계] `register` — should replace the account when the member registers again
- [ ] [경계] `register` — should verify again from scratch after a replacement

### 진짜 Postgres에서

- [ ] [보안] `통합` — should leave no plain account number in the database
- [ ] [경계] `통합` — should keep one account per member

**총 24개** (정상 9 / 경계 5 / 예외 4 / 보안 6)

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
