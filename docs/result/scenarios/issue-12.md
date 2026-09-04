# 이슈 #12 — 공고를 등록하면 목록에 뜬다

> 선행 #11 (카테고리) · #28 (충전) · 도메인 job-post · 크기 L
> 브랜치 `feat/job-post/issue-12` (base: `feat/point-money/issue-29` + `#11` 병합)

**이 프로젝트의 첫 번째 완전한 세로 흐름이다.** 폼·검증·포인트 잠금·목록이
한 동작이라 L이다. 어느 하나가 빠지면 "등록했는데 돈이 안 잠겼다"거나
"돈은 잠겼는데 공고가 없다"가 된다.

---

## 시그니처

### 데이터

```prisma
model JobPost {
  id          String        @id @default(cuid())
  employerId  String
  categoryId  String
  title       String
  status      JobPostStatus @default(DRAFT)
  /// 필수항목 6개가 바뀔 때만 오른다 (spec-fixed §3.4). 시작값 1
  version     Int           @default(1)

  // ── 필수항목 6개 (이 값들이 version을 올린다) ──
  workAddress         String
  workStartAt         DateTime
  workEndAt           DateTime
  headcount           Int
  rewardPerPerson     Int
  requiredDescription String

  /// 물리 삭제 없음 (spec-fixed §3.3)
  deletedAt   DateTime?
  versions    JobPostVersion[]
}

/// 버전마다 필수항목 6개 **전부를 정규 컬럼으로** 남긴다 (ADR-JOB-1).
/// diff JSON이면 중간 하나가 틀어질 때 이후 복원이 전부 틀어진다.
model JobPostVersion { ... }

enum JobPostStatus { DRAFT OPEN CLOSED COMPLETED CANCELLED EXPIRED }
```

### 공유 — 상태 전이표 (ADR-JOB-3)

```ts
/** `{ from, to }` 목록. **표에 없는 전이는 거부된다** */
export const JOB_POST_TRANSITIONS = [
  { from: 'DRAFT', to: 'OPEN' },
  { from: 'OPEN', to: 'CLOSED' },
  ...
] as const;

export function canTransition(from: JobPostStatus, to: JobPostStatus): boolean;
```

### 서버

```ts
/**
 * 공고를 등록하고 곧바로 `OPEN`으로 올린다.
 *
 * **예산 잠금과 공고 저장이 한 트랜잭션이다.** 나뉘면 "돈은 잠겼는데
 * 공고가 없다"가 생기고, 그 돈은 아무도 풀어줄 수 없다.
 */
create(input: CreateJobPostInput): Promise<JobPostSummary>
list(filter): Promise<{ items: JobPostSummary[]; total: number }>
```

```
POST /job-posts        →  201  JobPostSummary
                       →  409  POINT_INSUFFICIENT_BALANCE  (부족 금액 포함)
                       →  400  VALIDATION_FAILED           (필드별 오류)
GET  /job-posts        →  200  { items, total }
```

---

## 판단이 갈렸던 지점

**등록과 `HOLD`를 한 트랜잭션에 묶는다.**
따로 하면 둘 중 하나만 성공하는 창이 생긴다. 공고만 남으면 예산 없는 공고가
목록에 뜨고, `HOLD`만 남으면 **아무도 풀어줄 수 없는 돈**이 된다 — 그
사용자에게 그 금액은 영원히 사라진 것과 같다.

**`DRAFT`를 거쳐 `OPEN`으로 간다.**
상태머신(§3.3)이 `DRAFT ─▶ OPEN`이라고 정했다. 한 번에 `OPEN`으로 만들면
전이표를 우회하게 되어 `ADR-JOB-3`이 무의미해진다. 트랜잭션 안에서
만들고 곧바로 전이시킨다 — 밖에서 보면 한 동작이다.

**부족 금액을 응답에 담는다.**
"잔액이 부족합니다"만 주면 사용자가 얼마를 더 넣어야 하는지 모른다. 본인
계정의 숫자라 감출 정보가 아니다.

**`version`은 1로 시작하고 `JobPostVersion` v1을 함께 만든다.**
`ADR-JOB-1`대로 계약 복원이 `WHERE version = N` 한 줄이어야 한다. 등록
시점에 v1을 안 만들면 첫 수정 전까지 복원할 스냅샷이 없다.

**근무 주소 기본값은 서버가 채운다.**
화면이 채우면 주소를 바꾼 사용자가 옛 값을 보낼 수 있고, 서버는 그게
기본값인지 사용자가 고른 값인지 구분할 방법이 없다.

**목록은 `OPEN`만 보여준다.**
`DRAFT`는 잠깐 스쳐가는 상태이고 취소·만료는 지원할 수 없다. 상태 필터는
#13이 붙인다.

---

## 시나리오

### 등록하면 OPEN으로 저장된다 (AC1)

- [x] [정상] `create` — should save the job post as OPEN
- [x] [정상] `create` — should start version at 1
- [x] [정상] `create` — should write the v1 snapshot so a contract can be restored
- [x] [경계] `transition` — should refuse a transition that is not in the table
- [x] [경계] `transition` — should refuse to move out of a final state
- [x] [정상] `transition` — should allow every transition the table lists
- [x] [경계] `transition` — should refuse every transition the table does not list (36개 조합 전부)

### 인원 × 보상금만큼 잠긴다 (AC2)

- [x] [정상] `create` — should hold headcount times rewardPerPerson
- [x] [정상] `create` — should point the HOLD row at the job post
- [x] [정상] `create` — should report the budget on the created post

### 잔액이 부족하면 막힌다 (AC3)

- [x] [예외] `create` — should reject with POINT_INSUFFICIENT_BALANCE
- [x] [정상] `create` — should say how much more is needed
- [x] [정상] `create` — should not save the job post when the balance is short
- [x] [경계] `create` — should allow a budget that spends the balance exactly

### 필수항목이 비면 저장되지 않는다 (AC4)

- [x] [예외] `create` — should reject an empty required field with a field error
- [x] [정상] `create` — should not touch the ledger when validation fails
- [x] [경계] `create` — should reject a headcount below one
- [x] [경계] `create` — should reject a reward that is not a positive multiple of 1000
- [x] [경계] `create` — should reject a work period that ends before it starts
- [x] [경계] `create` — should reject a work period of zero length

### 목록에 뜬다 (AC5)

- [x] [정상] `list` — should include the job post that was just created
- [x] [경계] `list` — should not include a job post that is still DRAFT
- [x] [정상] `list` — should report the total count

### 근무 주소 기본값 (AC6)

- [x] [정상] `create` — should fill the work address from the member address when it is blank
- [x] [정상] `create` — should keep the given work address when one is provided
- [x] [경계] `create` — should treat a whitespace-only address as blank
- [x] [예외] `create` — should reject when the address is blank and the member has none

### 진짜 Postgres에서

- [x] [경계] `통합` — should leave neither the post nor the HOLD when the balance is short
- [x] [정상] `통합` — should reduce the balance by the whole budget
- [x] [정상] `통합` — should write the v1 snapshot in the same transaction
- [x] [경계] `통합` — should not let two concurrent posts overspend the balance
- [x] [정상] `통합` — should fill the work address from the member address
- [x] [정상] `통합` — should list the created post with its total

### 컨트롤러

- [x] [정상] `POST /job-posts` — should return 201 with the created post
- [x] [경계] `POST /job-posts` — should return 400 when employerId is missing
- [x] [예외] `POST /job-posts` — should return 400 with a per-field error for an empty title
- [x] [예외] `POST /job-posts` — should return 409 with the shortfall when the balance is short
- [x] [예외] `POST /job-posts` — should return 400 when the member has no address to fall back on
- [x] [경계] `POST /job-posts` — should let an unknown error through so it becomes 500
- [x] [정상] `GET /job-posts` — should return the items and the total
- [x] [경계] `GET /job-posts` — should return an empty list without failing

### 화면

- [x] [정상] `작성 화면` — should send the form and show that the budget was held
- [x] [정상] `작성 화면` — should leave the work address out so the server fills it in
- [x] [경계] `작성 화면` — should not send the request when a required field is empty
- [x] [예외] `작성 화면` — should show how much is missing when the balance is short
- [x] [예외] `작성 화면` — should put a server field error under that field
- [x] [정상] `목록 화면` — should show a job post that was created
- [x] [정상] `목록 화면` — should show the reward per person
- [x] [정상] `목록 화면` — should report the total count
- [x] [경계] `목록 화면` — should say the list is empty when nothing is open
- [x] [경계] `목록 화면` — should show an error instead of an empty list when the request fails

**총 45개** (단위 26 + 통합 6 + 컨트롤러 8 + 화면 10, 겹치는 항목 제외)

### 서버를 띄워 확인한 것

| 무엇              | 결과                                                      |
| ----------------- | --------------------------------------------------------- |
| 잔액 0에서 등록   | `409`, "포인트가 150,000원 부족합니다" + shortfall 150000 |
| 20만 충전 후 등록 | `201 OPEN version 1`, 근무 주소가 가입 주소로 채워짐      |
| 그 뒤 잔액        | 50,000 (20만 − 15만). 원장에 `HOLD -150000`               |
| 목록              | 그 공고 한 건                                             |
| 필수항목 빈 폼    | `400`, 칸 4개에 각각 문구                                 |

---

## AC 대조

| AC                     | 시나리오        |
| ---------------------- | --------------- |
| 1 · OPEN·version 1     | 등록 4개        |
| 2 · 인원 × 보상금 HOLD | 잠금 3개 + 통합 |
| 3 · 부족하면 막힘      | 부족 4개        |
| 4 · 필드별 오류        | 검증 5개        |
| 5 · 목록에 뜬다        | 목록 3개        |
| 6 · 근무 주소 기본값   | 주소 3개        |

---

## 이번 범위 밖

| 것                      | 어디로 |
| ----------------------- | ------ |
| 검색·필터·페이징        | #13    |
| 공고 상세               | #14    |
| 필수항목 수정과 version | #15    |
| 공고 취소와 RELEASE     | #16    |
