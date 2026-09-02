# 이슈 #5 — 로그아웃하면 뒤로가기로도 보호 페이지를 못 본다

> 선행 #4 (로그인) · 도메인 auth-member · 크기 M
> 브랜치 `feat/auth-member/issue-5` (base: `feat/auth-member/issue-4`)

로그아웃 구현 자체는 쉽다. **이 이슈가 따로 있는 이유는 뒤로가기다.**
브라우저 bfcache(뒤로가기 할 때 페이지를 통째로 되살리는 캐시)가 로그아웃 전
화면을 그대로 되살리면, 서버에서 아무리 잘 지워도 사용자 눈에는 보호 페이지가 보인다.

---

## 시그니처

### 서버

```ts
// apps/api/src/auth/login.service.ts — 기존 포트에 하나 추가
export interface RefreshTokenStore {
  create(...): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  deleteByTokenHash(tokenHash: string): Promise<void>;   // ← 추가
}

/**
 * 로그아웃. 서버에 남은 Refresh 토큰 행을 지운다.
 *
 * 토큰이 없거나 이미 지워졌어도 성공으로 본다 — 로그아웃은 멱등해야 한다.
 * "이미 로그아웃된 상태"는 사용자가 고칠 수 있는 잘못이 아니다.
 */
logout(refreshToken: string | undefined): Promise<void>
```

```ts
// apps/api/src/auth/login.controller.ts
POST /auth/logout  →  204 No Content
  - 쿠키 fixer_access, fixer_refresh 를 지운다 (설정할 때와 같은 속성으로)
  - 서버의 Refresh 행을 지운다
```

### 웹

```ts
// apps/web/src/middleware.ts  (새 파일)

/** 로그인해야 볼 수 있는 경로 */
const PROTECTED = ['/my'];

/**
 * 쿠키를 서버 단에서 검사한다. 클라이언트 자바스크립트로는 우회할 수 없다.
 *
 * 보호 페이지 응답에 `Cache-Control: no-store`를 붙인다. 이게 없으면
 * 뒤로가기가 bfcache에서 로그아웃 전 화면을 되살린다.
 */
export function middleware(request: NextRequest): NextResponse
export const config = { matcher: [...] }
```

---

## 판단이 갈렸던 지점

**로그아웃을 멱등하게 둔다.**
토큰이 없는 채로 `POST /auth/logout`이 와도 204를 준다. 401을 주면 "이미 로그아웃된
사용자가 로그아웃 버튼을 두 번 눌렀을 때" 에러 화면을 보게 된다. 지우려는 상태와
지워진 상태가 같으므로 실패로 볼 이유가 없다.

**`no-store`를 미들웨어에서 붙인다.**
페이지 컴포넌트마다 붙이면 새 보호 페이지를 만들 때마다 빠뜨린다. 경로 목록 한 곳에서
판단하면 빠뜨릴 자리가 없다.

**Refresh 회전은 하지 않는다 (ADR-AUTH-1).**
로그아웃은 그 세션의 행 하나만 지운다. 다른 기기의 로그인은 살아 있어야 한다.

---

## 시나리오

### 로그아웃 — 서버 (AC1)

- [ ] [정상] `logout` — should delete the refresh token row that matches the given token
- [ ] [정상] `logout` — should leave the refresh tokens of other sessions untouched
- [ ] [경계] `logout` — should succeed when no refresh token was given
- [ ] [경계] `logout` — should succeed when the refresh token is already gone

### 로그아웃 — HTTP (AC1)

- [ ] [정상] `POST /auth/logout` — should return 204 and clear both auth cookies
- [ ] [경계] `POST /auth/logout` — should return 204 even when the request carries no cookies

### 지워진 토큰은 거절 (AC4)

- [ ] [예외] `authenticate` — should reject with AUTH_SESSION_EXPIRED when the refresh token row was deleted
- [ ] [예외] `GET /auth/me` — should return 401 when the refresh token was deleted by a logout

### 보호 페이지 접근 (AC2)

- [ ] [정상] `middleware` — should let the request through when the access cookie is present
- [ ] [정상] `middleware` — should redirect to /login when no auth cookie is present
- [ ] [경계] `middleware` — should not touch public paths such as /signup/account
- [ ] [경계] `middleware` — should redirect to /login when only the access cookie was cleared but refresh remains

### 캐시 헤더 (AC3)

- [ ] [정상] `middleware` — should set Cache-Control no-store on a protected page response
- [ ] [경계] `middleware` — should not set no-store on a public page response

### 화면 (AC1·AC2)

- [ ] [화면] `MyPage` — should call the logout endpoint and move to /login when 로그아웃 is pressed
- [ ] [화면] `MyPage` — should still move to /login when the logout request fails

**총 16개** (정상 7 / 경계 6 / 예외 2 / 화면 2 — 일부 중복 집계 없음)

---

## AC 대조

| #   | AC                                                          | 커버하는 시나리오                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 로그아웃하면 쿠키가 지워지고 서버의 Refresh 토큰도 삭제된다 | `logout — should delete the refresh token row...` 외 3<br>`POST /auth/logout — should return 204 and clear both auth cookies` 외 1<br>`MyPage — should call the logout endpoint...`                                                                                                                                             |
| 2   | 로그아웃 직후 뒤로가기로 마이페이지에 가면 로그인 화면으로  | `middleware — should redirect to /login when no auth cookie is present`<br>`middleware — should let the request through...`<br>`middleware — should not touch public paths...`<br>`middleware — should redirect ... only the access cookie was cleared`<br>`MyPage — should still move to /login when the logout request fails` |
| 3   | 보호 페이지 응답에 `Cache-Control: no-store`가 있다         | `middleware — should set Cache-Control no-store on a protected page response`<br>`middleware — should not set no-store on a public page response`                                                                                                                                                                               |
| 4   | 로그아웃된 Refresh 토큰으로 갱신을 시도하면 거절된다        | `authenticate — should reject with AUTH_SESSION_EXPIRED when the refresh token row was deleted`<br>`GET /auth/me — should return 401 when the refresh token was deleted by a logout`                                                                                                                                            |

**커버리지: AC 4개 전부 커버 / 시나리오 16개 / 미커버 0개**

---

## 이번 범위 밖

| 항목                        | 어디서                                                 |
| --------------------------- | ------------------------------------------------------ |
| 다른 기기 강제 로그아웃     | ADR-AUTH-1대로 `deleteMany(userId)`면 되지만 AC에 없다 |
| 실제 브라우저 뒤로가기 검증 | E2E(Playwright). 단위로는 헤더까지만 본다              |
| 세션 목록 화면              | AC에 없다                                              |
