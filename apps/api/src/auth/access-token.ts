import { createHmac, timingSafeEqual } from 'node:crypto';
import { AUTH_TOKEN_RULES } from '@fixer/shared';

/**
 * Access 토큰(JWT) 서명·검증. (이슈 #4, spec-fixed §2.5)
 *
 * JWT(JSON Web Token, 서명이 붙어 있어 위조를 검출할 수 있는 문자열 토큰)의
 * HS256은 `base64url(헤더).base64url(페이로드).HMAC-SHA256` 세 조각이 전부라
 * 라이브러리를 새로 들이지 않고 `node:crypto`로 직접 만든다. 대신 라이브러리가
 * 대신 막아주던 구멍(alg 위조·서명 위조)은 테스트로 못 박는다.
 */
export interface AccessTokenConfig {
  secret: string;
  /** 테스트가 만료를 앞당길 수 있도록 분 단위를 주입받는다 */
  expiresInMinutes?: number;
}

export interface AccessTokenPayload {
  /** 회원 id */
  sub: string;
  /** 발급 시각 (초) */
  iat: number;
  /** 만료 시각 (초) */
  exp: number;
}

export interface SignedAccessToken {
  value: string;
  expiresAt: Date;
}

/** 이 서명자가 받아주는 유일한 헤더. `alg`를 바꾼 토큰은 여기서 걸린다 */
const HEADER = { alg: 'HS256', typ: 'JWT' } as const;

const MINUTE_MS = 60 * 1000;

function encodeSegment(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export class AccessTokenSigner {
  private readonly header = encodeSegment(HEADER);

  constructor(private readonly config: AccessTokenConfig) {}

  sign(userId: string, now: Date = new Date()): SignedAccessToken {
    const expiresAt = new Date(
      now.getTime() + this.expiresInMinutes * MINUTE_MS,
    );
    const payload = encodeSegment({
      sub: userId,
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
    } satisfies AccessTokenPayload);

    const signingInput = `${this.header}.${payload}`;
    return {
      value: `${signingInput}.${this.signatureOf(signingInput)}`,
      expiresAt,
    };
  }

  /**
   * 위조·만료면 `null`. 예외를 던지지 않는 이유는 호출부가 곧바로 갱신
   * 경로로 넘어가기 때문이다.
   */
  verify(token: string, now: Date = new Date()): AccessTokenPayload | null {
    const segments = token.split('.');
    if (segments.length !== 3) return null;

    const [header, payload, signature] = segments;
    // 헤더를 우리가 만든 것과 통째로 대조한다. `alg: none`은 물론이고
    // 알고리즘을 바꿔치기하는 어떤 변형도 여기서 끝난다.
    if (header !== this.header) return null;
    if (!this.isOurSignature(`${header}.${payload}`, signature)) return null;

    const claims = decodeClaims(payload);
    if (claims === null) return null;
    // 만료 시각 그 자체는 이미 만료다. Refresh 판정과 같은 경계를 쓴다.
    if (now.getTime() >= claims.exp * 1000) return null;

    return claims;
  }

  /** 설정된 수명(분). 주입이 없으면 사양값 15분 */
  get expiresInMinutes(): number {
    return this.config.expiresInMinutes ?? AUTH_TOKEN_RULES.accessTokenMinutes;
  }

  private signatureOf(signingInput: string): string {
    return createHmac('sha256', this.config.secret)
      .update(signingInput)
      .digest('base64url');
  }

  /**
   * 서명 비교는 상수 시간으로 한다. 문자열 `===`는 앞에서부터 다른 곳이
   * 나오면 즉시 끝나서, 걸린 시간으로 정답에 얼마나 가까웠는지가 새어나간다.
   */
  private isOurSignature(signingInput: string, signature: string): boolean {
    const expected = Buffer.from(this.signatureOf(signingInput), 'base64url');
    const actual = Buffer.from(signature, 'base64url');
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }
}

/** 페이로드가 우리가 넣은 모양인지까지 확인한다 */
function decodeClaims(payload: string): AccessTokenPayload | null {
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );
    if (typeof claims !== 'object' || claims === null) return null;

    const { sub, iat, exp } = claims as Record<string, unknown>;
    if (typeof sub !== 'string' || sub === '') return null;
    if (typeof iat !== 'number' || typeof exp !== 'number') return null;

    return { sub, iat, exp };
  } catch {
    return null;
  }
}
