# 이슈 #84 — 첫 화면이 개발용 기능 목록이고 로그인 상태가 보이지 않는다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/84
> PRD: `docs/result/prd/auth-member.md`
> 담당: B · 선행: 없음 (#82·#83 머지됨)
> 상태: 시그니처 확정 / 시나리오 도출 완료 / Green 완료 (2026-10-01)

---

## 시그니처

### 관련 결정

- **#83 — 로그인 상태는 쿠키가 아니라 `/api/auth/me`로 판단한다.** 200이면 로그인, 그 밖이면 비로그인이다.
  미들웨어는 쿠키가 있는지만 보므로 화면이 쿠키를 들여다보지 않는다 (httpOnly라 볼 수도 없다).
- **#82 — "남은 할 일" 데이터는 이미 있다.** `MyProfile.address`(null이면 주소 미등록),
  `/api/agreements/mine`(200 서명함 / 204 미서명). `my/page.tsx`가 같은 판단을 하고 있다.
- **#5 — 로그아웃은 `POST /api/auth/logout` → `router.refresh()` → `router.replace('/login')`.**
  `refresh()`가 Next의 클라이언트 Router Cache(앞서 본 화면을 브라우저 메모리에 들고 있다가 뒤로 가기에 되살리는 캐시)를 지운다.
  헤더가 `my/page.tsx`에 이어 두 번째 사용처가 된다.
- **#35 — 권한은 `AdminGuard`가 요청마다 DB를 보고 판정한다.** 웹이 관리자 메뉴를 보이는 것은 편의일 뿐이다.

### "관리자인가"를 웹이 아는 방법 — `myProfileSchema`에 `role`을 더한다

| 후보                                                                | 판단                                                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **`/api/auth/me` 응답(`myProfileSchema`)에 `role`을 더한다** ✅     | 홈·헤더가 이미 부르는 요청 하나로 끝난다. 내 등급을 나에게 알려주는 것이라 새는 정보가 없다              |
| 이미 있는 관리자 API(`/api/admin/members` 등)를 불러 200/403을 본다 | ❌ 등급 하나를 알려고 회원 목록(개인정보)을 받아 온다. 관리자가 홈을 열 때마다 목록 조회가 한 번 더 돈다 |

범위가 `packages/shared`와 `apps/api`의 `getMyProfile`까지 넓어진다.

```typescript
// packages/shared/src/auth.ts
import { USER_ROLES } from './admin.js';

export const myProfileSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  address: z.string().nullable(),
  /** 화면이 관리자 메뉴를 보일지 정하는 데만 쓴다. 권한은 AdminGuard가 판정한다 (#84) */
  role: z.enum(USER_ROLES),
  createdAt: z.iso.datetime(),
});
```

```typescript
// apps/api/src/auth/signup.service.ts
export interface UserRecord {
  // …기존 필드
  /** 회원 등급. Prisma 행에는 항상 있다. 이 필드를 모르는 가짜 저장소를 위해 선택이다 (deactivatedAt과 같은 이유) */
  role?: UserRole;
}

// apps/api/src/auth/login.service.ts — 시그니처 그대로, 반환값에 role이 붙는다
getMyProfile(userId: string): Promise<MyProfile>; // role: user.role ?? 'USER'
```

`PrismaUserStore.findById`는 `findUnique`로 행 전체를 돌려주므로 바꿀 것이 없다.

### 헤더 — `SiteHeader` 클라이언트 컴포넌트로 뺀다

`layout.tsx`는 서버 컴포넌트(서버에서만 그려지고 브라우저 상태를 못 갖는 컴포넌트)다. 로그인 상태는 브라우저가
`/api/auth/me`를 불러야 알 수 있으므로 `NotificationBell`처럼 `'use client'` 컴포넌트로 뺀다.
홈 링크·로그인 상태·알림 벨을 한 컴포넌트에 담아 **헤더 하나가 테스트 하나로 검증되게** 한다.

```typescript
// apps/web/src/app/SiteHeader.tsx
'use client';
export default function SiteHeader(): JSX.Element; // Props 없음

// apps/web/src/app/layout.tsx
<header>는 SiteHeader가 그린다. layout은 <SiteHeader />만 둔다.
```

| `/api/auth/me` 응답     | 헤더 오른쪽                                |
| ----------------------- | ------------------------------------------ |
| 묻는 중                 | 아무것도 그리지 않는다 (홈 링크·알림 벨만) |
| 200                     | `{이름}` + `로그아웃` 버튼                 |
| 401·그 밖·네트워크 실패 | `로그인` 링크 (`/login`)                   |

- **경로가 바뀔 때마다 다시 묻는다** (`usePathname()`이 deps). 레이아웃은 화면을 옮겨도 다시 그려지지 않으므로,
  처음 한 번만 물으면 `/login`에서 로그인한 뒤에도 헤더가 계속 "로그인"을 띄운다.
- 로그아웃은 `my/page.tsx`의 `logout()`과 같다. 서버가 실패해도 `refresh()` → `replace('/login')`까지 간다.
  두 곳의 중복은 그대로 둔다 — 저장소 규칙이 "중복은 세 번째부터 뽑는다"다 (Refactor 단계에서 확인).

### 홈 — `apps/web/src/app/page.tsx`

```typescript
'use client';
export default function Home(): JSX.Element; // Props 없음
```

| 상태                                   | 화면                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `/api/auth/me` 묻는 중                 | 로그인·가입 버튼도 메뉴도 그리지 않는다 (로그인한 사람에게 "가입하기"가 깜빡이지 않게) |
| 200이 아님 (401·403·500·네트워크 실패) | 한 줄 소개 + `로그인`(`/login`) · `가입하기`(`/signup/verify-email`)                   |
| 200                                    | `{이름}님` + 남은 할 일 + 메뉴                                                         |

로그인한 회원의 화면:

| 묶음       | 항목                                                                                                                                      | 조건                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 남은 할 일 | `주소 등록하기` → `/signup/address`                                                                                                       | `address === null`                        |
|            | `동의서 서명하기` → `/signup/agreement`                                                                                                   | `/api/agreements/mine`이 204              |
|            | (묶음 전체)                                                                                                                               | 위 둘 다 없으면 묶음 제목까지 그리지 않음 |
| 메뉴       | `공고 목록` `/job-posts` · `공고 등록` `/job-posts/new` · `포인트` `/points` · `환전 계좌` `/my/account` · `마이페이지` `/my`             | 항상                                      |
| 관리자     | `회원 관리` `/admin/members` · `공고 관리` `/admin/job-posts` · `환전 관리` `/admin/exchange-requests` · `제재 관리` `/admin/suspensions` | `role === 'ADMIN'`                        |

- `/api/agreements/mine`이 200도 204도 아니면(실패) 동의서 항목을 띄우지 않는다 — `my/page.tsx`와 같다.
- 개발용 기능 목록(`READY`·`PLANNED`)과 개발 연결 상태(`/api/health` 호출)를 홈에서 지운다. `/api/health`는 그대로 둔다.

### 에러 케이스

새 에러 코드는 없다. 화면은 `/api/auth/me`가 200인지 아닌지만 본다.

| 상황                     | 에러 코드                  | HTTP | 홈·헤더 처리  |
| ------------------------ | -------------------------- | ---- | ------------- |
| 쿠키 없음·Refresh 폐기됨 | `AUTH_UNAUTHENTICATED`     | 401  | 비로그인 화면 |
| 탈퇴한 계정              | `AUTH_ACCOUNT_DEACTIVATED` | 403  | 비로그인 화면 |
| 서버 오류·네트워크 실패  | —                          | 500  | 비로그인 화면 |

### 판단이 갈린 지점

- **메뉴에 `환전 계좌`를 넣는다.** 이슈의 화면 그림에는 없지만, 개발용 목록을 지우면 `/my/account`로 가는 링크가 어디에도 남지 않는다.
- **관리자 메뉴는 관리 화면 넷으로 연다.** `/admin`에는 첫 화면이 없고 네 화면이 서로 링크하지 않는다. "관리자" 링크 하나를 `/admin/members`로 두면 나머지 셋이 고립된다.
- **홈과 헤더가 각자 `/api/auth/me`를 부른다.** 한 화면에 요청이 둘이지만 공유 상태(Context)를 만드는 것보다 단순하다.
  Access가 만료됐으면 둘 다 Refresh로 갱신하는데, Refresh는 회전하지 않으므로(ADR-AUTH-1) 서로 충돌하지 않는다.
- **200이 아닌 응답은 전부 비로그인으로 본다.** 탈퇴 계정(403)에게도 로그인 버튼이 맞는 안내다 — 로그인 화면이 재활성화로 이어진다.

### 기존 테스트가 바뀌는 곳

- **홈에는 지금 테스트가 없다.** (`app/page.test.tsx`가 없다) Red에서 새로 만든다. 지울 기존 테스트는 없다.
- `myProfileSchema`에 `role`이 필수로 붙으므로 프로필 fixture(테스트용 고정 데이터)에 `role: 'USER'`를 더한다 —
  `apps/api/src/auth/login.controller.test.ts`의 `PROFILE`(없으면 `/auth/me` 응답 parse가 실패한다),
  `apps/web/src/app/my/page.test.tsx`의 `profile()`. 기대값은 바꾸지 않는다.

### 이 이슈에서 만들지 않는 것

- 디자인 시스템 개편 — `globals.css` 토큰 안에서 `page.module.css`·`SiteHeader.module.css`만 쓴다
- 비로그인일 때 알림 벨 숨기기 — 지금처럼 늘 보인다 (이슈 화면 그림도 `[알림]`을 늘 둔다)
- `/admin` 첫 화면
- 로그아웃 함수 공용화 — 사용처가 둘뿐이라 세 번째가 생길 때 뽑는다

---

## 테스트 시나리오

### 정상

- [x] [정상] `getMyProfile` — should return role ADMIN when the member is an admin
- [x] [정상] `getMyProfile` — should return role USER when the member is a regular member
- [x] [정상] `Home` — should show login and signup links when /api/auth/me answers 401
- [x] [정상] `Home` — should show neither the developer feature list nor the connection status when logged out
- [x] [정상] `Home` — should not show any main menu link when /api/auth/me answers 401 _(ac-verifier 제안으로 추가)_
- [x] [정상] `Home` — should show the member name and the main menu links when /api/auth/me answers 200
- [x] [정상] `Home` — should show a to-do link to /signup/address when the address is null
- [x] [정상] `Home` — should show a to-do link to /signup/agreement when /api/agreements/mine answers 204
- [x] [정상] `Home` — should show the admin menu links when the role is ADMIN
- [x] [정상] `SiteHeader` — should link fixer to the home page
- [x] [정상] `SiteHeader` — should show the member name and a logout button when /api/auth/me answers 200
- [x] [정상] `SiteHeader` — should show a login link to /login when /api/auth/me answers 401
- [x] [정상] `SiteHeader` — should post /api/auth/logout then refresh then replace to /login when logout is clicked

### 경계

- [x] [경계] `Home` — should show no to-do section when the address exists and the agreement is signed
- [x] [경계] `Home` — should show no agreement to-do when /api/agreements/mine answers neither 200 nor 204
- [x] [경계] `Home` — should show neither login links nor the menu while /api/auth/me is pending
- [x] [경계] `SiteHeader` — should ask /api/auth/me again when the path changes
- [x] [경계] `SiteHeader` — should replace the login link with the member name and logout button when the path changes and /api/auth/me then answers 200 _(ac-verifier 제안으로 추가)_
- [x] [경계] `SiteHeader` — should replace the member name with the login link when the path changes and /api/auth/me then answers 401 _(ac-verifier 제안으로 추가)_
- [x] [경계] `SiteHeader` — should show neither the name nor the login link while /api/auth/me is pending

### 예외

- [x] [예외] `Home` — should not show the admin menu when the role is USER
- [x] [예외] `Home` — should show login and signup links when /api/auth/me fails with 500
- [x] [예외] `SiteHeader` — should show the login link when /api/auth/me fails with a network error
- [x] [예외] `SiteHeader` — should still refresh and replace to /login when the logout request fails

---

## AC 대조

| AC                                                                             | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 비로그인 → 홈에 로그인·가입하기만 보이고 개발용 기능 목록은 없다               | `[정상] Home — login and signup links … 401`<br>`[정상] Home — neither the developer feature list nor the connection status …`<br>`[예외] Home — login and signup links … 500`<br>`[경계] Home — … while pending`                                                                                                                                                                                                                                                                                                                                                             |
| 로그인한 회원 → 이름과 주요 메뉴가 보인다                                      | `[정상] Home — member name and the main menu links …`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 주소·동의서가 없으면 "남은 할 일"이 보이고, 둘 다 있으면 보이지 않는다         | `[정상] Home — to-do link to /signup/address …`<br>`[정상] Home — to-do link to /signup/agreement …`<br>`[경계] Home — no to-do section …`<br>`[경계] Home — no agreement to-do … neither 200 nor 204`                                                                                                                                                                                                                                                                                                                                                                        |
| 관리자 → 관리자 메뉴가 보인다. 일반 회원에게는 보이지 않는다                   | `[정상] getMyProfile — role ADMIN …`<br>`[정상] getMyProfile — role USER …`<br>`[정상] Home — admin menu links … ADMIN`<br>`[예외] Home — not show the admin menu … USER`                                                                                                                                                                                                                                                                                                                                                                                                     |
| 모든 화면의 헤더에 홈 링크와 로그인 상태(이름·로그아웃 / 로그인)가 보인다      | `[정상] SiteHeader — link fixer to the home page`<br>`[정상] SiteHeader — name and a logout button …`<br>`[정상] SiteHeader — login link …`<br>`[경계] SiteHeader — ask again when the path changes`<br>`[경계] SiteHeader — replace the login link with the member name … 200`<br>`[경계] SiteHeader — replace the member name with the login link … 401`<br>`[경계] SiteHeader — … while pending`<br>`[예외] SiteHeader — login link … network error`<br>"모든 화면"은 `layout.tsx`가 `SiteHeader`를 그리는 것으로 성립한다 — 테스트가 아니라 ac-verifier가 코드로 확인한다 |
| 헤더 로그아웃은 마이페이지 로그아웃과 같이 동작한다 (Router Cache 무효화 포함) | `[정상] SiteHeader — post /api/auth/logout then refresh then replace …`<br>`[예외] SiteHeader — still refresh and replace … fails`                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**커버리지:** AC 6개 / 시나리오 24개 / 미커버 0개

AC에 없는 시나리오는 없다. `SiteHeader — ask again when the path changes`는 AC5 "로그인 상태가 보인다"가 로그인 직후에도 맞으려면 필요하다.

### AC 검증 후 보강 (2026-10-01)

ac-verifier가 AC5를 ⚠️로 판정했다 — "경로가 바뀌면 다시 묻는다"가 **호출 횟수만** 세고, 바뀐 응답이 헤더 표시로 반영되는지는
단언하지 않았다. 양방향 시나리오 두 개를 더했다. 함께 조인 것:

- `Home — not show any main menu link … 401`을 더했다 (비로그인 부정 단언이 옛 문구 둘뿐이었다)
- `Home — not show the admin menu … USER`가 관리자 링크 넷을 모두 본다 (전에는 하나)
- `SiteHeader — … while pending`이 이름도 없는지 본다 (테스트 이름과 단언이 어긋났었다)

구현이 이미 그 동작을 하므로 새 테스트는 처음부터 통과했다. 대신 구현을 일부러 깨뜨려 실패를 확인했다 —
헤더 effect의 deps를 `[]`로, 관리자 조건을 항상 참으로, 비로그인 화면에 메뉴를 그리게 바꾸면 5개가 모두 실패한다.

---

## AC 검증 (ac-verifier, 2026-10-01)

1차 판정 ✅5 / ⚠️1 / ❌0. ⚠️는 AC5 — 위 "AC 검증 후 보강"으로 메웠다.
AC5의 "모든 화면"은 코드로 확인했다 — 루트 `layout.tsx`가 `{children}` 앞에 `<SiteHeader />`를 그린다.
`role`의 실제 경로도 코드로 확인했다 — `PrismaUserStore.findById`가 `select` 없이 행 전체를 돌려주고(`role @default(USER)`),
`/api/auth/me`가 `myProfileSchema.parse`로 `role`을 통과시킨다.

## 로컬 확인 (2026-10-01)

`pnpm dev` + 로컬 DB에 세션용 임시 계정 2개(일반·관리자)를 bcrypt 해시로 넣고 확인한 뒤 지웠다.

| 확인                                            | 결과                                                           |
| ----------------------------------------------- | -------------------------------------------------------------- |
| 비로그인 홈                                     | 소개 한 줄 + 로그인·가입하기만. 헤더는 `fixer · 로그인 · 알림` |
| `/login`에서 로그인 → `/my`                     | 헤더가 새로고침 없이 `이름 · 로그아웃`으로 바뀜                |
| 헤더 `fixer` → 홈 (일반 회원, 주소·동의서 없음) | `이름님` + 남은 할 일 2개 + 메뉴 5개. 관리자 메뉴 없음         |
| 헤더 로그아웃                                   | `/login`, 헤더 `로그인`. 뒤로 가기로 `/my`에 가면 `/login`으로 |
| 관리자 계정 홈                                  | 메뉴 5개 + 관리자 메뉴 4개                                     |

화면 모양(스크린샷)은 보지 못했다 — 브라우저 창이 가려져 렌더링이 멈췄다. 운영 확인 때 눈으로 본다.

## 보안 점검 (2026-10-01)

🔴 0 · 🟡 0 · ⚪ 3

| 분류 | 항목                                                  | 판단                                                                                     |
| ---- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ⚪   | `pnpm audit` 32건                                     | lockfile·package.json이 main과 같다. 판정은 대장과 #83 그대로                            |
| ⚪   | `login.service.test.ts`의 `SECRET`·`PASSWORD`         | 테스트 더미 값. 이번 변경 줄이 아니다                                                    |
| ⚪   | 웹 린트 경고 1건 (`signup/address/kakao-postcode.ts`) | 이번 변경과 무관한 기존 파일                                                             |
| —    | `/api/auth/me`에 `role`                               | 본인 등급을 본인에게만 준다. 관리자 메뉴는 표시뿐이고 `/admin` API는 `AdminGuard`가 판정 |

`NEXT_PUBLIC_`·`console.log`·`dangerouslySetInnerHTML`·`.env` 커밋 — 해당 없음. `pnpm typecheck` 통과.
