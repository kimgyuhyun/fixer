import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  EmailVerificationRecord,
  EmailVerificationStore,
} from './email-verification.service';

/**
 * `EmailVerificationStore`의 Prisma 구현체.
 *
 * 서비스는 이 포트를 통해서만 DB를 만진다. 시간·횟수 판정 로직은 서비스에 있고
 * 여기는 조회·쓰기만 한다 — 그래야 판정을 DB 없이 단위 테스트할 수 있다.
 */
@Injectable()
export class PrismaEmailVerificationStore implements EmailVerificationStore {
  constructor(private readonly prisma: PrismaService) {}

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
