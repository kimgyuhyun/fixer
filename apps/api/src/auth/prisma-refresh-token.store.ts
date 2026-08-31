import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RefreshTokenRecord, RefreshTokenStore } from './login.service';

/**
 * `RefreshTokenStore`의 Prisma 구현체.
 *
 * 판정 로직(만료 여부·자격 대조)은 서비스에 있고 여기는 조회·쓰기만 한다 —
 * 그래야 판정을 DB 없이 단위 테스트할 수 있다. (`PrismaUserStore`와 같은 구조)
 *
 * 회전하지 않기로 했으므로(ADR-AUTH-1) 갱신 메서드가 없다.
 */
@Injectable()
export class PrismaRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshTokenRecord> {
    return this.prisma.refreshToken.create({ data: input });
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }
}
