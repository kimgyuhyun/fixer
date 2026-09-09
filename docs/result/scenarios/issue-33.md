# 이슈 #33 — 관리자가 제재를 조기 해제한다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/33
> PRD: `docs/result/prd/penalty-rating.md` · 사양: `spec-fixed.md` §5.1 §11.1 §11.4
> 담당: B · 선행 #25(경고 5건 → 제재) — 머지 완료
> 브랜치 `feat/penalty-rating/issue-33` (base: `main`)
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 이 이슈가 여는 자리

#25가 `Suspension`에 `releasedAt`·`releasedBy`·`releaseReason` 세 칸을 만들어 두고
**"해제 화면과 API는 #33이 붙인다"**고 주석으로 미뤄 둔 자리를 채운다. 판정
쿼리(`activeSuspensionWhere`)는 이미 `releasedAt IS NULL AND endAt > now()`로
돌고 있으므로, **이 이슈는 그 칸에 값을 쓰는 경로 하나를 만드는 것이다.**

마이그레이션은 필요 없다. 컬럼도 `NotificationType.SUSPENSION_RELEASED`도
이미 스키마에 있다 — #25와 #36이 각자 미리 넣어 두었다.

관리자 가드(guard, 요청이 컨트롤러에 닿기 전에 통과 여부를 판정하는 계층)와
`AdminAuditLog`는 #35가 만들어 두었고 **그대로 물려받는다.** 새로 만들지 않는다.

---

## 시그니처

### 관련 ADR

`docs/result/prd/penalty-rating.md` §3의 네 항목 중 이 이슈에 걸리는 것은
`ADR-PEN-4`(제재 해제 이력 표현) 하나인데, **`spec-fixed.md` §5.1이 이미
결론을 적어 두었다** — 별도 이력 테이블을 만들지 않고 `Suspension`에 세 칸을
더한다. 그 결정대로 #25가 컬럼을 만들었으므로 여기서 다시 고르지 않는다.

| ADR / 사양   | 이 이슈에 걸리는 부분                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `§5.1`       | 해제는 `releasedAt`을 찍는 것. **새 테이블 없이 `Suspension` 조회로 블랙리스트를 만든다**               |
| `§5.1`       | 유효 제재 판정은 `releasedAt IS NULL AND endAt > now()`. 이미 `activeSuspensionWhere`에 있고 재사용한다 |
| `§5.1`       | **해제해도 원본 `Penalty`는 유지한다.** 그래서 해제 경로는 `Penalty`를 읽기만 한다                      |
| `ADR-PEN-2`  | 제재 중 차단 지점은 서비스 계층. `JobPostService.create`의 `findActive` 한 줄이 AC4의 검증 지점이다     |
| `ADR-AUTH-3` | 상태 컬럼을 두 벌 만들지 않는다. `released` 불리언을 따로 두지 않고 `releasedAt` 하나로 판정한다        |
| `ADR-JOB-4`  | 목록 필터의 진실은 URL 쿼리스트링 하나                                                                  |
| `ADR-JOB-5`  | 오프셋 페이징(전체 건수를 함께 주는 페이징). 관리자 목록도 전체 건수가 필요하다                         |
| `ADR-NOT-1`  | 알림은 포트만 본다. 발행은 던지지 않으므로 해제 트랜잭션을 깨지 않는다                                  |

### 데이터

**스키마 변경 없음.** `Suspension`의 세 칸과 `NotificationType.SUSPENSION_RELEASED`,
`AdminAuditLog`가 모두 이미 있다. 새 마이그레이션 파일을 만들지 않는다.

### 공유 타입

```typescript
// packages/shared/src/admin.ts — 기존 파일에 추가

/** 감사 로그의 action 값. #35가 연 표에 이 이슈가 자기 값을 더한다 */
export const ADMIN_ACTIONS = {
  JOB_POST_FORCE_CANCEL: 'JOB_POST_FORCE_CANCEL',
  /** 관리자가 제재를 만료 전에 풀었다 (§11.4) */
  SUSPENSION_RELEASE: 'SUSPENSION_RELEASE',
} as const;

/**
 * 관리자 계층이 내는 에러 코드. **에러 클래스를 새로 만들지 않는다** —
 * 해제는 관리자 조치이고, 실패도 관리자 계층의 실패다.
 */
export const ADMIN_ERRORS = {
  FORBIDDEN: 'ADMIN_FORBIDDEN',
  REASON_REQUIRED: 'ADMIN_REASON_REQUIRED',
  /** 그런 제재 건이 없다 */
  SUSPENSION_NOT_FOUND: 'ADMIN_SUSPENSION_NOT_FOUND',
  /** 이미 풀린 제재다. 두 번 풀면 감사 로그가 두 줄 남는다 */
  SUSPENSION_ALREADY_RELEASED: 'ADMIN_SUSPENSION_ALREADY_RELEASED',
} as const;

/** 블랙리스트 한 페이지 건수. 공고 목록과 같은 20 */
export const ADMIN_SUSPENSION_PAGE_SIZE = 20;

/**
 * 블랙리스트 필터. (§11.4)
 *
 * **상태 필터가 없다.** 이 목록은 정의상 "현재 제재 중"만 보여준다 —
 * 해제된 이력 탭은 이 이슈 범위 밖이다.
 */
export const adminSuspensionFilterSchema = z.object({
  /** 회원 이름 부분 일치 (§11.4 "이름 검색") */
  q: z.string().trim().min(1).optional(),
  /** 1부터. 범위를 넘으면 오류가 아니라 빈 목록이다 (관리자 공고 목록과 같은 규칙) */
  page: z.coerce.number().int().min(1).catch(1).default(1),
});
export type AdminSuspensionFilter = z.infer<typeof adminSuspensionFilterSchema>;

/** 목록 한 줄. §11.4가 요구하는 다섯 칸이 그대로 필드다 */
export const adminSuspensionSummarySchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  /**
   * 사유 요약. **문자열이 아니라 코드 배열이다** — 문구를 서버가 만들면
   * 화면 문구를 바꿀 때 API를 고치게 된다. 라벨은 화면이 붙인다.
   */
  reasons: z.array(z.enum(PENALTY_REASONS)),
  /** 180일 창 안 누적 경고 수 (§11.4). 창 밖 경고는 세지 않는다 */
  penaltyCount: z.number().int(),
});
export type AdminSuspensionSummary = z.infer<
  typeof adminSuspensionSummarySchema
>;

export const adminSuspensionListSchema = z.object({
  items: z.array(adminSuspensionSummarySchema),
  /** **필터를 적용한 뒤의** 건수 (ADR-JOB-5) */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminSuspensionList = z.infer<typeof adminSuspensionListSchema>;

/** 해제 요청. **사유가 필수다** (§11.4) */
export const releaseSuspensionRequestSchema = z.object({
  reason: z.string().trim().min(1, { error: '해제 사유를 입력해 주세요.' }),
});
export type ReleaseSuspensionRequest = z.infer<
  typeof releaseSuspensionRequestSchema
>;

/** 해제 결과. AC3이 요구하는 두 값이 그대로 필드다 */
export const releaseSuspensionResultSchema = z.object({
  id: z.string(),
  userId: z.string(),
  releasedAt: z.iso.datetime(),
  releasedBy: z.string(),
});
export type ReleaseSuspensionResult = z.infer<
  typeof releaseSuspensionResultSchema
>;
```

### 서버

```typescript
// apps/api/src/admin/admin-suspension.service.ts (신규)

/** 목록 한 줄에 필요한 것들. 이름과 경고 집계를 함께 조인해서 온다 */
export interface AdminSuspensionRow {
  id: string;
  userId: string;
  userName: string;
  startAt: Date;
  endAt: Date;
  reasons: PenaltyReason[];
  penaltyCount: number;
}

/** 해제된 제재 한 건 */
export interface ReleasedSuspension {
  id: string;
  userId: string;
  releasedAt: Date;
  releasedBy: string;
}

export interface AdminSuspensionStore {
  /**
   * 지금 유효한 제재 한 페이지. **`activeSuspensionWhere`와 같은 조건이다.**
   *
   * 이름과 180일 창 안 경고 집계를 **함께** 준다. 목록을 그린 뒤 화면이
   * 따로 부르면 한 페이지에 스무 번을 더 부른다 (#35와 같은 판단).
   */
  listActive(
    filter: AdminSuspensionFilter,
    pageSize: number,
    now: Date,
  ): Promise<{ items: AdminSuspensionRow[]; total: number }>;

  /**
   * 조건부 해제. **`releasedAt IS NULL`인 행만 갱신한다.**
   *
   * 감사 로그를 **같은 트랜잭션에** 남긴다 (§11.5). 뒤에 따로 쓰면 그 사이에
   * 죽었을 때 "풀렸는데 누가 풀었는지 없는" 상태가 남는다.
   *
   * 이미 풀렸으면 `'ALREADY_RELEASED'`, 없으면 `'NOT_FOUND'`.
   * #16의 `cancelAndRelease`가 `'STALE'`을 돌려주는 것과 같은 모양이다.
   */
  release(input: {
    suspensionId: string;
    adminId: string;
    reason: string;
    now: Date;
  }): Promise<ReleasedSuspension | 'NOT_FOUND' | 'ALREADY_RELEASED'>;
}

@Injectable()
export class AdminSuspensionService {
  constructor(
    private readonly store: AdminSuspensionStore,
    private readonly notifications: NotificationPublisher,
  ) {}

  /** 현재 제재 중인 회원만. 해제된 건과 만료된 건은 안 나온다 (AC1) */
  list(filter: AdminSuspensionFilter): Promise<AdminSuspensionList>;

  /**
   * 사유를 남기고 조기 해제한다 (AC2·AC3).
   *
   * **`Penalty`는 건드리지 않는다** (AC5, §5.1). 경고 이력은 분쟁 대응
   * 근거라 남는다 — 이 메서드가 쓰는 것은 `Suspension` 세 칸뿐이다.
   */
  release(input: {
    adminId: string;
    suspensionId: string;
    reason: string;
  }): Promise<ReleaseSuspensionResult>;
}
```

```
GET  /admin/suspensions?q=&page=
  → 200  { items, total, page, pageSize }
  → 401  AUTH_UNAUTHENTICATED
  → 403  ADMIN_FORBIDDEN

POST /admin/suspensions/:id/release   { reason }
  → 200  { id, userId, releasedAt, releasedBy }
  → 400  ADMIN_REASON_REQUIRED                 사유가 비었다 (§11.4)
  → 401  AUTH_UNAUTHENTICATED                  Access·Refresh 둘 다 없음/만료
  → 403  ADMIN_FORBIDDEN                       role !== ADMIN
  → 404  ADMIN_SUSPENSION_NOT_FOUND            그런 제재 건이 없다
  → 409  ADMIN_SUSPENSION_ALREADY_RELEASED     이미 풀렸다
```

### 에러 케이스

| 상황                          | 에러 코드                           | HTTP |
| ----------------------------- | ----------------------------------- | ---- |
| 사유가 비었거나 공백뿐        | `ADMIN_REASON_REQUIRED`             | 400  |
| 로그인 안 됨                  | `AUTH_UNAUTHENTICATED`              | 401  |
| 로그인했지만 `role !== ADMIN` | `ADMIN_FORBIDDEN`                   | 403  |
| 그런 제재 건이 없다           | `ADMIN_SUSPENSION_NOT_FOUND`        | 404  |
| 이미 풀린 제재다              | `ADMIN_SUSPENSION_ALREADY_RELEASED` | 409  |

### 화면

```
apps/web/src/app/admin/suspensions/page.tsx               쿼리스트링이 진실 (ADR-JOB-4)
apps/web/src/app/admin/suspensions/AdminSuspensionList.tsx  표 + 이름 검색 + 해제 다이얼로그
apps/web/src/app/admin/suspensions/page.module.css
```

`middleware.ts`는 손대지 않는다 — `PROTECTED_PATHS`에 `/admin`이 이미 있다.

```typescript
export interface AdminSuspensionListProps {
  items: AdminSuspensionSummary[];
  total: number;
  page: number;
  pageSize: number;
  filter: AdminSuspensionFilter;
  /** 403을 받았다. 표 대신 안내를 그린다 */
  forbidden?: boolean;
}
```

표 정렬은 `css-standards` 규약을 따른다 — 이름·사유 요약은 좌측, 제재 시작·종료는
중앙, 누적 경고 수는 우측. sticky 헤더와 가로 스크롤을 붙인다.

---

## 판단이 갈렸던 지점

### 해제 실패 코드를 `ADMIN_ERRORS`에 넣는다

**결정:** `PENALTY_ERRORS`에 넣지 않고 `ADMIN_ERRORS`를 두 개 늘린다.

해제는 **관리자 조치**이고 그 실패도 관리자 계층의 실패다. `PENALTY_ERRORS.SUSPENDED`는
"제재 때문에 회원이 막혔다"는 회원용 코드라 성격이 다르다. 에러 클래스를 하나 더
만들지 않아도 되는 것은 덤이다 — 컨트롤러가 `AdminError` 하나만 코드로 분기한다.

### 이미 풀린 제재를 두 번 풀면 409다

**AC 어디에도 없어 판단이 필요했다.** 조용히 성공시키면(멱등) 감사 로그가 두 줄
남거나, 두 번째 로그를 막으려고 조건을 또 하나 두게 된다. 알림도 두 번 간다.
**409로 거절하고 아무것도 남기지 않는 쪽이 §11.5의 "누가·언제·왜"를 깨끗하게
유지한다.**

동시에 두 관리자가 눌러도 같은 결론이다 — 조건부 `UPDATE ... WHERE releasedAt IS NULL`이
하나만 이기고, 진 쪽은 409를 본다.

### 해제·감사 로그가 한 트랜잭션, 알림은 밖이다

#35가 취소·원장·감사 로그를 한 트랜잭션에 묶은 것과 같다. 알림만 밖인 이유는
`ADR-NOT-1`이다 — 발행은 던지지 않으므로 트랜잭션 안에 넣을 이유가 없고,
넣으면 알림 저장 실패가 해제를 되돌린다. #25의 `notifySuspension`이 이미
트랜잭션 밖이고 같은 자리에 맞춘다.

### 알림 `linkUrl`은 `/my/account`다

#25의 `SUSPENSION_STARTED`와 같은 경로를 쓴다. 제재 이력 화면은 아직 없고(#32),
**없는 경로를 넣으면 벨을 눌렀을 때 404가 뜬다** — 알림이 안 온 것보다 나쁘다.

### `reasons`를 문자열이 아니라 코드 배열로 준다

§11.4는 "사유 요약"이라고만 적었다. 서버가 "노쇼 3건, 당일취소 2건" 같은 문구를
만들면 **문구를 바꿀 때마다 API를 고치게 된다.** 코드 배열을 주고 라벨은 화면이
붙인다 — `AdminJobPostList`의 `STATUS_LABELS`와 같은 방식이다.

---

## 이 이슈에서 만들지 않는 것

| 미룬 것                                   | 이유                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **해제된 이력 별도 탭** (§11.4 마지막 줄) | AC1은 "현재 제재 중인 회원만 보인다"까지다. 조회 화면은 관리자 화면 넷이 다 생긴 뒤가 낫다 (#35와 같은 판단)  |
| **제재 기간 필터** (§11.4 "검색·필터")    | §11.2의 **공통** 목록 규약. 기간 필터는 회원·환전 목록에도 똑같이 필요해 #32가 공통 컴포넌트로 만들 때 붙인다 |
| 회원 상세로 이동하는 링크                 | #32가 만드는 화면이다. 없는 경로를 링크로 걸지 않는다                                                         |
| 관리자가 **제재를 새로 거는** 기능        | 제재는 자동 판정으로만 생긴다 (§5.1, PRD Out of Scope "관리자 수동 영구 차단 목록")                           |
| 해제 취소(되돌리기)                       | AC에 없다. `releasedAt`을 다시 null로 만드는 경로는 감사 로그의 의미를 깬다                                   |
| 제재 만료 배치                            | §5·§8.1이 명시적으로 "해제용 배치 잡은 없다"                                                                  |

---

## 테스트 시나리오

### 정상

- [ ] [정상] `AdminSuspensionService.list` — should return userName, startAt, endAt, reasons and penaltyCount for every active suspension
- [ ] [정상] `AdminSuspensionService.list` — should return only that member's row when q matches a member name partially and case-insensitively
- [ ] [정상] `AdminSuspensionService.release` — should record releasedAt, releasedBy and releaseReason on the suspension
- [ ] [정상] `AdminSuspensionService.release` — should publish a SUSPENSION_RELEASED notification to the released member
- [ ] [정상] `AdminSuspensionService.release` — should record an AdminAuditLog row carrying the admin id, the reason and the time
- [ ] [정상] `AdminSuspensionService.release` — should keep every Penalty row of the released member with its original reason and occurredAt
- [ ] [정상] `AdminSuspensionService.release` — should keep the released Suspension row instead of deleting it
- [ ] [정상] `JobPostService.create` — should create the post when the member's only suspension was released early
- [ ] [정상] `AdminSuspensionService.release` — should let the member post a job right after the admin releases the suspension
- [ ] [정상] `AdminSuspensionController` — should answer 200 with the list body when an admin calls the list endpoint
- [ ] [정상] `AdminSuspensionController` — should pass the session user id to release rather than any value from the request body
- [ ] [정상] `AdminSuspensionList` — should render name, start, end, reason summary and penalty count columns for each row

### 경계

- [ ] [경계] `AdminSuspensionService.list` — should exclude a suspension whose endAt has already passed
- [ ] [경계] `AdminSuspensionService.list` — should exclude a suspension that an admin already released
- [ ] [경계] `AdminSuspensionService.list` — should include a suspension whose endAt is one millisecond after now
- [ ] [경계] `AdminSuspensionService.list` — should count only the penalties inside the 180-day window as penaltyCount
- [ ] [경계] `AdminSuspensionService.release` — should release exactly once when the same suspension is released twice concurrently
- [ ] [경계] `AdminSuspensionService.release` — should leave the suspension unreleased when writing the audit log fails
- [ ] [경계] `AdminSuspensionService.release` — should keep the member's 180-day penalty count unchanged after the release
- [ ] [경계] `JobPostService.create` — should still block the member when a second suspension of theirs is still active
- [ ] [경계] `JobPostService.create` — should still block a member whose own suspension is untouched while another member's was released
- [ ] [경계] `adminSuspensionFilterSchema` — should fall back to page 1 when page is 0 or not a number

### 예외

- [ ] [예외] `AdminSuspensionService.release` — should throw ADMIN_REASON_REQUIRED when the reason is empty or only whitespace
- [ ] [예외] `AdminSuspensionService.release` — should leave releasedAt null when the reason is rejected
- [ ] [예외] `AdminSuspensionService.release` — should write no audit log and publish no notification when the reason is rejected
- [ ] [예외] `AdminSuspensionService.release` — should throw ADMIN_SUSPENSION_NOT_FOUND when the suspension does not exist
- [ ] [예외] `AdminSuspensionService.release` — should throw ADMIN_SUSPENSION_ALREADY_RELEASED when the suspension was already released
- [ ] [예외] `AdminSuspensionController` — should answer 400 with ADMIN_REASON_REQUIRED when the release body has no reason
- [ ] [예외] `AdminSuspensionController` — should answer 403 with ADMIN_FORBIDDEN when a non-admin calls the list endpoint
- [ ] [예외] `AdminSuspensionList` — should keep the confirm button disabled until a reason is typed
- [ ] [예외] `AdminSuspensionList` — should render a "권한이 없습니다" notice instead of the table when forbidden is true

---

## AC 대조

| AC                                                                                                 | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1** Given 관리자, When 블랙리스트를 열면, Then 현재 제재 중인 회원만 보인다                    | `[정상] list — should return userName, startAt, endAt, reasons and penaltyCount`<br>`[정상] list — should return only that member's row when q matches`<br>`[경계] list — should exclude a suspension whose endAt has already passed`<br>`[경계] list — should exclude a suspension that an admin already released`<br>`[경계] list — should include ... one millisecond after now`<br>`[경계] adminSuspensionFilterSchema — page fallback`<br>`[정상] AdminSuspensionController — 200 with the list body`<br>`[예외] AdminSuspensionController — 403 ADMIN_FORBIDDEN`<br>`[정상] AdminSuspensionList — should render ... columns`<br>`[예외] AdminSuspensionList — "권한이 없습니다" notice` |
| **AC2** Given 제재 건, When 사유 없이 해제하면, Then 막힌다 (사유 필수)                            | `[예외] release — should throw ADMIN_REASON_REQUIRED when the reason is empty or only whitespace`<br>`[예외] release — should leave releasedAt null when the reason is rejected`<br>`[예외] release — should write no audit log and publish no notification`<br>`[예외] AdminSuspensionController — 400 ADMIN_REASON_REQUIRED`<br>`[예외] AdminSuspensionList — confirm button disabled until a reason is typed`                                                                                                                                                                                                                                                                              |
| **AC3** Given 사유를 적고 해제하면, Then `releasedAt`·`releasedBy`가 기록되고 회원에게 알림이 간다 | `[정상] release — should record releasedAt, releasedBy and releaseReason`<br>`[정상] release — should publish a SUSPENSION_RELEASED notification`<br>`[정상] release — should record an AdminAuditLog row`<br>`[정상] AdminSuspensionController — should pass the session user id to release`<br>`[경계] release — exactly once when released twice concurrently`<br>`[경계] release — unreleased when writing the audit log fails`<br>`[예외] release — ADMIN_SUSPENSION_NOT_FOUND`<br>`[예외] release — ADMIN_SUSPENSION_ALREADY_RELEASED`                                                                                                                                                  |
| **AC4** Given 해제된 회원, When 공고를 등록하면, Then 성공한다                                     | `[정상] JobPostService.create — should create the post when the member's only suspension was released early`<br>`[정상] release — should let the member post a job right after the admin releases the suspension`<br>`[경계] JobPostService.create — should still block ... a second suspension is still active`<br>`[경계] JobPostService.create — should still block a member whose own suspension is untouched`                                                                                                                                                                                                                                                                            |
| **AC5** Given 해제된 회원, When 원본 경고 이력을 보면, Then `Penalty`는 그대로 남아 있다           | `[정상] release — should keep every Penalty row of the released member with its original reason and occurredAt`<br>`[정상] release — should keep the released Suspension row instead of deleting it`<br>`[경계] release — should keep the member's 180-day penalty count unchanged after the release`<br>`[경계] list — should count only the penalties inside the 180-day window as penaltyCount`                                                                                                                                                                                                                                                                                            |

**커버리지:** AC 5개 / 시나리오 31개 / 미커버 0개

### AC에 없는데 넣은 시나리오

| 시나리오                                                | 왜 넣었나                                                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `AdminSuspensionController` 403 · 200                   | AC1의 "관리자"가 실제로 가드를 통과한 관리자인지를 본다. #35가 만든 가드를 이 컨트롤러가 제대로 물려받았는지가 여기서만 증명된다 |
| `release` 감사 로그 3개 (기록·실패 롤백·거절 시 무기록) | §11.5가 "모든 관리자 조치는 `AdminAuditLog`에 기록한다"고 정했다. AC3의 "누가 풀었나"가 감사 로그로만 추적된다                   |
| `release` 동시 해제 · 409 · 404                         | 판단이 갈렸던 지점. 결정한 규칙(두 번 풀리지 않는다)을 테스트로 못 박는다                                                        |
| `adminSuspensionFilterSchema` page 폴백                 | 관리자 공고 목록이 이미 "잘못된 page는 오류가 아니라 1"이다. 블랙리스트만 다르면 안 된다                                         |
| `list` penaltyCount 창 집계                             | §11.4의 컬럼이 "누적 경고 수"인데 **180일 창 기준이 아니면 §11.3의 회원 목록과 숫자가 어긋난다**                                 |
