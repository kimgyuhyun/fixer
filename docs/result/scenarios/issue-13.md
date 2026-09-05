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

- [x] [정상] `list` — should return only the posts of the chosen category
- [x] [경계] `list` — should return everything when no filter is chosen
- [x] [경계] `list` — should return nothing for a category that has no posts

### 지역으로 거른다 (AC2)

- [x] [정상] `list` — should return only the posts in the chosen sido
- [x] [정상] `list` — should narrow further with sigungu
- [x] [경계] `list` — should filter by sigungu alone when no sido was chosen
- [x] [정상] `create` — should fill the work address from the member address when it is blank (#12 테스트가 지역까지 함께 본다)
- [x] [예외] `작성 화면` — should ask for a region when the address is typed by hand
- [x] [정상] `작성 화면` — should send the region along with a hand-typed address

### 조건을 AND로 겹친다 (AC4)

- [x] [정상] `list` — should apply category and region together
- [x] [정상] `list` — should keep the other conditions when one is removed

### 빈 상태 (AC5)

- [x] [경계] `list` — should report zero total when nothing matches
- [x] [정상] `목록 화면` — should say nothing matches when the list is empty

### 페이징과 총 건수 (AC6 · AC7)

- [x] [정상] `list` — should return twenty on the first page
- [x] [경계] `list` — should return the remaining one item on page two of twenty-one
- [x] [정상] `list` — should report twenty-one as the total on page one
- [x] [경계] `list` — should count only the filtered posts, not every post
- [x] [경계] `list` — should return an empty page instead of failing when the page is past the end
- [x] [경계] `POST 컨트롤러` — should fall back to page one for a page that is not a number
- [x] [정상] `컨트롤러` — should pass the query string filter straight through

### 검색 (§11.2)

- [x] [정상] `list` — should match a partial title
- [x] [경계] `list` — should match case-insensitively

### URL이 유일한 진실이다 (AC3 · AC8)

- [x] [정상] `목록 화면` — should read the filter from the query string on first render
- [x] [정상] `목록 화면` — should put the chosen category into the URL
- [x] [경계] `목록 화면` — should reset to page one when a filter changes
- [x] [정상] `목록 화면` — should show a chip for each applied filter
- [x] [정상] `목록 화면` — should drop only that condition when a chip is removed
- [x] [경계] `목록 화면` — should keep no filter state of its own so back navigation stays correct
- [x] [정상] `목록 화면` — should move to the next page without losing the filter
- [x] [경계] `목록 화면` — should hide the pager when everything fits on one page

**총 37개** (서버 21 + 통합 2 + 컨트롤러 2 + 화면 12, 겹치는 항목 제외)

### 서버를 띄워 확인한 것

강남·마포·해운대 공고 셋을 올리고 걸러 봤다.

| 무엇                    | 결과                                    |
| ----------------------- | --------------------------------------- |
| 전체                    | 3건                                     |
| 시/도 = 서울            | 2건 (마포·강남)                         |
| **시/군/구만 = 마포구** | 1건 — 시/도 없이도 걸린다               |
| 검색 = 청소             | 1건 (제목 부분 일치)                    |
| 카테고리 + 시/군/구     | 1건 (AND)                               |
| `page=9` (범위 밖)      | `200`, 빈 목록에 `total: 3` — 안 깨진다 |

### ac-verifier가 잡은 것 — AC8이 실제로는 안 됐다

**`router.replace()`는 히스토리 엔트리를 쌓지 않는다.** 필터를 두 번 바꾼 뒤
뒤로가기를 누르면 이전 필터가 아니라 목록 화면 자체를 벗어난다. `ADR-JOB-4`가
`replace`라고 적어 두었지만 그게 AC8과 정면으로 충돌했다 — ADR 쪽을 정정했다.

**기존 테스트로는 못 잡는 종류였다.** `replace`가 불렸는지만 기록하고
"뒤로가기"는 테스트가 직접 URL을 되돌려 흉내 냈기 때문에, `push`든 `replace`든
항상 통과했다. 히스토리 스택을 실제로 쌓고 빼는 대역으로 바꿨다.

그러자 **타이핑 필터가 글자마다 엔트리를 쌓는 문제**가 드러났다. §11.2가
요구하는 300ms 디바운스를 그래서 지금 넣었다.

- [x] [경계] `목록 화면` — should return to the previous filter when back is pressed after two changes
- [x] [경계] `목록 화면` — should hide the pager when the total is exactly one page
- [x] [정상] `목록 화면` — should send one request instead of one per keystroke
- [x] [정상] `통합` — should filter by category, region and title against the real database
- [x] [경계] `통합` — should page through the real database and count only the matches

`filterToQuery`가 죽은 코드였던 것도 함께 잡혔다 — 지금은 `apply()`가 쓴다.
서버 테스트 `should keep the other conditions when one is removed`는 이름만
그런 테스트였다(조건 하나만 걸고 있었다). 두 상태를 실제로 비교하도록 고쳤다.

### 빌드가 한 번 막혔다 — `Suspense`

`useSearchParams()`는 프리렌더 시점에 값을 알 수 없어 Next가 경계를 요구한다.
경계가 없으면 **테스트는 전부 통과하는데 빌드가 이 페이지에서 멈춘다.**
목록 본체를 `JobPostList.tsx`로 빼고 페이지가 `Suspense`로 감쌌다.

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
