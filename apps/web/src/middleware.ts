import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIES } from '@fixer/shared';

/**
 * 로그인해야 볼 수 있는 경로. (이슈 #5 AC2)
 *
 * 페이지마다 검사를 붙이면 새 보호 페이지를 만들 때마다 빠뜨린다.
 * 한 곳에서 판단하면 빠뜨릴 자리가 없다.
 *
 * **`/admin`은 로그인 여부까지만 여기서 본다** (#35). 관리자인지는 API의
 * `AdminGuard`가 요청마다 DB를 보고 판정한다 — `role`을 토큰에 복사하면
 * 권한을 회수당한 관리자가 토큰 수명 동안 계속 통과한다.
 */
export const PROTECTED_PATHS = ['/my', '/admin'];

/**
 * 쿠키를 **서버 단에서** 검사한다. 클라이언트 자바스크립트로는 우회할 수 없다.
 *
 * 보호 페이지 응답에 `Cache-Control: no-store`를 붙이는 것이 이 이슈의 핵심이다.
 * 이게 없으면 브라우저 bfcache(뒤로가기 할 때 페이지를 통째로 되살리는 캐시)가
 * 로그아웃 전 화면을 그대로 되살린다 — 서버에서 아무리 잘 지워도 사용자 눈에는 보인다.
 */
export function middleware(request: NextRequest): NextResponse {
  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PATHS.some(
    (protectedPath) =>
      path === protectedPath || path.startsWith(`${protectedPath}/`),
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  // 둘 중 하나만 있어도 통과다 (#83). Access 쿠키는 15분 뒤 브라우저가 지우지만
  // API는 Refresh로 갱신해 응답한다(#69 MemberGuard). 여기는 서명을 검증하지 않으므로
  // Access가 있다는 것이 Refresh가 있다는 것보다 강한 근거도 아니다. 서버에서
  // 폐기된 Refresh는 화면이 `/api/auth/me`의 401을 받고 로그인 화면으로 보낸다.
  if (
    !request.cookies.has(AUTH_COOKIES.access) &&
    !request.cookies.has(AUTH_COOKIES.refresh)
  ) {
    const login = new URL('/login', request.url);
    return NextResponse.redirect(login);
  }

  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'no-store, must-revalidate');
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
