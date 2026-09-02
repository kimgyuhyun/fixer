# 이슈 #11 — 카테고리를 고르면 작성 안내가 뜬다

> 선행 없음 · 도메인 job-post · 크기 S
> 브랜치 `feat/job-post/issue-11` (base: `main`)

공고 작성 화면의 첫 칸. 카테고리를 고르면 그 업종에서 꼭 적어야 할 것이
상세 내용 입력란에 안내로 뜬다.

---

## 시그니처

### 데이터 (`spec-fixed.md` §3.1이 컬럼까지 정해 뒀다)

```prisma
model Category {
  id              String  @id @default(cuid())
  name            String
  slug            String  @unique
  sortOrder       Int
  /// 상세 내용 입력란에 뜨는 안내 문구. 문구 수정에 재배포가 필요 없다.
  placeholderText String
  isActive        Boolean @default(true)

  @@index([isActive, sortOrder])
}
```

### 서버

```ts
export interface CategoryStore {
  /** 활성 카테고리만 정렬순으로 */
  listActive(): Promise<CategoryRecord[]>;
}

GET /categories  →  200 Category[]
```

### 웹

```
/job-posts/new   공고 작성 — 이 이슈는 카테고리 선택과 안내 문구까지만
```

---

## 판단이 갈렸던 지점

**활성 필터를 서버가 건다.**
화면이 전부 받아서 거르면 비활성 카테고리의 이름과 문구가 응답에 실려 나간다.
보이지 않을 뿐 브라우저에서는 보인다. 안 보낼 것은 안 보낸다.

**정렬을 서버가 한다.**
`sortOrder`는 운영이 정하는 값이다. 화면마다 다시 정렬하면 한 곳을 고쳐도
다른 화면이 안 따라온다.

**seed는 이 이슈의 산출물이다.**
`spec-fixed.md` §3.1이 "Prisma seed로 초기값 주입"이라고 정했고, 관리자 CRUD
화면은 범위 밖(§3.1)이다. seed가 없으면 화면에 아무것도 안 뜬다.

---

## 시나리오

### 목록 조회 (AC1·AC3)

- [x] [정상] `listActive` — should return only active categories
- [x] [정상] `listActive` — should order the categories by sortOrder ascending
- [x] [경계] `listActive` — should return an empty array when every category is inactive
- [x] [정상] `GET /categories` — should return 200 with the active categories

### 안내 문구 (AC2)

- [x] [정상] `categorySchema` — should carry placeholderText through unchanged
- [x] [경계] `categorySchema` — should reject a category whose placeholderText is empty

### 화면 (AC1·AC2·AC3)

- [x] [화면] `NewJobPostPage` — should list the active categories in sort order
- [x] [화면] `NewJobPostPage` — should show the placeholderText of the chosen category in the detail field
- [x] [화면] `NewJobPostPage` — should swap the placeholder when another category is chosen
- [x] [화면] `NewJobPostPage` — should show a guide before any category is chosen

**총 10개** (정상 5 / 경계 3 / 화면 4 — 일부 중복 집계 없음)

> `categorySchema` 두 건은 Red에서 바로 통과한다. zod 스키마는 선언 자체가
> 구현이라 "시그니처만 있는 stub"이 성립하지 않는다. 가짜 테스트가 아니라
> **스키마가 규칙을 실제로 강제하는지**를 보는 것이고, `placeholderText`가 빈
> 카테고리를 거절하는 쪽이 특히 그렇다. Red 판정에서 이 둘은 제외해 센다.

---

## AC 대조

| #   | AC                                                               | 커버하는 시나리오                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 공고 작성 화면을 열면 활성 카테고리가 정렬순으로 보인다          | `listActive — only active` · `— order by sortOrder` · `GET /categories — 200`<br>`NewJobPostPage — should list the active categories in sort order`                                                   |
| 2   | 카테고리를 고르면 그 `placeholderText`가 상세 내용 입력란에 뜬다 | `categorySchema — placeholderText through unchanged` · `— reject empty`<br>`NewJobPostPage — should show the placeholderText...` · `— should swap the placeholder...` · `— guide before any category` |
| 3   | `isActive=false` 카테고리는 보이지 않는다                        | `listActive — only active` · `— empty when every category is inactive`<br>`NewJobPostPage — should list the active categories in sort order`                                                          |

**커버리지: AC 3개 전부 커버 / 시나리오 10개 / 미커버 0개**

---

## 이번 범위 밖

| 항목                 | 어디서                                      |
| -------------------- | ------------------------------------------- |
| 공고 등록 자체       | #12. 이 이슈는 **카테고리 선택과 안내까지** |
| 카테고리 관리자 CRUD | seed로만 관리 (`spec-fixed.md` §3.1)        |
| 카테고리 계층 구조   | 단일 레벨 (job-post PRD)                    |
| 나머지 필수 입력 칸  | #12 (제목·주소·일시·인원·보상금)            |
