import { Injectable, Logger } from '@nestjs/common';
import type { MailProvider } from './email-verification.service';

/**
 * 개발용 메일러. 실제로 메일을 보내지 않고 서버 로그에만 코드를 찍는다.
 *
 * `spec-fixed.md` §1에서 실제 발송은 Resend로 확정했고 그건 이슈 #37 소관이다.
 * 여기서는 화면 흐름을 끝까지 확인할 수 있게 코드를 볼 수단만 제공한다.
 *
 * 인증 코드는 개인정보에 준하므로 운영에서 로그에 남으면 안 된다.
 * 그래서 개발 환경에서만 동작하고, 그 외에서는 기동 시점에 막는다.
 */
@Injectable()
export class ConsoleMailProvider implements MailProvider {
  private readonly logger = new Logger(ConsoleMailProvider.name);

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ConsoleMailProvider는 개발 전용이다. 운영에서는 실제 MailProvider를 주입한다.',
      );
    }
  }

  async sendVerificationCode(email: string, code: string): Promise<void> {
    await Promise.resolve();
    this.logger.log(`[개발용] ${email} 인증 코드: ${code}`);
  }
}
