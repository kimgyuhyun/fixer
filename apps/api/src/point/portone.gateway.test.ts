import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { PortOneWebhookVerifier } from './portone.gateway';

const SECRET = 'dev-portone-webhook-secret';

function configWith(secret: string | undefined): ConfigService {
  return { get: () => secret } as unknown as ConfigService;
}

function verifier(): PortOneWebhookVerifier {
  return new PortOneWebhookVerifier(configWith(SECRET));
}

/** 포트원이 서명하는 방식 그대로 만든다 */
function signed(
  body: string,
  secret = SECRET,
): Record<string, string | undefined> {
  const id = 'wh_1';
  const timestamp = '1757000000';
  const signature = createHmac('sha256', secret)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': signature,
  };
}

const BODY = JSON.stringify({ data: { paymentId: 'pay_1' } });

describe('웹훅 서명 검증', () => {
  it('should accept a body signed with the shared secret', () => {
    expect(verifier().verify(BODY, signed(BODY))).toBe(true);
  });

  it('should reject a body signed with a different secret', () => {
    expect(verifier().verify(BODY, signed(BODY, 'attacker-secret'))).toBe(
      false,
    );
  });

  it('should reject when the body was changed after signing', () => {
    // 서명은 그대로 두고 금액만 바꿔치기하는 시도다.
    const headers = signed(BODY);
    const tampered = JSON.stringify({ data: { paymentId: 'pay_evil' } });

    expect(verifier().verify(tampered, headers)).toBe(false);
  });

  it('should reject when a signature header is missing', () => {
    const headers = signed(BODY);
    delete headers['webhook-signature'];

    expect(verifier().verify(BODY, headers)).toBe(false);
  });

  it('should reject a signature of a different length without throwing', () => {
    // timingSafeEqual은 길이가 다르면 던진다. 던지면 500이 되고,
    // 500과 401을 구분해 공격자가 길이를 알아낸다.
    expect(() =>
      verifier().verify(BODY, {
        ...signed(BODY),
        'webhook-signature': 'short',
      }),
    ).not.toThrow();
    expect(
      verifier().verify(BODY, {
        ...signed(BODY),
        'webhook-signature': 'short',
      }),
    ).toBe(false);
  });

  it('should refuse to start without a secret', () => {
    // 개발 편의로 통과시키면 그 코드가 그대로 배포된다.
    expect(() => new PortOneWebhookVerifier(configWith(undefined))).toThrow(
      /PORTONE_WEBHOOK_SECRET/,
    );
  });
});
