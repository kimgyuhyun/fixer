import { describe, expect, it } from 'vitest';
import { AccessTokenSigner } from './access-token';

/**
 * JWT 라이브러리 대신 `node:crypto`로 직접 서명하기로 했으므로(issue-4.md의
 * "판단이 갈렸던 지점"), 라이브러리가 대신 막아주던 구멍을 여기서 막는다.
 *
 * 손으로 만든 검증이 빠뜨리기 쉬운 것이 셋이다 — 페이로드만 바꾼 토큰,
 * 서명만 바꾼 토큰, `alg`를 `none`으로 바꾼 토큰.
 */
const SECRET = 'test-secret-value-for-hs256-signing';

/** base64url. JWT의 세 조각은 모두 이 인코딩이다 */
function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

describe('AccessTokenSigner', () => {
  it('should reject a token whose payload, signature or alg header was tampered with', () => {
    const signer = new AccessTokenSigner({ secret: SECRET });
    const issued = signer.sign('usr_1');
    const [header, payload, signature] = issued.value.split('.');

    // 1) 페이로드만 다른 회원 id로 바꾼 토큰
    const forgedPayload = base64url(
      JSON.stringify({ sub: 'usr_2', iat: 0, exp: 9_999_999_999 }),
    );
    expect(signer.verify(`${header}.${forgedPayload}.${signature}`)).toBeNull();

    // 2) 서명만 바꾼 토큰
    expect(signer.verify(`${header}.${payload}.${'a'.repeat(43)}`)).toBeNull();

    // 3) alg를 none으로 바꾸고 서명을 지운 토큰
    const noneHeader = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    expect(signer.verify(`${noneHeader}.${payload}.`)).toBeNull();
  });
});
