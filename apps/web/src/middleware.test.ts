import { NextRequest } from 'next/server';
import { AUTH_COOKIES } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import { middleware } from './middleware';

/**
 * 이 이슈의 핵심은 로그아웃이 아니라 **뒤로가기**다. (이슈 #5)
 *
 * 서버에서 아무리 잘 지워도 브라우저 bfcache(뒤로가기 할 때 페이지를 통째로
 * 되살리는 캐시)가 로그아웃 전 화면을 되살리면 사용자 눈에는 보인다.
 * 그래서 쿠키 검사와 `Cache-Control: no-store`를 서버 단에서 함께 건다.
 */
function requestFor(path: string, cookies: Record<string, string> = {}) {
  const request = new NextRequest(new URL(`https://fixer.test${path}`));
  for (const [name, value] of Object.entries(cookies)) {
    request.cookies.set(name, value);
  }
  return request;
}

const LOGGED_IN = { [AUTH_COOKIES.access]: 'access-token-value' };

describe('middleware', () => {
  it('should let the request through when the access cookie is present', () => {
    const response = middleware(requestFor('/my', LOGGED_IN));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('should redirect to /login when no auth cookie is present', () => {
    const response = middleware(requestFor('/my'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
  });

  it('should redirect to /login when only the access cookie was cleared but refresh remains', () => {
    // 로그아웃이 둘 다 지우지만, 하나만 지워진 상태로도 보호는 유지돼야 한다.
    const response = middleware(
      requestFor('/my', { [AUTH_COOKIES.refresh]: 'refresh-token-value' }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
  });

  it('should not touch public paths such as /signup/account', () => {
    const response = middleware(requestFor('/signup/account'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('should set Cache-Control no-store on a protected page response', () => {
    const response = middleware(requestFor('/my', LOGGED_IN));

    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('should not set no-store on a public page response', () => {
    const response = middleware(requestFor('/signup/account'));

    // 공개 페이지는 손대지 않는다. 헤더 자체가 붙지 않는 것이 정답이다.
    expect(response.headers.get('cache-control') ?? '').not.toContain(
      'no-store',
    );
  });
});

describe('middleware — 관리자 경로 (#35)', () => {
  it('should redirect to /login when /admin/job-posts is opened without the access cookie', () => {
    const response = middleware(requestFor('/admin/job-posts'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
  });
});
