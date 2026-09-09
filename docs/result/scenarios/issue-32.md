# 이슈 #32 — 관리자가 회원을 검색해 상세를 본다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/32
> PRD: `docs/result/prd/auth-member.md`
> 담당: A
> 상태: 시그니처 확정 / 시나리오 도출 완료
> 브랜치 `feat/auth-member/issue-32` (base: `main`, 선행 #13·#26 머지 완료)

---

## 먼저 — 이슈가 말하는 `FilterableList`는 컴포넌트로 존재하지 않는다

이슈 본문이 "`FilterableList`(#13)를 재사용한다"고 적었지만, **저장소에 그런 이름의
파일이 없다.** #13은 그 자리에 `JobPostList`를 만들었고, 그 뒤 관리자 목록 셋(#35
공고 · #33 블랙리스트 · #34 환전)이 같은 **규약**을 각자 따라 왔다.

| #13이 정한 규약                            | 세 관리자 목록이 지킨 방식                      |
| ------------------------------------------ | ----------------------------------------------- |
| 필터의 진실은 URL 하나다 (`ADR-JOB-4`)     | `useSearchParams()`로 읽고 `router.replace()`   |
| 필터가 바뀌면 첫 페이지로 돌아간다         | `query.delete('page')`                          |
| 범위를 넘은 페이지는 오류가 아니라 빈 목록 | 저장소가 `skip/take`만 하고 총 건수를 함께 준다 |
| `total`은 필터를 적용한 뒤의 수다          | 같은 `where`로 `count`                          |
| 표는 sticky 헤더 · 가로 스크롤 · 정렬 규약 | `page.module.css`의 `.tableWrap`/`.table`       |

**여기서 컴포넌트를 새로 추출하지 않는다.** 추출하려면 이미 머지된 관리자 목록
셋을 함께 뜯어야 하는데, 그건 이 이슈의 AC 어디에도 없고 되돌리기도 어렵다.
이 이슈는 **네 번째 목록으로서 같은 규약을 따른다.** 공통 컴포넌트 추출은 목록이
넷 다 자리잡은 지금이 오히려 적기이므로 별도 이슈로 남긴다.

---

## 시그니처

### 관련 ADR

| 따르는 것               | 이 시그니처에 미치는 영향                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `ADR-AUTH-3`            | **상태 컬럼이 없다.** 상태는 `deactivatedAt`과 유효 제재 여부로 **계산한다**                     |
| `ADR-AUTH-2`            | 주소가 `sido`/`sigungu`로 분해돼 있다. 지역 필터가 문자열 파싱이 아니라 컬럼 비교다              |
| `ADR-PAY-1`             | **잔액의 진실은 원장이다.** 상세의 잔액은 `cachedBalance`가 아니라 `PointTransaction` 합이다     |
| `spec-fixed.md` §11.2   | 검색은 **이름·이메일** 부분 일치. 필터는 AND. 페이징은 오프셋(전체 건수 표시). 상태는 URL에 있다 |
| `spec-fixed.md` §11.3   | 목록 컬럼 7칸, 필터 3종(주소지·상태·검색), **비활성화 회원은 사라지지 않는다**                   |
| `spec-fixed.md` §5      | 경고 수는 **180일 창 안**만 센다. 창 밖까지 세면 #33 블랙리스트의 숫자와 어긋난다                |
| `spec-fixed.md` §5.1    | 유효 제재는 `releasedAt IS NULL AND endAt > now()`. `activeSuspensionAtWhere`를 그대로 쓴다      |
| `spec-fixed.md` §7 §2.1 | 평점은 **역할별로 나뉜다.** 평균과 표본 수를 함께 준다 — "신규" 판정은 화면이 `formatRating`으로 |
| #35 `admin.guard.ts`    | 403은 이 이슈가 만들지 않는다. `AdminGuard`를 클래스에 붙이면 끝이다                             |

### 타입

```typescript
// packages/shared/src/admin.ts (추가)

/** 관리자 회원 목록 한 페이지 건수. 관리자 목록 셋과 같은 20 */
export const ADMIN_MEMBER_PAGE_SIZE = 20;

/**
 * 회원 상태. (`spec-fixed.md` §11.3 "정상 / 제재중 / 비활성화")
 *
 * **DB 컬럼이 아니다** (`ADR-AUTH-3`). `deactivatedAt`과 유효 제재 여부에서
 * 계산해 만든 표시용 값이다 — 컬럼으로 두면 두 벌이 되어 어긋날 자리가 생긴다.
 */
export const ADMIN_MEMBER_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
] as const;
export type AdminMemberStatus = (typeof ADMIN_MEMBER_STATUSES)[number];

/**
 * 두 사실에서 상태 하나를 낸다.
 *
 * **비활성화가 제재를 이긴다.** 둘 다인 회원에게 "제재중"을 붙이면 관리자가
 * 제재 해제를 눌러 볼 텐데, 그 계정은 애초에 로그인이 안 된다 (§2.6).
 */
export function memberStatusOf(member: {
  deactivatedAt: Date | null;
  hasActiveSuspension: boolean;
}): AdminMemberStatus;

/**
 * 회원 목록 필터. **URL 쿼리스트링이 이 모양 그대로다** (`ADR-JOB-4`).
 *
 * 가입 기간(§11.3) 필터는 이 이슈의 AC에 없어 넣지 않는다 — 아래
 * "이 이슈에서 만들지 않는 것" 참고.
 */
export const adminMemberFilterSchema = z.object({
  /** 이름 **또는** 이메일 부분 일치 (§11.2). 검색칸은 하나다 */
  q: z.string().trim().min(1).optional(),
  /** 주소지 1단계 (`ADR-AUTH-2`) */
  sido: z.string().trim().min(1).optional(),
  /** 주소지 2단계. 시/도 없이 단독으로도 걸린다 (#13이 정한 규칙) */
  sigungu: z.string().trim().min(1).optional(),
  status: z.enum(ADMIN_MEMBER_STATUSES).optional(),
  /** 1부터. 범위를 넘으면 오류가 아니라 빈 목록이다 (관리자 목록 셋과 같다) */
  page: z.coerce.number().int().min(1).catch(1).default(1),
});
export type AdminMemberFilter = z.infer<typeof adminMemberFilterSchema>;

/** 목록 한 줄. §11.3이 요구하는 일곱 칸이 그대로 필드다 */
export const adminMemberSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  joinedAt: z.iso.datetime(),
  /** 구인자로서 평점. 평균과 표본 수를 함께 준다 (#26) */
  asPoster: roleRatingSchema,
  /** 구직자로서 평점 */
  asWorker: roleRatingSchema,
  /** 180일 창 안 누적 경고 수 (§5) */
  penaltyCount: z.number().int(),
  status: z.enum(ADMIN_MEMBER_STATUSES),
});
export type AdminMemberSummary = z.infer<typeof adminMemberSummarySchema>;

/** 목록 응답. 오프셋 페이징이라 전체 건수를 함께 준다 (§11.2) */
export const adminMemberListSchema = z.object({
  items: z.array(adminMemberSummarySchema),
  /** **필터를 적용한 뒤의** 건수 */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminMemberList = z.infer<typeof adminMemberListSchema>;

/** 받은 별점 한 건. 거래 상대·공고·일시를 함께 준다 (§11.3) */
export const adminMemberReviewSchema = z.object({
  id: z.string(),
  score: z.number().int(),
  /** 그 거래에서 **평가받은 사람의** 역할 (#26) */
  rateeRole: z.enum(RATING_ROLES),
  raterName: z.string(),
  jobPostTitle: z.string(),
  createdAt: z.iso.datetime(),
});

/** 등록한 공고 한 줄 */
export const adminMemberJobPostSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(JOB_POST_STATUSES),
  createdAt: z.iso.datetime(),
});

/** 신청 이력 한 줄 */
export const adminMemberApplicationSchema = z.object({
  id: z.string(),
  jobPostId: z.string(),
  jobPostTitle: z.string(),
  status: z.enum(APPLICATION_STATUSES),
  createdAt: z.iso.datetime(),
});

/** 원장 한 줄. 부호는 `amount`에 담긴다 (§6.1) */
export const adminMemberLedgerEntrySchema = z.object({
  id: z.string(),
  type: z.enum(POINT_TRANSACTION_TYPES),
  amount: z.number().int(),
  createdAt: z.iso.datetime(),
});

/** 경고 한 건. 사유·시각·관련 공고 (§11.3) */
export const adminMemberPenaltySchema = z.object({
  id: z.string(),
  reason: z.enum(PENALTY_REASONS),
  /** 공고와 무관한 경고도 있을 수 있다 */
  jobPostId: z.string().nullable(),
  occurredAt: z.iso.datetime(),
});

/** 제재 한 건. 해제됐으면 해제 시각이 있다 (#33) */
export const adminMemberSuspensionSchema = z.object({
  id: z.string(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  releasedAt: z.iso.datetime().nullable(),
});

/**
 * 회원 상세. AC5가 요구하는 다섯 덩이가 그대로 필드다.
 *
 * **한 번에 준다.** 화면이 덩이마다 따로 부르면 상세 한 번에 여섯 번을 부른다 —
 * #33·#35가 목록에서 내린 판단과 같다.
 */
export const adminMemberDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  joinedAt: z.iso.datetime(),
  status: z.enum(ADMIN_MEMBER_STATUSES),
  /** 가입 주소. 주소를 아직 안 넣은 회원이 있을 수 있어 nullable이다 */
  address: z
    .object({
      sido: z.string(),
      sigungu: z.string(),
      roadAddress: z.string(),
    })
    .nullable(),
  asPoster: roleRatingSchema,
  asWorker: roleRatingSchema,
  reviews: z.array(adminMemberReviewSchema),
  jobPosts: z.array(adminMemberJobPostSchema),
  applications: z.array(adminMemberApplicationSchema),
  /** **원장 합이다** (`ADR-PAY-1`). `cachedBalance`를 그대로 내지 않는다 */
  pointBalance: z.number().int(),
  ledger: z.array(adminMemberLedgerEntrySchema),
  penalties: z.array(adminMemberPenaltySchema),
  suspensions: z.array(adminMemberSuspensionSchema),
});
export type AdminMemberDetail = z.infer<typeof adminMemberDetailSchema>;

/** ADMIN_ERRORS에 한 줄 추가 */
//   /** 그런 회원이 없다 (#32) */
//   MEMBER_NOT_FOUND: 'ADMIN_MEMBER_NOT_FOUND',
```

```typescript
// apps/api/src/admin/admin-member.service.ts (신규)

/** 목록 한 줄에 필요한 것들. 평점 캐시와 경고 집계를 함께 조인해서 온다 */
export interface AdminMemberRow {
  id: string;
  name: string;
  email: string;
  joinedAt: Date;
  /** 상태 계산의 재료 하나 (`ADR-AUTH-3`) */
  deactivatedAt: Date | null;
  /** 상태 계산의 재료 둘. §5.1의 조건으로 저장소가 판정해서 준다 */
  hasActiveSuspension: boolean;
  ratingAsPoster: number | null;
  ratingAsPosterCount: number;
  ratingAsWorker: number | null;
  ratingAsWorkerCount: number;
  /** 180일 창 안 경고 수 (§5) */
  penaltyCount: number;
}

/** 상세 한 건. 목록 한 줄에 다섯 덩이를 더한 모양이다 */
export interface AdminMemberDetailRow extends AdminMemberRow {
  address: { sido: string; sigungu: string; roadAddress: string } | null;
  reviews: {
    id: string;
    score: number;
    rateeRole: RatingRole;
    raterName: string;
    jobPostTitle: string;
    createdAt: Date;
  }[];
  jobPosts: {
    id: string;
    title: string;
    status: JobPostStatus;
    createdAt: Date;
  }[];
  applications: {
    id: string;
    jobPostId: string;
    jobPostTitle: string;
    status: ApplicationStatus;
    createdAt: Date;
  }[];
  /** 원장 합 (`ADR-PAY-1`) */
  pointBalance: number;
  ledger: {
    id: string;
    type: PointTransactionType;
    amount: number;
    createdAt: Date;
  }[];
  penalties: {
    id: string;
    reason: PenaltyReason;
    jobPostId: string | null;
    occurredAt: Date;
  }[];
  suspensions: {
    id: string;
    startAt: Date;
    endAt: Date;
    releasedAt: Date | null;
  }[];
}

/**
 * 회원 조회 저장소. **쓰기가 없다** — 이 이슈는 읽기 전용이다.
 *
 * 관리자 화면에서 회원 정보를 고치는 기능은 PRD §4가 명시적으로 뺐다.
 */
export interface AdminMemberStore {
  list(
    filter: AdminMemberFilter,
    pageSize: number,
    now: Date,
  ): Promise<{ items: AdminMemberRow[]; total: number }>;

  /** 없으면 `null`. 서비스가 에러로 바꾼다 */
  findDetail(userId: string, now: Date): Promise<AdminMemberDetailRow | null>;
}

/** 관리자의 회원 조회. (이슈 #32, `spec-fixed.md` §11.3) */
@Injectable()
export class AdminMemberService {
  constructor(private readonly store: AdminMemberStore);
  list(filter: AdminMemberFilter): Promise<AdminMemberList>;
  /** @throws AdminError(`ADMIN_MEMBER_NOT_FOUND`) */
  detail(userId: string): Promise<AdminMemberDetail>;
}
```

```typescript
// apps/api/src/admin/admin-member.controller.ts (신규)

@Controller('admin/members')
@UseGuards(AdminGuard) // 클래스에 붙인다 — #33·#35가 정한 모양
export class AdminMemberController {
  @Get() list(@Query() query: unknown): Promise<AdminMemberList>;
  @Get(':id') detail(@Param('id') id: string): Promise<AdminMemberDetail>;
}
```

**새 Prisma 모델도 새 마이그레이션도 없다.** 읽는 표(`User`·`UserAddress`·
`Rating`·`JobPost`·`Application`·`PointTransaction`·`Penalty`·`Suspension`)가
전부 있고, §11.2가 요구한 인덱스(`[sido, sigungu]`, `[userId, occurredAt]`,
`[userId, endAt]`, `[rateeId, rateeRole]`)도 이미 걸려 있다.

### 에러 케이스

| 상황                            | 에러 코드                  | HTTP |
| ------------------------------- | -------------------------- | ---- |
| 관리자가 아니다 (AC6)           | `ADMIN_FORBIDDEN`          | 403  |
| 그런 회원이 없다                | `ADMIN_MEMBER_NOT_FOUND`   | 404  |
| `page`가 숫자가 아니거나 0 이하 | (오류 아님 — 1로 떨어진다) | 200  |

`ADMIN_FORBIDDEN`은 `AdminGuard`가 이미 던진다. 이 이슈가 더하는 코드는
`ADMIN_MEMBER_NOT_FOUND` 하나다 — AC에는 없지만 상세 라우트가 `:id`를 받는
이상 없는 id가 반드시 온다. 없으면 500이 나가고 화면이 그것을 구분하지 못한다.

### 컴포넌트 Props

```typescript
// apps/web/src/app/admin/members/AdminMemberList.tsx
export interface AdminMemberListProps {
  items: AdminMemberSummary[];
  total: number;
  page: number;
  pageSize: number;
  filter: AdminMemberFilter;
  /** 403을 받았다. 표 대신 안내를 그린다 (#33과 같다) */
  forbidden?: boolean;
}

// apps/web/src/app/admin/members/[id]/AdminMemberDetail.tsx
export interface AdminMemberDetailProps {
  member: AdminMemberDetailData | null;
  forbidden?: boolean;
}
```

### 판단이 갈렸던 지점

**1. 상태를 계산해서 준다.** `ADR-AUTH-3`이 상태 컬럼을 기각했으므로 목록이
`deactivatedAt`과 유효 제재 여부에서 만들어 낸다. 계산을 `packages/shared`의
순수 함수 하나로 빼서 화면과 서버가 같은 규칙을 쓴다 — 화면이 따로 판정하면
"목록은 정상인데 배지는 제재중"인 줄이 생긴다.

**2. 비활성화가 제재를 이긴다.** 둘 다인 회원에게 "제재중"을 붙이면 관리자가
제재 해제를 눌러 볼 텐데 그 계정은 애초에 로그인이 안 된다 (§2.6).

**3. 잔액은 원장 합이다.** `User.cachedBalance`를 그대로 내지 않는다.
`ADR-PAY-1`이 "표시용 캐시, 진실은 원장"이라고 못 박았고, 관리자 화면은
캐시가 틀어졌는지 확인하러 오는 자리다 — 캐시를 보여주면 확인할 방법이 없다.

**4. 상세를 한 번에 준다.** 다섯 덩이를 각각 라우트로 두면 상세 한 화면에
여섯 번을 부른다. #33·#35가 목록에서 조인으로 해결한 것과 같은 판단이다.

**5. 상세 안의 목록에는 페이징을 두지 않는다.** AC5는 "보인다"까지고, 페이징을
넣으면 다섯 덩이마다 URL 파라미터가 하나씩 는다. 최신순으로 전부 준다.

**6. 지역 필터는 주소가 없는 회원을 뺀다.** 시/도를 고른 순간 "그 지역 회원"을
묻는 것이므로, 주소가 없는 회원은 그 답이 아니다. 필터를 안 걸면 그대로 보인다.

### 이 이슈에서 만들지 않는 것

| 것                                   | 왜                                                        |
| ------------------------------------ | --------------------------------------------------------- |
| `FilterableList` 공통 컴포넌트 추출  | 머지된 관리자 목록 셋을 함께 뜯어야 한다. 별도 이슈       |
| 가입 기간(등록일) 필터, 컬럼 정렬    | §11.2에 있지만 이 이슈의 AC에 없다. 관리자 목록 공통 이슈 |
| 동의서 PDF 열람, 계좌·검증 상태 표시 | §11.3에 있지만 AC5의 다섯 덩이에 없다                     |
| 관리자 화면에서 회원 정보 수정       | PRD §4가 명시적으로 뺐다 (개인정보 임의 수정은 사고 위험) |
| 회원 상세에서의 제재 해제 버튼       | #33이 블랙리스트 화면에서 이미 한다                       |
| `pg_trgm` 검색 인덱스                | `ADR-JOB-5`대로 보류. 부분 일치는 지금 규모에서 충분하다  |

---

## 테스트 시나리오

### 정상

- [ ] [정상] `list` — should return name, email, joinedAt, both role ratings, penalty count and status for every member
- [ ] [정상] `list` — should report the filtered total, the requested page and the page size
- [ ] [정상] `list` — should return only members whose name partially matches the search word
- [ ] [정상] `list` — should also match a partial email with the same search word
- [ ] [정상] `list` — should return only members living in the chosen sido
- [ ] [정상] `list` — should narrow further with sigungu
- [ ] [정상] `list` — should apply the search word and the region together as AND
- [ ] [정상] `list` — should still return a deactivated member and mark the row DEACTIVATED
- [ ] [정상] `list` — should return only deactivated members when the status filter is DEACTIVATED
- [ ] [정상] `memberStatusOf` — should report ACTIVE when the member is neither deactivated nor suspended
- [ ] [정상] `memberStatusOf` — should report SUSPENDED when an active suspension exists
- [ ] [정상] `detail` — should return the name, email, joined date, address and status
- [ ] [정상] `detail` — should return both role averages with their sample counts
- [ ] [정상] `detail` — should return every rating received with the rater name, the job post title and the date
- [ ] [정상] `detail` — should return the job posts the member registered and the applications they made
- [ ] [정상] `detail` — should return the ledger entries and a balance summed from the ledger
- [ ] [정상] `detail` — should return penalties with their reason and job post and the suspension history
- [ ] [정상] `GET /admin/members` — should answer 200 with the list body when an admin calls it with a filter
- [ ] [정상] `통합` — should filter by name, email and region against the real database
- [ ] [정상] `통합` — should gather ratings, job posts, applications, ledger and penalties for one member
- [ ] [정상] `목록 화면` — should render name, email, joined date, both ratings, penalty count and status for each row
- [ ] [정상] `목록 화면` — should show a "비활성화" badge on a deactivated row
- [ ] [정상] `목록 화면` — should put the applied search word and region into the URL
- [ ] [정상] `목록 화면` — should link each row to that member's detail page
- [ ] [정상] `상세 화면` — should render the rating, review, trade, point and penalty sections

### 경계

- [ ] [경계] `adminMemberFilterSchema` — should fall back to page 1 when page is 0 or not a number
- [ ] [경계] `list` — should return every member when neither a search word nor a region is given
- [ ] [경계] `list` — should filter by sigungu alone when no sido was chosen
- [ ] [경계] `list` — should exclude a member who has no address at all when a region is chosen
- [ ] [경계] `list` — should return an empty page instead of failing when the page is past the end
- [ ] [경계] `list` — should report a null average and a zero count for a member who has never been rated
- [ ] [경계] `memberStatusOf` — should report DEACTIVATED even when an active suspension also exists
- [ ] [경계] `detail` — should return empty lists and a zero balance for a member with no activity
- [ ] [경계] `통합` — should count only the penalties inside the 180-day window
- [ ] [경계] `통합` — should not treat an expired or released suspension as SUSPENDED

### 예외

- [ ] [예외] `detail` — should throw `ADMIN_MEMBER_NOT_FOUND` when no such member exists
- [ ] [예외] `GET /admin/members` — should answer 403 with `ADMIN_FORBIDDEN` when a non-admin calls the list
- [ ] [예외] `GET /admin/members/:id` — should answer 403 with `ADMIN_FORBIDDEN` when a non-admin calls the detail
- [ ] [예외] `GET /admin/members/:id` — should answer 404 with `ADMIN_MEMBER_NOT_FOUND` when there is no such member
- [ ] [예외] `목록 화면` — should render a "권한이 없습니다" notice instead of the table when forbidden is true

---

## AC 대조

| AC                                                                                    | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 · 관리자가 회원 목록을 열면 이름·이메일·가입일·평점·경고 수·상태가 보인다           | `[정상] list — should return name, email, joinedAt, both role ratings, penalty count and status ...`<br>`[정상] list — should report the filtered total ...`<br>`[경계] list — should report a null average and a zero count ...`<br>`[경계] 통합 — should count only the penalties inside the 180-day window`<br>`[정상] 목록 화면 — should render name, email, joined date, both ratings ...`                                                                                                                                                             |
| 2 · 이름으로 검색하면 부분 일치하는 회원만 보인다                                     | `[정상] list — should return only members whose name partially matches ...`<br>`[정상] list — should also match a partial email ...`<br>`[경계] list — should return every member when neither a search word nor a region is given`<br>`[정상] 통합 — should filter by name, email and region against the real database`<br>`[정상] 목록 화면 — should put the applied search word and region into the URL`                                                                                                                                                 |
| 3 · 시/도로 거르면 그 지역 회원만 보인다                                              | `[정상] list — should return only members living in the chosen sido`<br>`[정상] list — should narrow further with sigungu`<br>`[경계] list — should filter by sigungu alone when no sido was chosen`<br>`[경계] list — should exclude a member who has no address at all ...`<br>`[정상] list — should apply the search word and the region together as AND`<br>`[정상] 통합 — should filter by name, email and region ...`                                                                                                                                 |
| 4 · 비활성화된 회원이 사라지지 않고 "비활성화" 배지가 붙어 보인다                     | `[정상] list — should still return a deactivated member and mark the row DEACTIVATED`<br>`[정상] list — should return only deactivated members when the status filter is DEACTIVATED`<br>`[정상] memberStatusOf — ACTIVE`<br>`[정상] memberStatusOf — SUSPENDED`<br>`[경계] memberStatusOf — DEACTIVATED even when an active suspension also exists`<br>`[경계] 통합 — should not treat an expired or released suspension as SUSPENDED`<br>`[정상] 목록 화면 — should show a "비활성화" badge on a deactivated row`                                         |
| 5 · 회원 행을 클릭하면 상세에 평점·리뷰 목록·거래 이력·포인트 내역·제재 이력이 보인다 | `[정상] 목록 화면 — should link each row to that member's detail page`<br>`[정상] detail — 기본 정보`<br>`[정상] detail — 역할별 평균과 표본 수`<br>`[정상] detail — 받은 별점 내역`<br>`[정상] detail — 등록 공고와 신청 이력`<br>`[정상] detail — 원장과 원장에서 센 잔액`<br>`[정상] detail — 경고와 제재 이력`<br>`[경계] detail — 활동이 없는 회원`<br>`[정상] 통합 — should gather ratings, job posts, applications, ledger and penalties for one member`<br>`[정상] 상세 화면 — should render the rating, review, trade, point and penalty sections` |
| 6 · 일반 회원이 관리자 URL로 접근하면 `FORBIDDEN`으로 막힌다                          | `[예외] GET /admin/members — should answer 403 with ADMIN_FORBIDDEN ...`<br>`[예외] GET /admin/members/:id — should answer 403 with ADMIN_FORBIDDEN ...`<br>`[정상] GET /admin/members — should answer 200 ... when an admin calls it with a filter`<br>`[예외] 목록 화면 — should render a "권한이 없습니다" notice ...`                                                                                                                                                                                                                                   |

### AC에 없는데 추가한 시나리오

| 시나리오                                                              | 왜 넣었나                                                                                           |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `detail` — `ADMIN_MEMBER_NOT_FOUND`<br>`GET /admin/members/:id` — 404 | 상세 라우트가 `:id`를 받는 이상 없는 id가 반드시 온다. 없으면 500이 나가고 화면이 구분하지 못한다   |
| `adminMemberFilterSchema` — 잘못된 `page`는 1                         | 관리자 목록 셋이 이미 그렇다 (#33·#34·#35). 여기만 다르면 관리자 화면 안에서 규칙이 갈라진다        |
| `list` — 범위를 넘은 페이지는 빈 목록                                 | 마지막 페이지에서 필터를 좁히면 실제로 생기는 경로다. 오류로 만들면 화면이 깨진다 (#13이 정한 규칙) |
| `list` — 주소 없는 회원은 지역 필터에서 빠진다                        | 조용히 사라지는 쪽인지 남는 쪽인지 정해두지 않으면 테스트가 구현을 따라간다                         |
| `경계 통합` — 180일 창 밖 경고는 세지 않는다                          | 창을 넓게 세면 #33 블랙리스트의 "누적 경고"와 같은 회원의 숫자가 어긋난다                           |
| `경계 통합` — 만료·해제된 제재는 SUSPENDED가 아니다                   | §5.1의 조건은 진짜 SQL만 안다. 가짜 저장소에 흉내 내면 그 흉내를 검증하게 된다                      |

**커버리지:** AC 6개 / 시나리오 40개 / 미커버 0개
