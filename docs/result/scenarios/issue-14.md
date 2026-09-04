# 이슈 #14 — 공고 상세를 본다

> 선행 #12 · 도메인 job-post · 크기 S
> 브랜치 `feat/job-post/issue-14` (base: `feat/job-post/issue-13`)

---

## 시그니처

```ts
/** 상세. 목록 요약에 내용·카테고리 이름·확정 인원이 더 붙는다 */
export const jobPostDetailSchema = jobPostSummarySchema.extend({
  categoryName: z.string(),
  requiredDescription: z.string(),
  /** 수락된 신청 수. `acceptedCount / headcount`로 보인다 */
  acceptedCount: z.number().int(),
});

findById(jobPostId: string): Promise<JobPostDetail>
```

```
GET /job-posts/:id  →  200  JobPostDetail
                    →  404  JOB_POST_NOT_FOUND   (없거나 소프트 삭제됨)
```

---

## 판단이 갈렸던 지점

**소프트 삭제된 공고는 404다. "삭제됨"이라고 알려주지 않는다.**
`deletedAt`이 찍힌 공고에 "이 공고는 삭제되었습니다"를 주면, 존재했다는
사실과 그 id가 유효했다는 것이 새어나간다. 목록에서 안 보이는 것과 같은
이유로 없는 것처럼 다룬다.

**취소·만료된 공고는 상세로 볼 수 있다.**
목록에는 `OPEN`만 뜨지만(#12), 이미 지원한 사람이 자기가 지원한 공고를
다시 여는 경로가 있어야 한다. 소프트 삭제와 상태는 다른 문제다.

**확정 인원은 포트 뒤에 둔다.**
`Application`(#17)이 아직 없다. #9에서 `WithdrawalGuard`에 쓴 것과 같은
방식으로 포트를 지금 만들고 구현체는 0을 돌려준다 — **"0 / 6"이 보이는 것이
화면이 안 나오는 것보다 낫고**, #17이 들어오면 어댑터만 채운다.

**카테고리 이름을 함께 준다.**
화면이 카테고리를 다시 조회해 id를 이름으로 바꾸면 요청이 두 번 나가고,
그 사이에 목록만 뜨고 이름이 늦게 채워지는 깜빡임이 생긴다.

---

## 시나리오

### 상세가 보인다 (AC1)

- [x] [정상] `findById` — should return the category name, address, time, reward, headcount and description
- [x] [정상] `findById` — should return the budget so the screen can show what is locked
- [x] [정상] `상세 화면` — should show every required field
- [x] [정상] `상세 화면` — should show the locked budget
- [x] [정상] `상세 화면` — should show the category name instead of its id

### 확정 인원 (AC2)

- [x] [정상] `findById` — should report the accepted count next to the headcount
- [x] [경계] `findById` — should report zero accepted until applications exist
- [x] [정상] `상세 화면` — should show the confirmed headcount as "3 / 6"

### 없는 공고 (AC3)

- [x] [예외] `findById` — should reject a soft-deleted post with JOB_POST_NOT_FOUND
- [x] [예외] `findById` — should reject an id nobody has
- [x] [정상] `GET /job-posts/:id` — should return the detail
- [x] [예외] `GET /job-posts/:id` — should return 404 for a post that cannot be found
- [x] [정상] `상세 화면` — should say the post cannot be found
- [x] [보안] `상세 화면` — should not hint that the post ever existed
- [x] [경계] `상세 화면` — should show an error separate from not-found when the request fails
- [x] [경계] `상세 화면` — should still show a cancelled post
- [x] [경계] `통합` — should hide a soft-deleted post from the detail view
- [x] [경계] `findById` — should still return a cancelled post

**총 19개** (서비스 7 + 컨트롤러 2 + 통합 1 + 화면 9)

### 서버를 띄워 확인한 것

| 무엇           | 결과                                                  |
| -------------- | ----------------------------------------------------- |
| 상세           | 카테고리 이름 "청소", `acceptedCount 0 / headcount 6` |
| 없는 id        | `404 JOB_POST_NOT_FOUND`                              |
| 소프트 삭제 후 | 같은 `404`. **삭제됐다는 것도 알려주지 않는다**       |

### 화면을 두 겹으로 나눈 이유

Next 16의 `params`는 Promise라 `use()`로 풀어야 하는데, `use()`는 프라미스를
기다리며 렌더를 멈춘다. 그 상태로는 **테스트가 화면을 아예 못 본다.**
껍데기가 id만 풀고 본체(`JobPostDetail`)가 그 id를 받는다 — 목록에서
`Suspense`를 쓴 것과 같은 이유의 분리다.

---

## AC 대조

| AC                    | 시나리오      |
| --------------------- | ------------- |
| 1 · 필수항목이 보인다 | 상세 4개      |
| 2 · "3 / 6" 표시      | 확정 인원 3개 |
| 3 · 삭제된 공고 404   | 없는 공고 5개 |

---

## 이번 범위 밖

| 것             | 어디로                               |
| -------------- | ------------------------------------ |
| 진짜 확정 인원 | **#17** — 지금은 포트가 0을 돌려준다 |
| 지원 버튼      | #17                                  |
| 수정·취소 버튼 | #15 · #16                            |
