import { Injectable, Logger } from '@nestjs/common';
import type {
  NotificationMail,
  NotificationMailer,
} from './notification.service';

/**
 * 개발용 알림 메일러. 실제로 보내지 않고 서버 로그에만 찍는다. (이슈 #37)
 *
 * 실제 발송은 Resend다(`spec-fixed.md` §1). 여기는 `ConsoleMailProvider`(#1)·
 * `ConsolePaymentGateway`(#31)와 같은 자리이고, 포트 뒤라 실제 어댑터로
 * 바꾸는 것은 `notification.module.ts` 한 줄이다.
 */
@Injectable()
export class ConsoleNotificationMailer implements NotificationMailer {
  private readonly logger = new Logger(ConsoleNotificationMailer.name);

  async send(mail: NotificationMail): Promise<void> {
    await Promise.resolve();
    // 본문은 찍지 않는다. 알림 본문에는 계좌 뒤 4자리 같은 개인정보가 담긴다.
    this.logger.log(`[개발용] ${mail.to} 알림 메일: ${mail.subject}`);
  }
}
