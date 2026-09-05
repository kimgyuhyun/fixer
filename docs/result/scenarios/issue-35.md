# 이슈 #35 — 관리자가 공고를 검색해 강제 취소한다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/35
> PRD: `docs/result/prd/job-post.md` · 사양: `spec-fixed.md` §11.1 §11.2 §11.6
> 담당: B · 선행 #13(공고 목록·필터) · #16(공고 취소) — 둘 다 머지 완료
> 브랜치 `feat/job-post/issue-35` (base: `main`)
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 이 이슈가 여는 자리

`schema.prisma`의 `User` 주석이 **"role은 ADR-AUTH-3이 확정된 뒤에 붙인다"**고 미뤄둔
자리를 이 이슈가 채운다. ADR-AUTH-3은 2026-09-03에 확정됐고, `deactivatedAt`·
`purgedAt`은 이미 붙었다. 남은 것이 `role` 하나다.

**관리자 가드(guard, 요청이 컨트롤러에 닿기 전에 통과 여부를 판정하는 계층)를 이
이슈가 처음 만든다.** #32(회원 관리)·#33(제재 해제)·#34(환전 승인)가 그대로
물려받으므로, 여기서 정한 모양이 관리자 화면 넷 전부의 모양이 된다.

`AdminAuditLog`도 여기서 처음 생긴다. `spec-fixed.md` §11.5가 **"모든 관리자
조치는 `AdminAuditLog`에 기록한다"**고 정했고, `retention.ts`가 보관 3년으로
이미 이름을 예고해 두었다.

---

## 시그니처

### 관련 ADR

| ADR          | 이 이슈에 걸리는 부분                                                                         |
| ------------ | --------------------------------------------------------------------------------------------- |
| `ADR-AUTH-3` | 상태를 컬럼으로 두 벌 만들지 않는다. **`role`을 토큰에 복사하지 않는 판단의 근거**            |
| `ADR-JOB-3`  | 상태 전이는 전이표 + 공용 `transition()`. 강제 취소도 표를 그대로 탄다                        |
| `ADR-JOB-4`  | 목록 필터의 진실은 URL 쿼리스트링 하나                                                        |
| `ADR-JOB-5`  | 복합 인덱스 + 오프셋 페이징(전체 건수를 함께 주는 페이징). 관리자 목록도 전체 건수가 필요하다 |
| `ADR-PAY-7`  | 잠긴 금액은 **원장에서 계산한다.** 예산에서 다시 계산하지 않는다                              |

### 데이터

```prisma
/// 관리자는 별도 테이블이 아니라 이 컬럼으로 구분한다 (spec §11.1).
/// ADR-AUTH-3이 확정되며 열린 자리다.
enum UserRole {
  USER
  ADMIN
}

model User {
  // ...기존 그대로
  /// 관리자 여부. 화면에서 관리자를 만드는 기능은 두지 않는다 — seed로만 만든다.
  role UserRole @default(USER)

  adminAuditLogs AdminAuditLog[]
}

/// 관리자 조치 기록. (spec §11.5 "누가·언제·무엇을·왜")
///
/// **레코드를 지우지 않는다.** 분쟁 대응 근거다 — `Penalty`와 같은 이유이고
/// 보관 기간도 같은 3년이다 (`RETENTION.DISPUTE_MS`).
///
/// #33(제재 해제)·#34(환전 승인·계좌 열람)가 같은 표에 쌓는다. 그래서
/// action·targetType을 문자열로 두고 도메인별 표를 나누지 않는다.
model AdminAuditLog {
  id         String   @id @default(cuid())
  adminId    String
  /// 무엇을 했나. 예: `JOB_POST_FORCE_CANCEL`
  action     String
  /// 무엇에 했나. 예: `JobPost`
  targetType String
  targetId   String
  /// 왜. 강제 취소는 필수지만, #34의 계좌번호 열람처럼 사유가 없는 조치도
  /// 있어 컬럼 자체는 nullable이다. 필수 여부는 조치별로 서비스가 판정한다.
  reason     String?
  createdAt  DateTime @default(now())

  admin User @relation(fields: [adminId], references: [id])

  /// "이 공고에 무슨 조치가 있었나"를 이 인덱스로 찾는다 (AC4)
  @@index([targetType, targetId])
  /// "이 관리자가 무엇을 했나"
  @@index([adminId, createdAt])
}
```

최초 관리자는 `apps/api/prisma/seed.ts`가 만든다. **화면에서 관리자를 만드는
기능은 두지 않는다** (§11.1).

### 공유 타입

```typescript
// packages/shared/src/admin.ts (신규)

/** 회원 등급. `schema.prisma`의 `UserRole`과 같아야 한다 */
export const USER_ROLES = ['USER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** 관리자 계층이 내는 에러 코드 */
export const ADMIN_ERRORS = {
  /** 토큰이 없거나 위조·만료됐다 */
  UNAUTHENTICATED: 'ADMIN_UNAUTHENTICATED',
  /** 로그인은 됐지만 관리자가 아니다 */
  FORBIDDEN: 'ADMIN_FORBIDDEN',
  /** 사유가 필수인 조치인데 비었다 (§11.6) */
  REASON_REQUIRED: 'ADMIN_REASON_REQUIRED',
} as const;
export type AdminErrorCode = (typeof ADMIN_ERRORS)[keyof typeof ADMIN_ERRORS];

/** 감사 로그의 action 값. 문자열을 손으로 적지 않게 한 곳에 모은다 */
export const ADMIN_ACTIONS = {
  JOB_POST_FORCE_CANCEL: 'JOB_POST_FORCE_CANCEL',
} as const;

/**
 * 관리자 공고 목록 필터.
 *
 * 일반 목록(`jobPostFilterSchema`)과 나눈 이유가 둘이다. 관리자는 **`OPEN`이
 * 아닌 공고도 봐야 하고**, 검색어가 제목뿐 아니라 **구인자 이름**에도 걸린다.
 */
export const adminJobPostFilterSchema = z.object({
  /** 제목 **또는** 구인자 이름 부분 일치 (AC2) */
  q: z.string().trim().min(1).optional(),
  /** 없으면 전부. 관리자 목록은 OPEN만 보는 화면이 아니다 */
  status: z.enum(JOB_POST_STATUSES).optional(),
  category: z.string().trim().min(1).optional(),
  /** 1부터. 범위를 넘으면 오류가 아니라 빈 목록이다 (일반 목록과 같은 규칙) */
  page: z.coerce.number().int().min(1).catch(1).default(1),
});
export type AdminJobPostFilter = z.infer<typeof adminJobPostFilterSchema>;

/** 목록 한 줄. AC1이 요구하는 다섯 칸이 그대로 필드다 */
export const adminJobPostSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  employerName: z.string(),
  categoryName: z.string(),
  status: z.enum(JOB_POST_STATUSES),
  createdAt: z.iso.datetime(),
});
export type AdminJobPostSummary = z.infer<typeof adminJobPostSummarySchema>;

export const adminJobPostListSchema = z.object({
  items: z.array(adminJobPostSummarySchema),
  /** **필터를 적용한 뒤의** 건수 (ADR-JOB-5) */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminJobPostList = z.infer<typeof adminJobPostListSchema>;

/** 강제 취소 요청. 사유가 필수다 (§11.6) */
export const forceCancelRequestSchema = z.object({
  reason: z.string().trim().min(1, { error: '취소 사유를 입력해 주세요.' }),
});
export type ForceCancelRequest = z.infer<typeof forceCancelRequestSchema>;

/** 필터를 URL 쿼리스트링으로. 빈 값과 page=1은 넣지 않는다 (ADR-JOB-4) */
export function adminFilterToQuery(filter: AdminJobPostFilter): string;
```

### 관리자 가드

```typescript
// apps/api/src/admin/admin.guard.ts

/** 가드를 통과한 요청에 심어 두는 주체. 감사 로그의 "누가"가 여기서 온다 */
export interface AdminPrincipal {
  userId: string;
}

/**
 * role을 묻는 포트(port, 바깥 세계와 닿는 자리를 인터페이스로 끊어 둔 것).
 *
 * 가드가 Prisma를 직접 알면 가드 테스트에 DB가 필요해진다.
 */
export interface RoleReader {
  /** 그 회원의 등급. 없는 회원이면 null */
  roleOf(userId: string): Promise<UserRole | null>;
}

/**
 * 관리자만 통과시킨다. (spec §11.1)
 *
 * 쿠키의 Access 토큰 → `sub` → **DB의 `role`** 순으로 판정한다.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly tokens: AccessTokenSigner,
    private readonly roles: RoleReader,
  ) {}
  canActivate(context: ExecutionContext): Promise<boolean>;
}

/** 컨트롤러가 관리자 id를 꺼내는 파라미터 데코레이터 */
export const CurrentAdmin: () => ParameterDecorator;
```

### 서버

```typescript
// apps/api/src/admin/admin-job-post.service.ts

export class AdminError extends Error {
  constructor(readonly code: AdminErrorCode) { ... }
}

class AdminJobPostService {
  /** 상태 무관 전체 목록. 검색어는 제목과 구인자 이름 양쪽에 걸린다 */
  list(filter: AdminJobPostFilter): Promise<AdminJobPostList>;

  /** 사유를 남기고 강제 취소한다. 잠긴 포인트는 전액 되돌아간다 */
  forceCancel(input: {
    adminId: string;
    jobPostId: string;
    reason: string;
  }): Promise<CancelJobPostResult>;
}
```

```
GET  /admin/job-posts?q=&status=&category=&page=
  → 200  { items, total, page, pageSize }
  → 401  ADMIN_UNAUTHENTICATED
  → 403  ADMIN_FORBIDDEN

POST /admin/job-posts/:id/cancel   { reason }
  → 200  { id, status: 'CANCELLED', released, penalized }
  → 400  ADMIN_REASON_REQUIRED         사유가 비었다 (§11.6)
  → 401  ADMIN_UNAUTHENTICATED         토큰 없음·위조·만료
  → 403  ADMIN_FORBIDDEN               role !== ADMIN
  → 404  JOB_POST_NOT_FOUND            없거나 소프트 삭제됐다
  → 409  JOB_POST_INVALID_TRANSITION   DRAFT·COMPLETED·EXPIRED·이미 CANCELLED
```

### 저장소

새 포트 하나와, #16 포트의 인자 하나 추가다.

```typescript
// apps/api/src/admin/admin-job-post.store.ts (신규 포트)
export interface AdminJobPostStore {
  /**
   * 상태 무관 한 페이지. 구인자 이름과 카테고리 이름을 **함께 조인해서** 준다.
   *
   * 목록을 그린 뒤 화면이 이름을 따로 불러오면 한 페이지에 20번을 더 부른다.
   */
  listAll(
    filter: AdminJobPostFilter,
    pageSize: number,
  ): Promise<{
    items: (JobPostRecord & { employerName: string; categoryName: string })[];
    total: number;
  }>;
}
```

```typescript
// apps/api/src/job-post/job-post.service.ts — JobPostStore.cancelAndRelease
cancelAndRelease(input: {
  // ...기존 인자 그대로
  /**
   * 관리자 강제 취소면 감사 로그를 **같은 트랜잭션에** 남긴다 (AC4).
   *
   * 뒤에 따로 쓰면 그 사이에 죽었을 때 조치가 증발한다. 취소는 됐는데
   * 누가 왜 했는지가 없는 상태가 AC4가 막으려는 바로 그것이다.
   */
  audit?: { adminId: string; reason: string };
}): Promise<{ released: number; alreadyReleased: boolean } | 'STALE'>;
```

### 화면

```
apps/web/src/app/admin/job-posts/page.tsx              서버 컴포넌트. 쿼리스트링이 진실 (ADR-JOB-4)
apps/web/src/app/admin/job-posts/AdminJobPostList.tsx  표 + 검색 + 강제 취소 다이얼로그
apps/web/src/app/admin/job-posts/page.module.css
apps/web/src/middleware.ts                             PROTECTED_PATHS에 '/admin' 추가
```

```typescript
interface AdminJobPostListProps {
  items: AdminJobPostSummary[];
  total: number;
  page: number;
  pageSize: number;
  filter: AdminJobPostFilter;
  /** 403을 받았다. 표 대신 안내를 그린다 */
  forbidden?: boolean;
}
```

표 정렬은 `css-standards` 규약을 따른다 — 제목·구인자·카테고리는 좌측, 상태는
중앙, 등록일은 우측. sticky 헤더와 가로 스크롤을 붙인다.

---

## 판단이 갈렸던 지점

### `role`을 토큰에 복사하지 않는다

**결정:** 가드가 요청마다 DB에서 `role`을 읽는다.

토큰에 넣으면 조회가 없어지지만 **숫자가 두 벌**이 된다. 권한을 회수당한
관리자가 토큰 수명 15분 동안 계속 관리자로 통한다. ADR-AUTH-3이 `status`
컬럼을 기각한 이유(_진실은 한 곳에_)가 그대로 적용된다. 관리자 요청은 양이
적어 조회 1회가 싸다.

**대가:** Next.js middleware가 `role`을 볼 수 없다. §11.1은 "Nest Guard +
middleware 양쪽"을 요구하는데, **middleware는 로그인 여부까지만** 막고 실제
권한 판정은 가드 한 곳이 한다. 일반 회원이 `/admin/job-posts`를 열면 화면
껍데기는 뜨고 API가 403을 주며, 화면은 "권한이 없습니다"를 그린다.
데이터는 한 줄도 가지 않는다.

### 강제 취소도 수락자가 있으면 경고를 쌓는다

**AC 4줄 어디에도 없어 판단이 필요했다.** #16(구인자 본인 취소)과 같은 규칙을
쓴다 — 수락된 구직자가 있으면 구인자에게 `POSTER_CANCEL` 1건.

일하기로 한 사람 입장에서는 **누가 버튼을 눌렀든 똑같이 약속이 깨진 것**이다.
규칙을 갈라두면 "관리자가 취소하면 경고가 없다"는 회피 경로가 생긴다.

### 취소·해제·감사 로그가 한 트랜잭션이다

#16이 상태와 원장을 한 트랜잭션에 묶은 것과 같은 이유다. 여기에 감사 로그가
하나 더 들어간다. 셋 중 하나만 되면 AC3이나 AC4가 깨진다.

### 멱등 키는 #16과 같은 `cancel:{jobPostId}`를 쓴다

관리자가 취소하든 구인자가 취소하든 **그 공고의 잠긴 돈은 한 번만 풀려야
한다.** 키를 나누면 두 경로가 동시에 들어왔을 때 원장이 두 번 늘어난다.

### 되돌리는 금액은 원장에서 계산한다

`ADR-PAY-7`. 예산(`headcount × rewardPerPerson`)에서 다시 계산하면 #15에서
예산을 고친 공고의 숫자가 어긋난다. #16이 이미 그렇게 하고 있고 그대로 쓴다.

---

## 이 이슈에서 만들지 않는 것

| 미룬 것                                                      | 이유                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 지역(시/도·시/군/구)·등록 기간 필터, 컬럼 헤더 정렬, 필터 칩 | §11.2의 **공통** 목록 규약. 회원 목록·환전 목록에도 똑같이 필요하므로 #32가 공통 컴포넌트로 만들 때 붙인다 |
| 관리자 공고 **상세** (버전 이력·신청자 목록·포인트 내역)     | §11.6에 있지만 AC 4줄 어디에도 없다                                                                        |
| 관리자 2단계 인증                                            | `spec-fixed.md` §12가 MVP 이후로 명시                                                                      |
| 강제 취소 시 구인자·수락자에게 알림                          | AC에 없다. 알림 발행은 #36의 `NotificationType`에 값을 더해야 해서 별도 이슈가 맞다                        |
| 감사 로그 **조회 화면**                                      | AC4는 "감사 로그를 보면 남아 있다"까지다. 조회 UI는 관리자 화면 넷이 다 생긴 뒤가 낫다                     |

---

## 테스트 시나리오

### 정상

- [ ] [정상] `AdminGuard` — should allow the request when the access cookie belongs to a user whose role is ADMIN
- [ ] [정상] `AdminGuard` — should expose the token's sub as the admin principal when it allows the request
- [ ] [정상] `AdminJobPostService.list` — should return title, employerName, categoryName, status and createdAt for every row
- [ ] [정상] `AdminJobPostService.list` — should include posts of every status when no status filter is given
- [ ] [정상] `AdminJobPostService.list` — should return only that employer's posts when q matches an employer name
- [ ] [정상] `AdminJobPostService.list` — should return the post when q matches its title instead of an employer name
- [ ] [정상] `AdminJobPostService.forceCancel` — should set the post to CANCELLED and release the whole held amount
- [ ] [정상] `AdminJobPostService.forceCancel` — should record an AdminAuditLog row carrying the admin id, the reason and the time
- [ ] [정상] `AdminJobPostList` — should render title, employer, category, status and createdAt columns for each row
- [ ] [정상] `middleware` — should redirect to /login when /admin/job-posts is opened without the access cookie

### 경계

- [ ] [경계] `AdminJobPostService.forceCancel` — should release the amount actually held in the ledger, not the recomputed budget, when the budget was edited after posting
- [ ] [경계] `AdminJobPostService.forceCancel` — should release 0 and still record the audit log when nothing is held
- [ ] [경계] `AdminJobPostService.forceCancel` — should record exactly one RELEASE when the same post is force-cancelled twice concurrently
- [ ] [경계] `AdminJobPostService.forceCancel` — should not penalize the employer when the post has no accepted applicant
- [ ] [경계] `AdminJobPostService.forceCancel` — should penalize the employer once when the post has at least one accepted applicant
- [ ] [경계] `AdminJobPostService.forceCancel` — should cancel a CLOSED post as well, since the transition table allows CLOSED to CANCELLED
- [ ] [경계] `cancelAndRelease` — should leave the post uncancelled when writing the audit log fails
- [ ] [경계] `AdminJobPostService.list` — should match an employer name partially and case-insensitively
- [ ] [경계] `AdminJobPostService.list` — should narrow by both filters when q and status are given together
- [ ] [경계] `AdminJobPostService.list` — should return an empty items array with the unfiltered-page total when page is past the last page
- [ ] [경계] `adminJobPostFilterSchema` — should fall back to page 1 when page is 0 or not a number

### 예외

- [ ] [예외] `AdminGuard` — should throw ADMIN_UNAUTHENTICATED when the request carries no access cookie
- [ ] [예외] `AdminGuard` — should throw ADMIN_UNAUTHENTICATED when the access cookie is forged or expired
- [ ] [예외] `AdminGuard` — should throw ADMIN_UNAUTHENTICATED when the token's sub points at a user that no longer exists
- [ ] [예외] `AdminGuard` — should throw ADMIN_FORBIDDEN when the user's role is USER
- [ ] [예외] `AdminJobPostService.forceCancel` — should throw ADMIN_REASON_REQUIRED when the reason is empty or only whitespace
- [ ] [예외] `AdminJobPostService.forceCancel` — should throw JOB_POST_NOT_FOUND when the post does not exist or is soft-deleted
- [ ] [예외] `AdminJobPostService.forceCancel` — should throw JOB_POST_INVALID_TRANSITION when the post is already CANCELLED
- [ ] [예외] `AdminJobPostService.forceCancel` — should throw JOB_POST_INVALID_TRANSITION when the post is COMPLETED
- [ ] [예외] `AdminJobPostService.forceCancel` — should write no audit log when the cancel is rejected
- [ ] [예외] `AdminJobPostController` — should answer 403 with ADMIN_FORBIDDEN when a non-admin calls the list endpoint
- [ ] [예외] `AdminJobPostController` — should answer 400 with ADMIN_REASON_REQUIRED when the cancel body has no reason
- [ ] [예외] `AdminJobPostList` — should keep the confirm button disabled until a reason is typed
- [ ] [예외] `AdminJobPostList` — should render a "권한이 없습니다" notice instead of the table when forbidden is true

---

## AC 대조

| AC                                                                                                           | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1** Given 관리자, When 공고 목록을 열면, Then 제목·구인자·카테고리·상태·등록일이 보인다                  | `[정상] list — should return title, employerName, categoryName, status and createdAt`<br>`[정상] list — should include posts of every status`<br>`[정상] AdminJobPostList — should render ... columns`<br>`[정상] AdminGuard — should allow ... role is ADMIN`                                                                                                                          |
| **AC2** Given 공고 목록, When 구인자 이름으로 검색하면, Then 해당 공고만 보인다                              | `[정상] list — should return only that employer's posts when q matches an employer name`<br>`[정상] list — should return the post when q matches its title`<br>`[경계] list — should match ... partially and case-insensitively`<br>`[경계] list — should narrow by both filters`                                                                                                       |
| **AC3** Given 공고, When 사유를 적고 강제 취소하면, Then `CANCELLED`가 되고 잠긴 포인트가 전액 `RELEASE`된다 | `[정상] forceCancel — should set the post to CANCELLED and release the whole held amount`<br>`[경계] forceCancel — should release the amount actually held in the ledger`<br>`[경계] forceCancel — should release 0 ... when nothing is held`<br>`[경계] forceCancel — should record exactly one RELEASE ... concurrently`<br>`[예외] forceCancel — should throw ADMIN_REASON_REQUIRED` |
| **AC4** Given 강제 취소, When 감사 로그를 보면, Then 누가·언제·왜가 남아 있다                                | `[정상] forceCancel — should record an AdminAuditLog row carrying the admin id, the reason and the time`<br>`[경계] cancelAndRelease — should leave the post uncancelled when writing the audit log fails`<br>`[예외] forceCancel — should write no audit log when the cancel is rejected`                                                                                              |

**커버리지:** AC 4개 / 시나리오 34개 / 미커버 0개

### AC에 없는데 넣은 시나리오

| 시나리오                                                       | 왜 넣었나                                                                                                                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AdminGuard` 예외 4개 · 컨트롤러 403 · `middleware` 리다이렉트 | AC에 권한 문장이 없지만 **가드가 이 이슈의 산출물**이고 #32~#34가 물려받는다. #32의 AC("일반 회원이 관리자 URL로 접근하면 `FORBIDDEN`")가 이 가드를 그대로 쓴다 |
| `forceCancel` 경고 부여 2개                                    | 판단이 갈렸던 지점. 결정한 규칙을 테스트로 못 박는다                                                                                                            |
| `forceCancel` 전이 예외 3개 (`CANCELLED`·`COMPLETED`·`CLOSED`) | `ADR-JOB-3`의 전이표를 강제 취소도 그대로 탄다는 것을 고정한다                                                                                                  |
| `adminJobPostFilterSchema` page 폴백                           | 일반 목록이 이미 "잘못된 page는 오류가 아니라 1"이다. 관리자 목록만 다르면 안 된다                                                                              |
| `AdminJobPostList` 사유 필수·권한 안내                         | §11.6의 "사유 필수"가 화면에서도 지켜지는지, 403일 때 무엇이 보이는지                                                                                           |
