import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  EmailVerificationRecord,
  EmailVerificationStore,
} from './email-verification.service';
import type { EmailVerificationChecker } from './signup.service';

/**
 * `EmailVerificationStore`의 Prisma 구현체.
 *
 * 서비스는 이 포트를 통해서만 DB를 만진다. 시간·횟수 판정 로직은 서비스에 있고
 * 여기는 조회·쓰기만 한다 — 그래야 판정을 DB 없이 단위 테스트할 수 있다.
 */
@Injectable()
export class PrismaEmailVerificationStore
  implements EmailVerificationStore, EmailVerificationChecker
{
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 가입(#2)이 묻는 "이 이메일이 인증을 마쳤는가".
   *
   * ADR-AUTH-4에는 인증됨 플래그가 따로 없다. 코드를 맞힌 순간 그 행의
   * consumedAt이 채워지므로, 소비된 행이 하나라도 있으면 인증을 마친 것이다.
   */
  async isVerified(email: string): Promise<boolean> {
    const consumed = await this.prisma.emailVerification.findFirst({
      // #1은 사용자가 입력한 대소문자 그대로 발급 이력을 쌓는다. 가입은
      // 소문자로 정규화한 주소로 물으므로 여기서 대소문자를 무시해야
      // "인증은 했는데 가입이 막히는" 상태가 생기지 않는다.
      where: {
        email: { equals: email, mode: 'insensitive' },
        consumedAt: { not: null },
      },
      select: { id: true },
    });
    return consumed !== null;
  }

  /**
   * 되살리기(#10)가 묻는 "**이번에** 인증을 마쳤는가".
   *
   * `isVerified`를 그대로 쓰면 안 된다. 그건 "언젠가 인증한 적 있다"라서,
   * 최초 가입 때 남은 행 하나로 **영구히** 참이 된다. 되살리기는 기존
   * 계정에 새 비밀번호를 심는 작업이므로, 그 조건이면 이메일 주소만 아는
   * 사람이 남의 탈퇴 계정을 가져갈 수 있다.
   *
   * 그래서 **탈퇴 시각 이후에 소비된** 인증만 인정한다. 되살리려는 사람은
   * 지금 메일함을 쥐고 있어야 한다.
   */
  async isVerifiedSince(email: string, since: Date): Promise<boolean> {
    const consumed = await this.prisma.emailVerification.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        consumedAt: { gt: since },
      },
      select: { id: true },
    });
    return consumed !== null;
  }

  async create(input: {
    email: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<EmailVerificationRecord> {
    return this.prisma.emailVerification.create({ data: input });
  }

  /** 쿨다운 판정용. 소비·만료 여부와 무관하게 가장 최근 1건 */
  async findLatest(email: string): Promise<EmailVerificationRecord | null> {
    return this.prisma.emailVerification.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 시간당 발송 수 판정용 */
  async countSince(email: string, since: Date): Promise<number> {
    return this.prisma.emailVerification.count({
      where: { email, createdAt: { gte: since } },
    });
  }

  async markConsumed(id: string, consumedAt: Date): Promise<void> {
    await this.prisma.emailVerification.update({
      where: { id },
      data: { consumedAt },
    });
  }

  async incrementAttempt(id: string): Promise<void> {
    await this.prisma.emailVerification.update({
      where: { id },
      data: { attemptCount: { increment: 1 } },
    });
  }
}
