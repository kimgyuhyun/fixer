# 이슈 #16 — 공고를 취소한다

> 선행 #12 · #28 · 도메인 job-post · 크기 M
> 브랜치 `feat/job-post/issue-16` (base: `feat/job-post/issue-15`)

---

## 시그니처

### 데이터

`Penalty`를 여기서 만든다. `spec-fixed.md` §5가 정한 모양 그대로다.

```prisma
model Penalty {
  id         String        @id @default(cuid())
  userId     String
  reason     PenaltyReason
  jobPostId  String?
  occurredAt DateTime      @default(now())

  /// 최근 180일 롤링 윈도우 집계가 이 순서로 훑는다 (§5)
  @@index([userId, occurredAt])
}

enum PenaltyReason { NO_SHOW LATE_CANCEL SAME_DAY_CANCEL POSTER_CANCEL }
```

### 서버

```
POST /job-posts/:id/cancel  →  200  { released, penalized }
                            →  403  JOB_POST_NOT_OWNED
                            →  404  JOB_POST_NOT_FOUND
                            →  409  JOB_POST_INVALID_TRANSITION
```

---

## 판단이 갈렸던 지점

**잠금 해제는 "남은 만큼"이다.**
`RELEASE` 금액을 예산에서 다시 계산하면, #15에서 예산을 고친 공고의 숫자가
어긋난다. **그 공고 id를 참조하는 원장 행들의 합**을 되돌린다 — `ADR-PAY-7`이
lot 잔여를 원장에서 계산한 것과 같은 판단이다.

**취소와 해제가 한 트랜잭션이다.**
상태만 바뀌고 돈이 안 풀리면 **아무도 풀어줄 수 없는 돈**이 되고, 돈만
풀리고 상태가 남으면 예산 없는 공고가 모집 중으로 남는다.

**두 번 취소해도 한 번만 풀린다.**
멱등 키를 `cancel:{jobPostId}`로 둔다. 전이표가 `CANCELLED → CANCELLED`를
막지만, 두 요청이 동시에 오면 둘 다 `OPEN`을 읽는다 — 그때 막는 것은 원장의
유니크 제약이다 (#29에서 같은 것을 겪었다).

**패널티는 수락자가 있을 때만 쌓인다.**
신청자가 0명이면 아무도 피해를 안 봤다. §4.3이 "구인자 취소 시 구직자 보상은
없고 `Penalty`가 쌓인다"고 했지만, 그건 약속이 있었을 때의 이야기다.

**수락자 판정은 포트 뒤에 둔다.**
`Application`(#17)이 아직 없다. #9·#14와 같은 방식으로 포트를 만들고
구현체는 0을 돌려준다 — 그래서 **지금은 패널티가 실제로 쌓이지 않는다.**
`Penalty` 테이블과 쌓는 코드는 지금 만들어 두고, #17이 어댑터만 채운다.

**소프트 삭제가 아니라 상태 전환이다.**
§3.3이 `OPEN → CANCELLED`를 전이표에 뒀다. `deletedAt`은 관리자 삭제용이고,
구인자 취소는 상태다 — 취소된 공고도 상세로는 볼 수 있어야 한다(#14).

---

## 시나리오

### 신청자 없는 공고 취소 (AC1)

- [ ] [정상] `cancel` — should move the post to CANCELLED
- [ ] [정상] `cancel` — should release the whole locked budget
- [ ] [정상] `cancel` — should point the RELEASE row at the job post
- [ ] [경계] `cancel` — should release what is actually locked, not the recomputed budget
- [ ] [정상] `cancel` — should report what it released

### 수락자가 있으면 패널티 (AC2)

- [ ] [정상] `cancel` — should record a POSTER_CANCEL penalty when someone was accepted
- [ ] [경계] `cancel` — should record no penalty when nobody applied
- [ ] [정상] `cancel` — should still cancel and release when a penalty is recorded

### 목록에서 사라지고 DB에는 남는다 (AC3)

- [ ] [정상] `list` — should not include a cancelled post
- [ ] [정상] `findById` — should still return a cancelled post
- [ ] [경계] `통합` — should keep the row in the database after cancelling

### 남의 공고는 못 취소한다 (AC4)

- [ ] [예외] `cancel` — should reject a post owned by another member
- [ ] [예외] `cancel` — should reject a post that cannot be found
- [ ] [예외] `cancel` — should reject a post that is already cancelled
- [ ] [예외] `cancel` — should reject a COMPLETED post
- [ ] [정상] `cancel` — should change nothing when it was rejected

### 두 번 취소 (멱등)

- [ ] [경계] `통합` — should release only once when two cancels arrive at the same time
- [ ] [경계] `통합` — should leave the balance right after a double cancel

### 컨트롤러

- [ ] [정상] `POST /job-posts/:id/cancel` — should return what was released
- [ ] [예외] `POST /job-posts/:id/cancel` — should return 403 for another member
- [ ] [예외] `POST /job-posts/:id/cancel` — should return 409 for a post that cannot move to CANCELLED

**총 21개** (정상 10 / 경계 5 / 예외 6)

---

## AC 대조

| AC                           | 시나리오   |
| ---------------------------- | ---------- |
| 1 · CANCELLED + 전액 RELEASE | 취소 5개   |
| 2 · 수락자 있으면 Penalty    | 패널티 3개 |
| 3 · 목록에서 사라지고 남는다 | 목록 3개   |
| 4 · 남의 공고는 FORBIDDEN    | 거절 5개   |

---

## 이번 범위 밖

| 것                         | 어디로                                        |
| -------------------------- | --------------------------------------------- |
| 진짜 수락자 판정           | **#17** — 지금은 포트가 0을 돌려준다          |
| 신청 상태 `WITHDRAWN` 전환 | #17                                           |
| 180일 5건 제재 판정        | 제재 이슈. `Penalty` 테이블과 인덱스는 여기서 |
