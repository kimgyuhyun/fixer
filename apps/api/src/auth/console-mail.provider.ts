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
    // FIXME(#37): 이 검사는 fail-open이다. NODE_ENV가 비어 있는 채로 배포되면
    // 그냥 통과해 인증 코드가 운영 로그에 남는다. 허용 목록으로 바꿔야 하지만
    // `nest start`가 NODE_ENV를 설정하지 않아 개발 서버가 뜨지 않는다.
    // 제대로 된 해결은 AuthModule이 환경을 보고 메일러를 고르는 것이고,
    // 실제 발송(Resend)을 붙이는 #37에서 함께 한다.
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
