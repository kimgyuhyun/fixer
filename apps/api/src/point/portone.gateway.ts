import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  GatewayPayment,
  PaymentGateway,
  PaymentStore,
  WebhookVerifier,
} from './charge.service';

/**
 * 개발용 게이트웨이. (ADR-PAY-5)
 *
 * 포트원 테스트 모드조차 채널키가 있어야 결제창이 뜬다. 키가 없을 때는
 * **우리가 박아 둔 금액을 그대로 `PAID`로 돌려준다** — 이 이슈가 검증하려는
 * 것은 포트원의 동작이 아니라 우리 쪽의 대조·멱등이기 때문이다.
 *
 * `ConsoleMailProvider`(#1)와 같은 자리다. 실결제 전환은 이 클래스를
 * `PortOneGateway`로 바꿔 끼우는 것으로 끝난다.
 */
@Injectable()
export class FakePaymentGateway implements PaymentGateway {
  private readonly logger = new Logger(FakePaymentGateway.name);

  constructor(private readonly payments: PaymentStore) {}

  async find(paymentId: string): Promise<GatewayPayment | null> {
    const ours = await this.payments.find(paymentId);
    if (!ours) return null;

    this.logger.warn(
      `가짜 결제 게이트웨이가 ${paymentId}를 PAID로 답한다. 실결제가 아니다.`,
    );
    return { id: ours.id, amount: ours.amount, status: 'PAID' };
  }
}

/** 포트원 웹훅 서명 헤더 (portone-webhook 규격) */
const SIGNATURE_HEADER = 'webhook-signature';
const TIMESTAMP_HEADER = 'webhook-timestamp';
const ID_HEADER = 'webhook-id';

/**
 * 웹훅 서명 검증.
 *
 * 비밀키가 없으면 **검증을 통과시키지 않는다.** 개발 편의로 통과시키면 그
 * 코드가 그대로 배포되어 누구나 위조 웹훅으로 잔액을 만들 수 있다.
 * 대신 개발용 비밀키를 `.env`에 두고 같은 방식으로 서명해 시험한다.
 */
@Injectable()
export class PortOneWebhookVerifier implements WebhookVerifier {
  private readonly secret: string;

  constructor(config: ConfigService) {
    const secret = config.get<string>('PORTONE_WEBHOOK_SECRET');
    if (!secret) {
      throw new Error(
        'PORTONE_WEBHOOK_SECRET이 없습니다. 저장소 루트의 .env를 확인하세요 (.env.example 참고).',
      );
    }
    this.secret = secret;
  }

  verify(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): boolean {
    const signature = headers[SIGNATURE_HEADER];
    const timestamp = headers[TIMESTAMP_HEADER];
    const id = headers[ID_HEADER];
    if (!signature || !timestamp || !id) return false;

    const expected = createHmac('sha256', this.secret)
      .update(`${id}.${timestamp}.${rawBody}`)
      .digest('base64');

    // 길이가 다르면 timingSafeEqual이 던진다. 먼저 걸러낸다.
    const given = Buffer.from(signature, 'utf8');
    const mine = Buffer.from(expected, 'utf8');
    if (given.length !== mine.length) return false;

    // 한 글자씩 비교하면 응답 시간으로 서명을 한 글자씩 맞혀 나갈 수 있다.
    return timingSafeEqual(given, mine);
  }
}
