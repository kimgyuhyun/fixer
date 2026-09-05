# 이슈 #15 — 필수항목을 고치면 version이 오른다

> 선행 #12 · 도메인 job-post · 크기 M
> 브랜치 `feat/job-post/issue-15` (base: `feat/job-post/issue-14`)

**이 판정이 새면 두 방향으로 다 사고다.** 놓치면 신청자가 모르는 사이 조건이
바뀌고, 과하면 오탈자 하나에 지원자 전원이 재동의 대기가 된다 (`ADR-JOB-2`).

---

## 시그니처

```ts
/**
 * 바뀐 필수항목 이름들. **순수 함수라 DB 없이 테스트한다** (ADR-JOB-2).
 *
 * `JOB_POST_REQUIRED_FIELDS` 6개만 본다. 여기 필드를 더하면 #15의
 * 6개 순회 테스트도 함께 늘려야 한다.
 */
export function changedRequiredFields(
  before: RequiredFields,
  after: Partial<RequiredFields>,
): string[];

update(input: {
  employerId: string;
  jobPostId: string;
  patch: UpdateJobPostRequest;
}): Promise<JobPostDetail>
```

```
PATCH /job-posts/:id  →  200  JobPostDetail
                      →  403  JOB_POST_NOT_OWNED
                      →  404  JOB_POST_NOT_FOUND
                      →  409  JOB_POST_NOT_EDITABLE   (OPEN이 아니다)
GET /job-posts/:id/versions/:version  →  200  그 시점의 필수항목 6개
                                      →  404  JOB_POST_VERSION_NOT_FOUND
```

---

## 판단이 갈렸던 지점

**값이 같으면 안 오른다.**
"고쳤다가 되돌렸다"는 아무것도 안 바뀐 것과 같다. 요청이 왔다는 사실만으로
올리면 지원자 전원이 이유 없이 재동의 대기가 된다 (AC5).

**날짜는 문자열이 아니라 시각으로 비교한다.**
`2026-10-01T09:00:00.000Z`와 `2026-10-01T09:00:00Z`는 문자열로는 다르지만
같은 순간이다. 문자열로 비교하면 아무것도 안 바뀌었는데 버전이 오른다.

**버전 증가와 스냅샷 저장이 한 트랜잭션이다.**
`version`만 오르고 스냅샷이 없으면 **그 버전의 계약을 영영 복원할 수 없다**
(`ADR-JOB-1`). 반대로 스냅샷만 남으면 번호가 겹친다.

**스냅샷은 바뀐 뒤 값을 남긴다.**
`version = 2`를 조회하면 v2 시점의 조건이 나와야 한다. 바뀌기 전 값을
남기면 번호와 내용이 한 칸씩 밀린다 — 등록 시점의 v1이 그 규칙을 이미 정했다.

**`OPEN`이 아니면 못 고친다.**
`CLOSED`는 이미 정원이 찼거나 시작 시각이 지난 상태다. 그 뒤에 조건을 바꾸면
수락자가 동의한 적 없는 일을 하게 된다 (AC6).

**예산이 바뀌면 잠금도 같이 바꾼다 — AC에는 없지만 안 하면 구멍이다.**
인원이나 보상금을 고치면 예산이 바뀐다. 잠긴 돈을 그대로 두면 인원을
3명에서 10명으로 올린 구인자가 **15만원만 잠근 채 50만원짜리 약속**을
하게 된다. #15의 AC 어디에도 없지만 그냥 두면 돈이 새므로 같은 트랜잭션에서
조정한다 — 늘면 조건부 UPDATE로 더 잠그고(모자라면 거절), 줄면 차액을
`RELEASE`한다.

**지원자 재동의 처리는 이 이슈에 없다.**
§3.4의 `PENDING_REACCEPT` 전환은 `Application`(#17)이 있어야 한다. **버전과
스냅샷은 지금 정확히 만들어 두고**, 그 위에 얹는 상태 전환만 #17 몫이다.

---

## 시나리오

### 필수항목을 고치면 오른다 (AC1)

- [x] [정상] `update` — should raise the version to two when the reward changes
- [x] [정상] `통합` — should leave the version and the snapshot in step after several edits (v1·v2·v3 값까지 대조)
- [x] [정상] `update` — should write the snapshot in the same step as the version bump
- [x] [정상] `update` — should return the updated post

### 계약을 복원할 수 있다 (AC2)

- [x] [정상] `통합` — should restore the contract of an older version
- [x] [경계] `findVersion` — should return the version-one snapshot written at creation
- [x] [예외] `findVersion` — should reject a version that was never written

### 부가항목만 고치면 그대로다 (AC3)

- [x] [정상] `update` — should keep the version at one when only the title changes
- [x] [정상] `update` — should not write a snapshot when only the title changes
- [x] [정상] `통합` — should not raise the version when only the title changes

### 필수항목 6개 각각 (AC4)

- [x] [정상] `changedRequiredFields` — should detect a change in each of the six fields, one at a time
- [x] [경계] `changedRequiredFields` — should report nothing when every field is sent unchanged
- [x] [경계] `changedRequiredFields` — should still detect a real date change
- [x] [경계] `changedRequiredFields` — should ignore fields that do not raise the version
- [x] [정상] `changedRequiredFields` — should list every field that changed at once
- [x] [경계] `changedRequiredFields` — should report nothing changed for an empty patch
- [x] [경계] `changedRequiredFields` — should compare dates as instants, not strings

### 되돌리면 안 오른다 (AC5)

- [x] [경계] `update` — should keep the version when the value is set back to what it was
- [x] [경계] `update` — should keep the version when every field is sent unchanged

### OPEN이 아니면 못 고친다 (AC6)

- [x] [예외] `update` — should reject a CLOSED post with JOB_POST_NOT_EDITABLE
- [x] [예외] `update` — should reject a CANCELLED post
- [x] [예외] `update` — should reject a post owned by another member
- [x] [예외] `update` — should reject a post that cannot be found
- [x] [정상] `update` — should change nothing when it was rejected

### 예산이 바뀌면 잠금도 바뀐다 (AC 밖, 돈 구멍)

- [x] [정상] `update` — should lock more when the headcount goes up
- [x] [정상] `update` — should release the difference when the reward goes down
- [x] [예외] `update` — should reject the edit when the balance cannot cover the bigger budget
- [x] [정상] `update` — should not change the post when the balance is short
- [x] [경계] `통합` — should leave neither the version nor the hold when the balance is short
- [x] [정상] `통합` — should release the difference when the budget goes down

### 진짜 Postgres에서

- [x] [경계] `통합` — should leave the version and the snapshot in step after several edits
- [x] [정상] `PATCH /job-posts/:id` — should return the updated post
- [x] [보안] `PATCH /job-posts/:id` — should not pass employerId through as a field to change
- [x] [경계] `PATCH /job-posts/:id` — should return 400 when employerId is missing
- [x] [예외] `PATCH /job-posts/:id` — should return 403 for a post owned by another member
- [x] [예외] `PATCH /job-posts/:id` — should return 409 when the post is not open
- [x] [예외] `PATCH /job-posts/:id` — should return 404 for a post that cannot be found
- [x] [정상] `GET /job-posts/:id/versions/:version` — should return the six required fields of that version
- [x] [예외] `GET /job-posts/:id/versions/:version` — should return 404 for a version that was never written
- [x] [정상] `통합` — should keep the locked amount equal to the budget after an edit

**총 41개** (순수 함수 7 + 서비스 18 + 통합 6 + 컨트롤러 8 · 예산 조정 4개 포함)

### 서버를 띄워 확인한 것

| 무엇             | 결과                                     |
| ---------------- | ---------------------------------------- |
| 제목만 수정      | `version 1` 그대로, 제목만 바뀜          |
| 보상금 5만 → 6만 | `version 2`, 예산 15만 → 18만, 잔액 −3만 |
| 같은 값으로 다시 | `version 2` 그대로 — 안 오른다           |
| `v1` 계약 복원   | 보상금 50,000                            |
| `v2` 계약 복원   | 보상금 60,000                            |
| 남의 공고 수정   | `403`                                    |

---

## AC 대조

| AC                          | 시나리오      |
| --------------------------- | ------------- |
| 1 · 보상금 수정 → version 2 | 수정 4개      |
| 2 · v2 조회 → 그 시점 전문  | 복원 3개      |
| 3 · 제목만 → version 그대로 | 부가항목 3개  |
| 4 · 6개 각각 오른다         | 6개 순회 3개  |
| 5 · 되돌리면 안 오른다      | 되돌리기 2개  |
| 6 · CLOSED면 막힌다         | 수정 불가 5개 |

---

## 이번 범위 밖

| 것                         | 어디로                                            |
| -------------------------- | ------------------------------------------------- |
| `PENDING_REACCEPT` 전환    | **#17** — 신청 모델이 있어야 한다                 |
| 변경 전/후 diff 화면       | #17 (신청자에게 보여주는 것)                      |
| 예산이 바뀔 때 HOLD 재조정 | #16 이후. 지금은 인원·보상금을 고쳐도 잠금 그대로 |
