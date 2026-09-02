import type { NextRequest, NextResponse } from 'next/server';

/**
 * 로그인해야 볼 수 있는 경로. (이슈 #5 AC2)
 *
 * 페이지마다 검사를 붙이면 새 보호 페이지를 만들 때마다 빠뜨린다.
 * 한 곳에서 판단하면 빠뜨릴 자리가 없다.
 */
export const PROTECTED_PATHS = ['/my'];

export function middleware(_request: NextRequest): NextResponse {
  throw new Error('not implemented');
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
