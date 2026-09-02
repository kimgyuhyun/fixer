import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  PasswordResetRecord,
  PasswordResetStore,
} from './password-reset.service';

/** `PasswordReset` 테이블에 붙는 어댑터. 판정은 서비스가 한다 */
@Injectable()
export class PrismaPasswordResetStore implements PasswordResetStore {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.passwordReset.create({ data: input });
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<PasswordResetRecord | null> {
    return this.prisma.passwordReset.findUnique({ where: { tokenHash } });
  }

  async consume(id: string, at: Date): Promise<void> {
    await this.prisma.passwordReset.update({
      where: { id },
      data: { consumedAt: at },
    });
  }
}
