# 이슈 #39 — 개인정보 파기 배치가 돈다

> 선행 #9 (탈퇴) · 도메인 auth-member · 크기 M
> 브랜치 `feat/auth-member/issue-39` (base: `feat/auth-member/issue-10` + `#3 주소` + `#7·#8 동의서` 병합)

**행을 지우지 않는다.** 컬럼 단위 비식별 처리다 (`spec-fixed.md` §2.7). 행을
지우면 5년 보관해야 하는 계약·결제 기록의 FK가 함께 깨진다.

선행이 #9뿐인데 주소·동의서 브랜치를 끌어온 이유는, 파기할 컬럼이 그
브랜치들에만 있어서다. 없는 것은 파기했다고 말할 수 없다.

---

## 시그니처

### 상수 — `packages/shared/src/retention.ts`

마지막 AC("테스트에서 1분으로 주입")가 이 파일을 요구한다. 값이 코드
여기저기 흩어져 있으면 주입할 지점이 없다.

```ts
export const RETENTION = {
  /** 이름·연락처·주소·계좌·서명 동의서 PDF — 비활성화 후 4개월 */
  PERSONAL_INFO_MS: 4 * 30 * 24 * 60 * 60 * 1000,
  /** 계약·청약철회 기록 5년 */
  CONTRACT_MS: 5 * 365 * 24 * 60 * 60 * 1000,
  /** 대금결제·재화공급 기록 5년 */
  PAYMENT_MS: 5 * 365 * 24 * 60 * 60 * 1000,
  /** 소비자 불만·분쟁 처리 기록 3년 */
  DISPUTE_MS: 3 * 365 * 24 * 60 * 60 * 1000,
} as const;

/** 잡 하나당 고정 정수 키 (spec-fixed §8.2) */
export const ADVISORY_LOCK_KEYS = { PURGE_PERSONAL_INFO: 39 } as const;
```

### 데이터

```prisma
model User {
  purgedAt DateTime?   // ← 추가. 두 번 파기하지 않기 위한 표식
}
```

### 서버

```ts
/**
 * 파기 대상을 찾아 비식별 처리한다.
 *
 * `retentionMs`를 **인자로 받는다.** 테스트가 1분을 주입할 수 있어야 한다.
 */
purge(now: Date, retentionMs: number): Promise<PurgeReport>

interface PurgeReport {
  purgedUserIds: string[];
  deletedAgreementFiles: number;
  /** 락을 못 잡아 아무것도 안 했다 */
  skippedByLock: boolean;
}
```

---

## 판단이 갈렸던 지점

**`purgedAt`을 둔다.**
`ADR-AUTH-3`은 상태 컬럼을 만들지 말라고 했지만, `purgedAt`은 상태가 아니라
**시각 기록**이라 그 기각 사유에 걸리지 않는다(PRD auth-member §175가 명시).
이게 없으면 배치가 어제 파기한 계정을 오늘 또 훑는다 — 마스킹은 멱등이라
결과는 같지만, 대상 건수가 영원히 줄지 않아 배치가 느려지고 로그가 거짓이 된다.

**이메일은 `deleted_{userId}@invalid`로 바꾼다.**
§2.7이 정한 형태다. `@invalid`는 예약 TLD라 실재하지 않는다. 이걸로 두 가지가
동시에 풀린다 — 유니크 제약이 유지되고, **그 이메일로 다시 가입하면 신규
가입이 된다**(AC4). 따로 분기할 코드가 없다.

**PDF는 지우고 해시는 남긴다.**
§9가 정한 형태다. 나중에 "그때 무엇에 서명했나"가 분쟁이 되면 원본 없이도
같은 파일인지 대조할 수 있다.

**advisory lock은 잡기 실패해도 오류가 아니다.**
다른 인스턴스가 이미 돌고 있다는 뜻이다. 조용히 돌아서면 된다. 여기서
예외를 던지면 서버가 두 대일 때 매일 알람이 울린다.

**파기는 트랜잭션 안에서, 파일 삭제는 그 뒤에.**
파일 삭제는 되돌릴 수 없다. DB가 롤백됐는데 파일만 사라지는 것보다,
DB는 파기됐는데 파일이 남는 편이 낫다 — 후자는 다시 돌리면 지워진다.

---

## 시나리오

### 4개월 지난 계정을 파기한다 (AC1)

- [x] [정상] `purge` — should mask the name of a member deactivated longer than the retention period
- [x] [정상] `purge` — should replace the email with a deleted address that can never receive mail
- [x] [정상] `purge` — should delete every address row of the purged member (통합 테스트)
- [x] [정상] `purge` — should delete the agreement PDF file
- [x] [정상] `purge` — should keep the agreement sha256 after deleting the file
- [x] [정상] `purge` — should stamp purgedAt

### 아직 이른 계정은 건드리지 않는다 (AC3)

- [x] [예외] `purge` — should not purge a member deactivated for only one month
- [x] [경계] `purge` — should not purge a member deactivated exactly at the retention boundary
- [x] [경계] `purge` — should purge one millisecond past the boundary
- [x] [예외] `purge` — should never purge an active member

### 기록은 그대로 남는다 (AC2)

- [x] [정상] `purge` — should keep the member row instead of deleting it
- [x] [정상] `purge` — should keep the point ledger rows of the purged member
- [x] [정상] `purge` — should keep the agreement row of the purged member

### 파기된 계정은 신규 가입이 된다 (AC4)

- [x] [정상] `purge` — should let the purged email be used for a brand new signup (통합 테스트)
- [x] [예외] `reactivate` — 파기된 계정은 이메일이 바뀌어 `findByEmail`이 못 찾는다. 위 통합 테스트가 같은 것을 증명한다

### 보관 기간을 주입할 수 있다 (AC5)

- [x] [정상] `purge` — should purge after one minute when the retention period is one minute
- [x] [경계] `purge` — should be idempotent so a second run purges nothing

### 중복 실행 방어 (spec-fixed §8.2)

- [x] [경계] `purge` — should return skippedByLock without touching anything when the advisory lock is held
- [x] [경계] `advisory lock` — should refuse a second holder while the first holds the lock (통합 테스트, 다른 연결에서)
- [x] [경계] `purge` — should skip the run without touching anything when the lock is held elsewhere (통합 테스트)
- [x] [정상] `purge` — should release the advisory lock when it finishes
- [x] [경계] `purge` — should release the advisory lock even when the store throws

- [x] [정상] `purge` — should report what it purged
- [x] [경계] `purge` — should not purge before the injected minute has passed
- [x] [정상] `purge` — should mask the member without deleting the row or its records (통합 테스트)
- [x] [경계] `purge` — should leave a member deactivated for only one month untouched (통합 테스트)

### ac-verifier가 잡은 것 — 인증 이력에 이메일이 남았다

`EmailVerification`은 `userId`가 없고 **이메일을 평문으로** 들고 있다.
회원 행만 마스킹하면 파기된 사람의 원래 주소가 여기 영구히 남는다.
`spec-fixed.md` §2.7의 파기 대상 표에는 없지만, 개인정보가 실제로 남는
경로라 파기 대상에 넣었다.

- [x] [보안] `purge` — should delete the email verification history that still holds the original address (통합 테스트)
- [x] [경계] `purge` — should keep the email verification history of a member who is not purged yet (통합 테스트)

**총 28개** (단위 18 + 통합 10). 상수 파일에 3개가 더 있다.

---

## 다음 이슈가 갚아야 할 것

AC1은 **연락처·계좌**도 파기하라고 하는데 그 컬럼이 아직 없다. AC2는
**공고·신청**이 남아 있는지 보라고 하는데 그 모델이 아직 없다. 지금은
증명할 방법이 없어서 남긴다.

| 언제         | 무엇                                                            |
| ------------ | --------------------------------------------------------------- |
| **#30** 뒤   | `purge`가 계좌 정보를 지운다 + 그 통합 테스트                   |
| phone 생기면 | `purge`가 `phone`을 비운다                                      |
| **#12** 뒤   | 파기된 회원의 과거 공고·신청이 그대로 남는지 통합 테스트로 확인 |

**파기 대상 목록은 컬럼이 늘어날 때마다 함께 늘려야 한다.** 안 늘리면
조용히 남는다 — 빨개지는 테스트가 없다.

### 진짜 Postgres에서 확인한 것

가짜 저장소로는 증명할 수 없는 것이 둘이라 Testcontainers로 따로 봤다.

| 무엇                         | 왜 실물이어야 하나                                      |
| ---------------------------- | ------------------------------------------------------- |
| 행을 안 지우고 컬럼만 바꾼다 | FK가 걸린 원장·동의서가 살아남는지는 진짜 DB에서만 난다 |
| advisory lock                | **다른 연결**이 정말 못 잡는지. 같은 세션은 재진입 허용 |

---

## AC 대조

| AC                                 | 시나리오      |
| ---------------------------------- | ------------- |
| 1 · 4개월 지나면 비식별 + PDF 삭제 | 파기 6개      |
| 2 · 과거 기록은 그대로             | 기록 유지 3개 |
| 3 · 1개월된 계정은 파기 안 됨      | 이른 계정 4개 |
| 4 · 파기된 이메일은 신규 가입      | 신규 가입 2개 |
| 5 · 보관 기간 1분 주입             | 주입 2개      |

---

## 이번 범위 밖

| 것                             | 어디로                                            |
| ------------------------------ | ------------------------------------------------- |
| 계좌 정보 파기                 | **#30** — 계좌 컬럼 자체가 아직 없다              |
| 연락처(phone) 파기             | 스키마에 없다. 생기는 이슈에서 파기 목록에 더한다 |
| Cron 등록 (`@nestjs/schedule`) | 이 이슈. 다만 실행 스케줄은 일 1회 고정           |
