# 이슈 #22 — 신청자가 diff를 보고 재동의하거나 거절한다

> GitHub: https://github.com/Ikara777/fixer/issues/22
> PRD: `docs/result/prd/application.md`
> 담당: B (김규현)
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 시그니처

### 관련 ADR

**이 이슈는 새 ADR을 확정하지 않는다.** #21이 내려놓은 것을 올리는 길만 만들고,
필요한 결정은 전부 이미 있다.

| ID / 문서            | 내용                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec-fixed.md` §3.4 | 5번 "재동의 → `appliedVersion`을 최신으로 갱신, **이전 상태로 복귀**", 6번 "거절 → `CANCELLED_BY_VERSION_CHANGE`. **패널티 없음**", 4번 "화면에 **변경 전/후 diff** 표시"             |
| `ADR-APP-3` (#21)    | 복귀 대상은 `Application.previousStatus` 컬럼이 들고 있다. **#22가 그 값을 읽어 되돌린다.** 복귀를 `APPLIED`로 고정하는 안은 이미 기각됐다                                            |
| `ADR-APP-1` (#18)    | 확정 인원은 `JobPost.acceptedCount` 비정규화(정규화된 원본 대신 계산 결과를 따로 들고 있는 것) 카운터이고, **정원 판정의 진실은 조건부 UPDATE의 `WHERE acceptedCount < headcount`다** |
| `ADR-APP-2` (#21)    | 내려갈 때 `ACCEPTED`분만큼 `acceptedCount`가 이미 줄었다. **올라올 때 그만큼만 되올린다** — 거절은 카운터를 다시 건드리지 않는다                                                      |
| `ADR-JOB-1` (#15)    | 버전마다 필수항목 6개 전부가 `JobPostVersion` 스냅샷으로 남는다. **diff의 좌우 두 값이 이 표에서 온다** — 등록 시점의 v1도 이미 있다                                                  |
| `ADR-JOB-2` (#15)    | 바뀐 필수항목 판정은 `changedRequiredFields` 한 곳에만 있다. diff의 "무엇이 바뀌었나"도 **그 함수를 그대로 부른다**                                                                   |
| `spec-fixed.md` §4.2 | 전이표에 `PENDING_REACCEPT → APPLIED`·`→ ACCEPTED`·`→ CANCELLED_BY_VERSION_CHANGE` 세 줄이 이미 있다. 이 이슈가 표를 고치지 않는다                                                    |

### 판단이 갈렸던 지점

**정원이 찼으면 재동의를 거절한다.** 새 결정이 아니라 `ADR-APP-1`의 적용이다.
재동의로 `ACCEPTED`를 복구하는 것은 자리를 하나 도로 차지하는 일인데, 기다리는
동안 구인자가 그 자리를 다른 사람으로 채웠을 수 있고 **구인자가 정원을 줄이는
수정을 했을 때**는 아예 자리가 모자란다(6명 → 3명이면 6명이 다 내려와 3자리를
두고 돌아온다). §4.4가 "7명이 확정되지 않기를 원한다"로 못 박은 것이 이 경우에도
그대로 적용되므로, 수락(#18)과 **같은 조건부 UPDATE**를 쓰고 0행이면
`APPLICATION_HEADCOUNT_FULL`로 거절한다. 신청은 `PENDING_REACCEPT`로 남으므로
(§3.4 "삭제되지 않는다") 자리가 나면 다시 누를 수 있다.

**거절은 카운터를 건드리지 않는다.** `ADR-APP-2`가 내려갈 때 이미 줄였다.
여기서 또 줄이면 같은 자리가 두 번 비어 정원보다 많은 사람이 확정된다.

**거절에 저장소 메서드를 새로 만들지 않는다.** #17이 만든 `updateStatus`가
기대 상태를 `WHERE`에 거는 조건부 UPDATE라 그대로 맞는다. 새로 만들면 그 메서드
안에 `Penalty` 행을 쓸 자리가 생기는데, AC4가 막으려는 것이 바로 그것이다 —
**경고를 안 쌓는 가장 확실한 방법은 경고를 쓸 수 있는 코드를 안 만드는 것이다.**

**diff의 좌우는 둘 다 버전 스냅샷이다.** 오른쪽을 현재 공고 행에서 읽어도 값은
같지만, `JobPostVersion`이 분쟁 시 근거가 되는 계약 원본(`ADR-JOB-1`)이라
좌우를 같은 표에서 읽으면 "무엇과 무엇을 비교했나"가 한 종류로 정해진다.

### 타입

```typescript
// packages/shared/src/application.ts

/**
 * 재동의 대기 화면이 그리는 변경 전/후 (#22 AC1).
 *
 * **좌우가 둘 다 버전 스냅샷이다** — 계약 원본끼리 비교한다 (`ADR-JOB-1`).
 * 바뀐 항목 목록은 `changedRequiredFields`가 판정한다 (`ADR-JOB-2`) —
 * 화면이 두 스냅샷을 눈으로 대조해 다시 고르지 않는다.
 */
export const reacceptDiffSchema = z.object({
  applicationId: z.string(),
  jobPostId: z.string(),
  /** 내가 동의했던 버전 */
  before: jobPostVersionSchema,
  /** 지금 공고의 버전 */
  after: jobPostVersionSchema,
  /** 값이 달라진 필수항목 이름들. 화면이 이 줄만 나란히 그린다 */
  changedFields: z.array(z.enum(JOB_POST_REQUIRED_FIELDS)),
});
export type ReacceptDiff = z.infer<typeof reacceptDiffSchema>;

/** 재동의·거절 요청. 회원 식별은 #17과 같이 아직 본문으로 받는다 (#22) */
export const reacceptRequestSchema = z.object({
  applicantId: z.string().min(1, { error: '회원 정보가 없습니다.' }),
});
export type ReacceptRequest = z.infer<typeof reacceptRequestSchema>;

/** APPLICATION_ERRORS에 한 줄이 는다. **job-post의 코드를 재사용한다** */
JOB_POST_VERSION_NOT_FOUND: 'JOB_POST_VERSION_NOT_FOUND';
```

```typescript
// apps/api/src/application/application.service.ts

/** 저장된 신청 한 건. **#21이 적어 둔 이전 상태가 는다** */
export interface ApplicationRecord {
  // ...
  /** 재동의 대기로 내려가기 전 상태 (`ADR-APP-3`). 그 외 상태에서는 지난 흔적이다 */
  previousStatus: ApplicationStatus | null;
}

export interface ApplicationStore {
  /**
   * 재동의. **두 문장이 함께 되거나 함께 안 된다** (#22 AC2·AC3).
   *
   * 1. `Application SET status=previousStatus, appliedVersion=?, previousStatus=NULL
   *    WHERE id=? AND status='PENDING_REACCEPT'` → 0행이면 `'STALE'`
   * 2. `previousStatus='ACCEPTED'`면
   *    `JobPost SET acceptedCount+1 WHERE id=? AND acceptedCount < headcount`
   *    → 0행이면 `'FULL'`
   *
   * 나뉘면 상태는 `ACCEPTED`인데 카운터는 그대로가 되어 정원보다 많은 사람이
   * 확정된다 (`ADR-APP-1`). `'FULL'`이면 **아무것도 커밋하지 않는다.**
   */
  reaccept(input: {
    applicationId: string;
    jobPostId: string;
    previousStatus: 'APPLIED' | 'ACCEPTED';
    appliedVersion: number;
  }): Promise<ApplicationRecord | 'STALE' | 'FULL'>;
}

/** 공고를 읽는 포트에 **버전 스냅샷 한 줄이 는다** (#22 AC1) */
export interface JobPostReader {
  findForApplication(jobPostId: string): Promise<JobPostForApplication | null>;
  /** 그 버전의 필수항목 6개. 없으면 null */
  findVersionSnapshot(
    jobPostId: string,
    version: number,
  ): Promise<JobPostVersionSnapshot | null>;
}

class ApplicationService {
  /** 재동의 대기 화면이 그릴 변경 전/후 (AC1) */
  versionDiff(input: {
    applicantId: string;
    applicationId: string;
  }): Promise<ReacceptDiff>;

  /** 재동의. `appliedVersion`이 최신이 되고 **이전 상태로 복귀한다** (AC2·AC3) */
  reaccept(input: {
    applicantId: string;
    applicationId: string;
  }): Promise<ApplicationSummary>;

  /** 거절. `CANCELLED_BY_VERSION_CHANGE`가 되고 **경고가 쌓이지 않는다** (AC4) */
  declineVersionChange(input: {
    applicantId: string;
    applicationId: string;
  }): Promise<ApplicationSummary>;
}
```

```typescript
// apps/api/src/application/application.controller.ts

GET  /applications/:id/version-diff?applicantId=...  → ReacceptDiff
POST /applications/:id/reaccept   { applicantId }    → ApplicationSummary
POST /applications/:id/decline    { applicantId }    → ApplicationSummary
```

경로 이름이 `reject`가 아니라 `decline`인 이유는 **`reject`가 이미 구인자의
거절(#19)이기 때문**이다. 같은 이름을 쓰면 누가 거절한 것인지 경로만 보고는
알 수 없다.

### 에러 케이스

**새 에러 코드는 하나도 만들지 않는다.** 전부 #17·#18·#15가 이미 정한 코드다.

| 상황                                  | 에러 코드                        | HTTP |
| ------------------------------------- | -------------------------------- | ---- |
| 그런 신청이 없다                      | `APPLICATION_NOT_FOUND`          | 404  |
| 본인 신청이 아니다                    | `APPLICATION_NOT_OWNED`          | 403  |
| 재동의 대기가 아니다 (중복 클릭 포함) | `APPLICATION_INVALID_TRANSITION` | 409  |
| 기다리는 사이 정원이 찼다             | `APPLICATION_HEADCOUNT_FULL`     | 409  |
| 그 공고가 없다 (소프트 삭제 포함)     | `JOB_POST_NOT_FOUND`             | 404  |
| 내가 동의한 버전의 스냅샷이 없다      | `JOB_POST_VERSION_NOT_FOUND`     | 409  |

### 컴포넌트 Props

```typescript
// apps/web/src/app/job-posts/[id]/ReacceptPanel.tsx

interface ReacceptPanelProps {
  applicationId: string;
  applicantId: string;
  /** 재동의·거절이 끝나면 바뀐 신청을 위로 올린다. 화면이 다시 그려진다 */
  onSettled: (application: ApplicationSummary) => void;
}
```

`ApplyPanel`(#17)이 내 신청 상태가 `PENDING_REACCEPT`일 때 이 패널을 그린다.
#21의 알림이 `/job-posts/{id}`로 보내므로 **그 화면에서 바로 보여야** AC1의
"화면을 열면"이 성립한다.

### 이 이슈에서 만들지 않는 것

| 항목                                | 이유                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 재동의 기한 / 무응답 자동 취소      | AC에 없고 §3.4에도 없다. #21이 "기한을 지금 정하면 #22가 다시 정하게 된다"며 미뤄 둔 것을 여기서도 안 정한다 |
| 재동의·거절을 구인자에게 알리기     | AC에 없다. 구인자는 지원자 목록(#18)에서 상태로 본다                                                         |
| 값 포맷팅 규칙을 공유 모듈로 빼기   | 화면 한 곳에서만 쓴다. 두 번째 화면이 생기면 그때 뺀다                                                       |
| `previousStatus`를 응답 요약에 싣기 | AC에 없다. 화면이 복귀 결과를 `status`로 이미 본다                                                           |
| 거절 시 `previousStatus` 지우기     | `ADR-APP-3`이 "`PENDING_REACCEPT`인 동안에만 의미가 있다"고 정했다. 지난 흔적은 판정에 쓰지 않는다           |

---

## 테스트 시나리오

### 정상

- [ ] [정상] `versionDiff` — should return the applied-version snapshot as before and the current-version snapshot as after
- [ ] [정상] `versionDiff` — should name only the required fields whose values differ
- [ ] [정상] `reaccept` — should return an application demoted from APPLIED back to APPLIED
- [ ] [정상] `reaccept` — should stamp the current job post version as the applied version
- [ ] [정상] `reaccept` — should return an application demoted from ACCEPTED back to ACCEPTED
- [ ] [정상] `reaccept` — should raise acceptedCount by one when the previous status was ACCEPTED
- [ ] [정상] `declineVersionChange` — should move the application to CANCELLED_BY_VERSION_CHANGE

### 경계

- [ ] [경계] `reaccept` — should leave acceptedCount alone when the previous status was APPLIED
- [ ] [경계] `reaccept` — should refuse with HEADCOUNT_FULL and hold the application at PENDING_REACCEPT when the seats filled while it waited
- [ ] [경계] `declineVersionChange` — should leave acceptedCount alone because the demotion already lowered it

### 예외

- [ ] [예외] `versionDiff` — should reject when the application belongs to another applicant
- [ ] [예외] `versionDiff` — should reject when the application is not PENDING_REACCEPT
- [ ] [예외] `versionDiff` — should report JOB_POST_VERSION_NOT_FOUND when the applied-version snapshot is missing
- [ ] [예외] `reaccept` — should reject a second reaccept on the same application
- [ ] [예외] `reaccept` — should reject when the demoted application carries no previous status
- [ ] [예외] `declineVersionChange` — should reject when the application is not PENDING_REACCEPT
- [ ] [예외] `declineVersionChange` — should reject when the application belongs to another applicant

### 컨트롤러

- [ ] [정상] `GET /applications/:id/version-diff` — should answer the diff of the applicant's demoted application
- [ ] [정상] `POST /applications/:id/reaccept` — should answer the restored application summary
- [ ] [정상] `POST /applications/:id/decline` — should answer the cancelled application summary

### 통합 (실제 DB)

- [ ] [정상] `reaccept` — should restore status, appliedVersion and acceptedCount together in the database
- [ ] [경계] `reaccept` — should change nothing in the database when the seats are already full
- [ ] [정상] `declineVersionChange` — should leave no Penalty row and hold acceptedCount in the database

### 화면

- [ ] [정상] `ApplyPanel` — should show the before and after value of every changed field when the application is PENDING_REACCEPT
- [ ] [정상] `ReacceptPanel` — should send the reaccept request when 재동의 is pressed
- [ ] [정상] `ReacceptPanel` — should send the decline request when 거절 is pressed

---

## AC 대조

| AC                                                                                                 | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Given 재동의 대기 신청, When 화면을 열면, Then 변경 전/후 값이 나란히 보인다                       | `[정상] versionDiff — before/after snapshots`<br>`[정상] versionDiff — names only the changed fields`<br>`[예외] versionDiff — another applicant`<br>`[예외] versionDiff — not PENDING_REACCEPT`<br>`[예외] versionDiff — snapshot missing`<br>`[정상] GET version-diff — answers the diff`<br>`[정상] ApplyPanel — before/after side by side`                                                      |
| Given diff 화면, When 재동의하면, Then `appliedVersion`이 최신이 되고 **이전 상태로 복귀한다**     | `[정상] reaccept — APPLIED back to APPLIED`<br>`[정상] reaccept — stamps the current version`<br>`[경계] reaccept — acceptedCount alone for APPLIED`<br>`[예외] reaccept — second reaccept`<br>`[예외] reaccept — no previous status`<br>`[정상] POST reaccept — answers the summary`<br>`[정상] ReacceptPanel — sends reaccept`                                                                    |
| Given `ACCEPTED`였던 신청, When 재동의하면, Then 다시 `ACCEPTED`가 되고 확정 인원이 복구된다       | `[정상] reaccept — ACCEPTED back to ACCEPTED`<br>`[정상] reaccept — raises acceptedCount`<br>`[경계] reaccept — HEADCOUNT_FULL holds at PENDING_REACCEPT`<br>`[정상] reaccept — restores all three in the database`<br>`[경계] reaccept — changes nothing when full`                                                                                                                                |
| Given diff 화면, When 거절하면, Then `CANCELLED_BY_VERSION_CHANGE`가 되고 **경고가 쌓이지 않는다** | `[정상] declineVersionChange — moves to CANCELLED_BY_VERSION_CHANGE`<br>`[경계] declineVersionChange — acceptedCount alone`<br>`[예외] declineVersionChange — not PENDING_REACCEPT`<br>`[예외] declineVersionChange — another applicant`<br>`[정상] declineVersionChange — no Penalty row in the database`<br>`[정상] POST decline — answers the summary`<br>`[정상] ReacceptPanel — sends decline` |

**AC에 없는데 추가한 시나리오**

- `[예외] reaccept — carries no previous status` — `ADR-APP-3`의 컬럼이 비어 있으면
  **무엇으로 되돌릴지 알 수 없다.** 없는 값으로 되돌리는 대신 거부하는지 확인한다
- `[경계] declineVersionChange — acceptedCount alone` — 거절이 카운터를 또 내리면
  같은 자리가 두 번 비어 **정원보다 많은 사람이 확정된다.** AC4의 "경고가 쌓이지
  않는다"와 짝이 되는, 눈에 안 보이는 쪽의 무변화다
- `[예외] versionDiff — another applicant` — diff는 계약 내용이다. 남의 신청 id만
  알면 그 사람이 무슨 조건에 동의했는지 읽히면 안 된다

**커버리지:** AC 4개 / 시나리오 26개 / 미커버 0개
