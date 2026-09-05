import { AUTH_TOKEN_RULES } from '@fixer/shared';
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
const NOW = new Date('2026-09-01T00:00:00.000Z');
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

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

  /**
   * 사양의 15분(spec-fixed §2.5)이 **정확히 어디서** 끊기는지 못 박는다.
   * 만료 한참 뒤에만 거절되는 것을 확인하면, 경계가 1분 밀려도 테스트는
   * 그대로 초록불이라 회귀를 놓친다.
   */
  it('should accept the token one second before its expiry and reject it exactly at the expiry', () => {
    const signer = new AccessTokenSigner({ secret: SECRET });
    const issued = signer.sign('usr_1', NOW);

    expect(issued.expiresAt.getTime()).toBe(
      NOW.getTime() + AUTH_TOKEN_RULES.accessTokenMinutes * MINUTE_MS,
    );

    const oneSecondBefore = new Date(issued.expiresAt.getTime() - SECOND_MS);
    expect(signer.verify(issued.value, oneSecondBefore)?.sub).toBe('usr_1');

    // 만료 시각 그 자체는 이미 만료다. Refresh 판정과 같은 경계를 쓴다.
    expect(signer.verify(issued.value, issued.expiresAt)).toBeNull();

    const oneSecondAfter = new Date(issued.expiresAt.getTime() + SECOND_MS);
    expect(signer.verify(issued.value, oneSecondAfter)).toBeNull();
  });
});
