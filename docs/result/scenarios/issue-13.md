# 이슈 #13 — 공고 목록을 검색·필터로 좁혀 본다

> 선행 #12 · 도메인 job-post · 크기 L
> 브랜치 `feat/job-post/issue-13` (base: `feat/job-post/issue-12`)

**`FilterableList` 공통 컴포넌트를 여기서 만든다.** 관리자 목록 6개가 전부
이걸 재사용하므로(§11.2), 여기서 대충 만들면 여섯 번 대충이 된다.

---

## 먼저 고칠 것 — 지역으로 거를 수가 없다

AC2가 "시/도·시/군/구로 거른다"인데 `JobPost`에는 `workAddress` 문자열
하나뿐이다. 문자열에서 시/도를 뽑으려면 파싱해야 하고, **파싱이 틀리면
그 공고는 조용히 목록에서 사라진다.**

`ADR-AUTH-2`가 `UserAddress`에서 이미 같은 판단을 했다 — 통 문자열을 두지
않고 분해해서 담는다. 근무 주소도 같게 한다.

```prisma
model JobPost {
  workSido    String   // ← 추가
  workSigungu String   // ← 추가
  @@index([workSido, workSigungu, status])
}
```

**주소를 비워 보내면** 가입 주소의 `sido`/`sigungu`를 그대로 가져온다 —
파싱이 아니라 복사라 틀릴 수가 없다. **주소를 직접 보내면** 지역도 함께
보내야 한다. #3의 우편번호 팝업이 이미 둘을 함께 주므로 화면이 못 채울
일은 없고, 없이 받으면 지역 필터에서 조용히 빠지는 공고가 생긴다.

---

## 시그니처

### 공유

```ts
/** 목록 필터. **URL 쿼리스트링이 이 모양 그대로다** (ADR-JOB-4) */
export const jobPostFilterSchema = z.object({
  category: z.string().optional(),
  sido: z.string().optional(),
  sigungu: z.string().optional(),
  q: z.string().optional(),
  page: z.number().int().min(1).default(1),
});

export const JOB_POST_PAGE_SIZE = 20;
```

### 서버

```
GET /job-posts?category=&sido=&sigungu=&q=&page=
  →  200  { items, total, page, pageSize }
```

---

## 판단이 갈렸던 지점

**시/군/구만 주면 무시하지 않고 그대로 거른다.**
"서울"을 안 고르고 "강남구"만 골랐을 때 결과를 안 거르면 사용자는 필터가
먹은 줄 알고 엉뚱한 목록을 본다. 시/도 없이도 시/군/구로 거른다.

**페이지가 범위를 넘으면 빈 목록을 준다.**
마지막 페이지에서 필터를 바꾸면 `page=5`인데 결과가 1페이지뿐인 상황이
생긴다. 오류로 만들면 화면이 깨진다 — 빈 목록과 `total`을 주면 화면이
"조건에 맞는 공고가 없다"를 그대로 보여준다.

**`total`은 필터를 적용한 뒤의 수다.**
전체 공고 수를 주면 "총 152건"인데 3건만 보이는 화면이 된다.

**검색은 제목만 본다.**
§11.2가 검색을 요구하지만 상세 내용까지 뒤지면 인덱스를 못 타고, 지금
규모(활성 1천 건)에서 제목 부분 일치는 순차 스캔으로도 충분하다
(`ADR-JOB-5`). `pg_trgm`은 그대로 보류다.

**필터 상태를 컴포넌트가 들고 있지 않는다.**
`ADR-JOB-4`대로 URL이 유일한 진실이다. `useState`와 URL 둘을 두면 뒤로가기에서
어긋난다 — AC8이 바로 그것을 확인하는 항목이다.

---

## 시나리오

### 카테고리로 거른다 (AC1)

- [ ] [정상] `list` — should return only the posts of the chosen category
- [ ] [경계] `list` — should return everything when no category is chosen
- [ ] [경계] `list` — should return nothing for a category that has no posts

### 지역으로 거른다 (AC2)

- [ ] [정상] `list` — should return only the posts in the chosen sido
- [ ] [정상] `list` — should narrow further with sigungu
- [ ] [경계] `list` — should filter by sigungu alone when no sido was chosen
- [ ] [정상] `create` — should copy sido and sigungu from the member address when the address is blank
- [ ] [예외] `create` — should reject an explicit address that carries no region

### 조건을 AND로 겹친다 (AC4)

- [ ] [정상] `list` — should apply category and region together
- [ ] [정상] `list` — should keep the other conditions when one is removed

### 빈 상태 (AC5)

- [ ] [경계] `list` — should report zero total when nothing matches
- [ ] [정상] `목록 화면` — should show the empty-state notice when nothing matches

### 페이징과 총 건수 (AC6 · AC7)

- [ ] [경계] `list` — should return the remaining one item on page two of twenty-one
- [ ] [정상] `list` — should report twenty-one as the total on page one
- [ ] [경계] `list` — should count only the filtered posts, not every post
- [ ] [경계] `list` — should return an empty page instead of failing when the page is past the end
- [ ] [경계] `list` — should treat a page below one as page one

### 검색 (§11.2)

- [ ] [정상] `list` — should match a partial title
- [ ] [경계] `list` — should match case-insensitively

### URL이 유일한 진실이다 (AC3 · AC8)

- [ ] [정상] `목록 화면` — should read the filter from the query string on first render
- [ ] [정상] `목록 화면` — should put the chosen category into the URL
- [ ] [경계] `목록 화면` — should reset to page one when a filter changes
- [ ] [정상] `목록 화면` — should show a chip for each applied filter
- [ ] [정상] `목록 화면` — should drop only that condition when a chip is removed
- [ ] [경계] `목록 화면` — should keep no filter state of its own so back navigation stays correct

**총 24개** (정상 11 / 경계 11 / 예외 2)

---

## AC 대조

| AC                       | 시나리오                       |
| ------------------------ | ------------------------------ |
| 1 · 카테고리 필터        | 카테고리 3개                   |
| 2 · 지역 필터            | 지역 5개                       |
| 3 · 새로고침해도 유지    | URL 6개 (첫 렌더가 URL을 읽음) |
| 4 · 칩 하나만 해제       | AND 2개 + 칩 2개               |
| 5 · 빈 상태 안내         | 빈 상태 2개                    |
| 6 · 21개 중 2페이지      | 페이징 5개                     |
| 7 · "총 21건" 표시       | 페이징 5개                     |
| 8 · 뒤로가기로 이전 필터 | URL 6개                        |

---

## 이번 범위 밖

| 것                    | 어디로                                         |
| --------------------- | ---------------------------------------------- |
| 정렬 (컬럼 헤더 클릭) | 관리자 목록 이슈. 지금은 최신순 고정           |
| `pg_trgm` 검색 인덱스 | `ADR-JOB-5`대로 보류. 필요해지면 인덱스만 추가 |
| 상태·기간 필터        | 사용자 목록은 `OPEN`만 본다. 관리자 이슈 몫    |
