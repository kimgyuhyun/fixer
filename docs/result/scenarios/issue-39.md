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

- [ ] [정상] `purge` — should mask the name of a member deactivated longer than the retention period
- [ ] [정상] `purge` — should replace the email with deleted_{userId}@invalid
- [ ] [정상] `purge` — should delete every address row of that member
- [ ] [정상] `purge` — should delete the agreement PDF file
- [ ] [정상] `purge` — should keep the agreement sha256 after deleting the file
- [ ] [정상] `purge` — should stamp purgedAt

### 아직 이른 계정은 건드리지 않는다 (AC3)

- [ ] [예외] `purge` — should not purge a member deactivated for only one month
- [ ] [경계] `purge` — should not purge a member deactivated exactly at the retention boundary
- [ ] [경계] `purge` — should purge one millisecond past the boundary
- [ ] [예외] `purge` — should never purge an active member

### 기록은 그대로 남는다 (AC2)

- [ ] [정상] `purge` — should keep the member row instead of deleting it
- [ ] [정상] `purge` — should keep the point ledger rows of the purged member
- [ ] [정상] `purge` — should keep the agreement row of the purged member

### 파기된 계정은 신규 가입이 된다 (AC4)

- [ ] [정상] `signup` — should treat a purged account's original email as a new signup
- [ ] [예외] `reactivate` — should not revive a purged account

### 보관 기간을 주입할 수 있다 (AC5)

- [ ] [정상] `purge` — should purge after one minute when the retention period is one minute
- [ ] [경계] `purge` — should be idempotent: a second run purges nothing

### 중복 실행 방어 (spec-fixed §8.2)

- [ ] [경계] `purge` — should return skippedByLock without touching anything when the advisory lock is held
- [ ] [정상] `purge` — should release the advisory lock when it finishes

**총 19개** (정상 11 / 경계 5 / 예외 3)

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
