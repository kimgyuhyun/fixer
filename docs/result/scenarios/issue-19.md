# 이슈 #19 — 구인자가 지원자를 거절한다

> GitHub: https://github.com/Ikara777/fixer/issues/19
> PRD: `docs/result/prd/application.md`
> 담당: B (김규현)
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 시그니처

### 관련 ADR

**이 이슈는 새 ADR을 열지 않는다.** 필요한 결정이 이미 다 내려져 있다.

| 따르는 것                              | 내용                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `spec-fixed.md` §4.2 · PRD §5 상태머신 | `APPLIED → REJECTED`가 표에 있고 `ACCEPTED → REJECTED`는 **없다.** AC3의 서버 쪽 방어가 그 사실 하나다                            |
| `ADR-APP-1` (#18 확정)                 | 카운터를 내리는 것은 **취소를 만드는 이슈**의 몫이다. #19는 `APPLIED`만 거절하므로 **올린 적이 없어 내릴 것도 없다**              |
| `ADR-NOT-1` (#36 확정)                 | 알림은 `NotificationPublisher` 포트로만 발행한다. `NOTIFICATION_TYPES`에 `'APPLICATION_REJECTED'`가 **#19 몫으로 이미 들어 있다** |
| #18 `issue-18.md`                      | "`EMPLOYER_VISIBLE_STATUSES`에 #19가 `REJECTED` 한 줄을 더한다"                                                                   |

**알림 인프라를 새로 만들지 않는다.** #36이 이미 `NotificationPublisher`를 만들어
두었고, 그 인터페이스 주석이 `#19(거절)`를 **이름으로** 지목하고 있다. #30
(계좌 검증)이 같은 포트를 그대로 주입받아 쓰는 것을 그대로 따른다.

### 스키마 변경

**없다.** `Application.status`는 이미 `REJECTED`를 값으로 갖고, 새 컬럼도 새
저장소 메서드도 필요 없다 — `updateStatus`(#17)가 `expectedStatus`를 `WHERE`에
거는 조건부 UPDATE라 `APPLIED → REJECTED`에 그대로 쓰인다.

### 타입

```typescript
// packages/shared/src/application.ts

/** 거절 요청. 회원 식별은 #17·#18과 같이 아직 본문으로 받는다 (#19) */
export const rejectApplicationRequestSchema = z.object({
  employerId: z.string().min(1, { error: '구인자를 알 수 없습니다.' }),
});
export type RejectApplicationRequest = z.infer<
  typeof rejectApplicationRequestSchema
>;

/** 구인자에게 보이는 상태. **#19가 `REJECTED`를 더한다** */
export const EMPLOYER_VISIBLE_STATUSES = [
  'APPLIED',
  'ACCEPTED',
  'REJECTED', // ← #19
] as const satisfies readonly ApplicationStatus[];
```

```typescript
// apps/api/src/application/application.service.ts

export class ApplicationService {
  constructor(
    private readonly store: ApplicationStore,
    private readonly jobPosts: JobPostReader,
    private readonly profiles: ApplicantProfileReader,
    /** 거절을 신청자에게 알린다 (#19 AC1). 포트만 본다 — 인앱인지 메일인지 모른다 */
    private readonly notifications: NotificationPublisher, // ← #19
  ) {}

  /**
   * 구인자가 지원자 한 명을 거절한다 (#19).
   *
   * `APPLIED`만 거절할 수 있다. `ACCEPTED`는 **계약이 이미 체결된 것**이라
   * 취소 규칙(#20)을 따라야 하고, 그 금지는 전이표에 없다는 사실로 표현된다.
   */
  reject(input: {
    employerId: string;
    applicationId: string;
  }): Promise<ApplicationSummary>;
}
```

발행하는 알림은 하나뿐이다.

```typescript
{
  userId: 신청자,
  type: 'APPLICATION_REJECTED',
  title: '지원이 거절되었습니다',
  body: '다른 공고에 지원해 보세요.',
  linkUrl: `/job-posts/${jobPostId}`,
}
```

`linkUrl`에 **id를 끼워 넣는 첫 발행자다.** `notificationItemSchema.linkUrl`이
`startsWith('/')`를 요구하는 이유가 여기 있다고 #36이 적어 두었다 — 절대 URL이
들어가면 화면의 `router.push`가 외부 사이트로 튄다(오픈 리다이렉트).

### 에러 케이스

| 상황                                            | 에러 코드                        | HTTP |
| ----------------------------------------------- | -------------------------------- | ---- |
| 그런 신청이 없다                                | `APPLICATION_NOT_FOUND`          | 404  |
| 공고가 없다 / 소프트 삭제됐다                   | `JOB_POST_NOT_FOUND`             | 404  |
| 그 공고의 구인자가 아니다                       | `APPLICATION_NOT_EMPLOYER`       | 403  |
| `APPLIED`가 아닌 신청을 거절 (AC3의 `ACCEPTED`) | `APPLICATION_INVALID_TRANSITION` | 409  |
| 거절된 신청에 다시 지원 (AC2)                   | `APPLICATION_ALREADY_APPLIED`    | 409  |
| 요청 형식이 틀렸다                              | (zod)                            | 400  |

### HTTP — `@Controller('applications')`

| 메서드 | 경로                                            | 성공 코드 |
| ------ | ----------------------------------------------- | --------- |
| `POST` | `/applications/:id/reject` (본문: `employerId`) | 200       |

### 컴포넌트 Props

`ApplicantList`의 Props는 **그대로다** (`{ jobPostId: string }`). 행마다 버튼이
하나 늘고 상태 문구가 하나 는다.

| 조건              | 수락 버튼   | 거절 버튼 |
| ----------------- | ----------- | --------- |
| 상태가 `APPLIED`  | 자리 있으면 | 있음      |
| 상태가 `ACCEPTED` | 없음        | 없음      |
| 상태가 `REJECTED` | 없음        | 없음      |

거절 버튼은 **정원과 무관하다.** 정원이 찼다고 거절을 못 하게 하면, 정원이 찬
공고에 남은 지원자들이 영원히 `APPLIED`로 떠 있게 된다.

### 판단이 갈렸던 지점

| 갈림길                                             | 고른 것                   | 이유                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC2를 새 에러 코드로 vs `ALREADY_APPLIED` 재사용   | **재사용**                | #17의 `reviveOrReject`가 이미 `WITHDRAWN`이 아닌 모든 상태를 막는다. AC가 요구하는 것은 "막힌다" 하나이고, 코드를 더하면 컨트롤러 분기·문구표·화면이 함께 바뀐다           |
| 거절도 공고가 `OPEN`이어야 하나                    | **상태를 보지 않는다**    | 수락이 `OPEN`을 요구하는 이유는 **돈**이다(취소된 공고는 `RELEASE`로 이미 풀렸다). 거절은 돈도 정원도 안 건드린다. 요구하면 마감된 공고에 남은 지원자를 정리할 길이 막힌다 |
| 새 저장소 메서드 `reject` vs `updateStatus` 재사용 | **`updateStatus` 재사용** | 조건부 UPDATE 한 문장이면 되고, 카운터가 함께 움직이지 않아 트랜잭션이 필요 없다. #18의 `accept`가 전용 메서드인 이유는 **두 문장이 함께 커밋돼야** 했기 때문이다          |
| 거절 사유 입력받기                                 | **안 받는다**             | AC에 없다. PRD Out of Scope의 "구인자-구직자 메시지"와 같은 방향이다                                                                                                       |
| 알림을 상태 변경 전에 vs 후에                      | **후에**                  | 먼저 알리면 저장이 실패했을 때 "거절됐다"는 알림만 남는다. #30이 같은 판단을 했다                                                                                          |
| `REJECTED`를 구인자 목록에 보이기 vs 감추기        | **보인다**                | #18이 그렇게 미뤄 뒀다. 감추면 구인자가 **같은 사람을 두 번 검토하게** 된다 — 목록에서 사라진 사람이 왜 다시 지원을 못 하는지도 알 수 없다                                 |

### 이 이슈에서 만들지 않는 것

| 안 만드는 것                      | 어디로                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| 거절 **이메일** 병행 발송         | #37. `spec-fixed.md` §8이 "수락 / 거절"을 메일 병행 대상에 넣었지만, 그 인프라가 #37이다       |
| `ACCEPTED`를 무르는 길 (취소)     | #20. AC3이 명시적으로 "취소 규칙을 따라야 하므로" 막으라고 한다                                |
| `acceptedCount` **감소**          | #20·#21. `APPLIED`는 카운터를 올린 적이 없다                                                   |
| 일괄 거절 / 남은 지원자 자동 거절 | AC에 없다. 정원이 차도 공고를 자동으로 닫지 않기로 한 `ADR-APP-1`의 결정과 같은 결을 따른다    |
| 신청자 화면의 "거절됨" 표시       | 구직자 쪽 목록 화면 자체가 아직 없다. `GET /applications/me`가 상태를 그대로 내려주고 있다     |
| 통합 테스트                       | 새 저장소 메서드도 새 컬럼도 없다. `updateStatus`와 `listByJobPost`는 #17·#18이 이미 못 박았다 |

---

## 테스트 시나리오

### 정상

- [x] [정상] `reject` — should move the application from APPLIED to REJECTED
- [x] [정상] `reject` — should publish an APPLICATION_REJECTED notification to the applicant
- [x] [정상] `reject` — should leave the job post's acceptedCount unchanged
- [x] [정상] `listForEmployer` — should include REJECTED applicants in the list
- [x] [정상] `POST /applications/:id/reject` — should respond 200 with status REJECTED
- [x] [정상] `ApplicantList` — should render a 거절 button only for the APPLIED applicant when the list also has an ACCEPTED one

### 경계

- [x] [경계] `reject` — should point the notification link at the job post the applicant was rejected from
- [x] [경계] `reject` — should publish exactly one notification when the same application is rejected twice
- [x] [경계] `apply` — should throw APPLICATION_ALREADY_APPLIED when the applicant re-applies after being rejected
- [x] [경계] `reject` — should succeed when the job post is no longer OPEN
- [x] [경계] `ApplicantList` — should render 거절됨 for a REJECTED applicant

### 예외

- [x] [예외] `reject` — should throw APPLICATION_INVALID_TRANSITION when the application is ACCEPTED
- [x] [예외] `reject` — should not publish a notification when the application is ACCEPTED
- [x] [예외] `reject` — should throw APPLICATION_NOT_FOUND when no application has that id
- [x] [예외] `reject` — should throw APPLICATION_NOT_EMPLOYER when the caller does not own the job post
- [x] [예외] `POST /applications/:id/reject` — should respond 409 when the error code is APPLICATION_INVALID_TRANSITION
- [x] [예외] `POST /applications/:id/reject` — should respond 400 when the body has no employerId

---

## AC 대조

| AC                                                                         | 커버하는 시나리오                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1** `APPLIED` 신청을 거절하면 `REJECTED`가 되고 신청자에게 알림이 간다 | `[정상] reject — should move ... APPLIED to REJECTED`<br>`[정상] reject — should publish an APPLICATION_REJECTED notification to the applicant`<br>`[경계] reject — should point the notification link at the job post ...`<br>`[정상] POST /applications/:id/reject — 200 ...`<br>`[정상] ApplicantList — 거절 button` |
| **AC2** 거절된 신청은 같은 공고에 다시 지원해도 막힌다                     | `[경계] apply — should throw APPLICATION_ALREADY_APPLIED when the applicant re-applies after being rejected`                                                                                                                                                                                                            |
| **AC3** `ACCEPTED` 신청을 거절하면 막힌다 (취소 규칙을 따라야 하므로)      | `[예외] reject — should throw APPLICATION_INVALID_TRANSITION when the application is ACCEPTED`<br>`[예외] reject — should not publish a notification when the application is ACCEPTED`<br>`[예외] POST /applications/:id/reject — 409 ...`<br>`[정상] ApplicantList — 거절 button only for the APPLIED applicant`       |

### AC에 없는데 추가한 시나리오

| 시나리오                                                       | 왜 넣었나                                                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reject` — `acceptedCount` 불변                                | `ADR-APP-1`이 "내리는 쪽은 취소 이슈"라고 정해 뒀다. 거절에서 실수로 감소를 넣으면 **아무도 안 쓴 자리가 정원에 생긴다** — 그리고 어떤 AC도 그걸 잡지 않는다 |
| `reject` — 같은 신청 두 번 거절 시 알림 1건                    | 조건부 UPDATE가 `'STALE'`을 돌려준 뒤에도 알림을 쏘면, 버튼 연타 한 번에 알림이 두 개 간다. **성공했을 때만 알린다**는 순서를 이 시나리오가 지킨다           |
| `reject` — 공고가 `OPEN`이 아니어도 성공                       | 위 "판단이 갈렸던 지점"의 결정을 못 박는다. 나중에 수락과 모양을 맞추려고 `OPEN` 검사를 복붙하면 여기서 빨개진다                                             |
| `reject` — 신청 없음 → `NOT_FOUND`, 남의 공고 → `NOT_EMPLOYER` | 거절 API도 `applicationId`만 받는다. 주인 확인이 없으면 **id만 알면 남의 공고 지원자를 떨어뜨릴 수 있다**                                                    |
| `listForEmployer` — `REJECTED` 포함                            | #18이 미뤄 둔 한 줄이다. 안 더하면 거절한 사람이 목록에서 **사라지고**, 구인자는 그 사람이 왜 다시 지원을 못 하는지 알 수 없다                               |
| `ApplicantList` — `거절됨` 문구                                | `STATUS_LABELS`에 줄을 안 더하면 화면에 영문 `REJECTED`가 그대로 나온다. 목록에 `REJECTED`를 넣기로 한 결정이 화면까지 닿는지 확인한다                       |
| `POST .../reject` — `employerId` 없으면 400                    | 컨트롤러가 본문에서 문자열을 꺼낸다. 없을 때 500이 나면 원인을 화면에서 알 수 없다                                                                           |

**커버리지:** AC 3개 / 시나리오 17개 / 미커버 0개

---

### ⚠️ 배포 전 재판정 — `employerId`를 본문에서 그대로 받는 상태 변경 API가 하나 더 늘었다

`/security-review 19`에서 나왔다. **🟡 권장 수정이고 이 이슈에서 고치지 않는다.**

`POST /applications/:id/reject`는 `employerId`를 **본문에서 그대로 받는다.**
소유 확인(`mustOwn`)은 그 값과 공고 주인을 비교할 뿐이라, **남의 `employerId`와
`applicationId`를 알면 그 사람 공고의 지원자를 떨어뜨릴 수 있다.**

원인은 #19가 아니다. #4의 토큰 주체 배선이 끝나기 전까지 #12 이후 모든
엔드포인트가 같은 임시 방편을 쓰고 있고, 시그니처 게이트에서 그대로 따르기로
합의한 내용이다. `POST .../accept`가 이미 같은 노출 면을 갖고 있고, 그쪽이
**돈이 잠기는 계약을 체결시키므로** 피해가 더 크다.

|                 |                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------- |
| **해소 조건**   | #4의 토큰 주체가 `employerId`를 대체하면 사라진다                                         |
| **재판정 시점** | **첫 배포 직전.** `issue-18.md`의 같은 항목, `security-exceptions.md` 4번과 같은 성격이다 |

> 이 줄만으로 새 위험이 생긴 것은 아니다. **이미 열린 문에 손잡이가 하나 더
> 달린 것**이고, 문을 닫는 것은 #4다.

### 의존성 점검

`pnpm audit` 9건 전부 `security-exceptions.md`에 이미 판정돼 있다
(`deepmerge-ts` 1 · `mysql2` 2 · `fast-uri` 4 · `qs` 2). **새로 추가된 항목은
없다** — 이 이슈는 의존성을 하나도 건드리지 않았다.
