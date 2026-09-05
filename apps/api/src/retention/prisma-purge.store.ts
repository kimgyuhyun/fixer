import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { JobLock, PurgeCandidate, PurgeStore } from './purge.service';

/**
 * 파기 저장소. **`delete`가 없다.**
 *
 * 행을 지우면 5년 보관해야 하는 계약·결제 기록의 FK가 함께 깨진다
 * (`spec-fixed.md` §2.7). 컬럼만 비식별 처리한다.
 */
@Injectable()
export class PrismaPurgeStore implements PurgeStore {
  constructor(private readonly prisma: PrismaService) {}

  async findPurgeable(deactivatedBefore: Date): Promise<PurgeCandidate[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        // 경계는 아직 안 지난 것으로 본다. 하루라도 일찍 지우면 되돌릴 수 없다.
        deactivatedAt: { lt: deactivatedBefore },
        purgedAt: null,
      },
      select: {
        id: true,
        email: true,
        agreements: { select: { filePath: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      agreementFilePaths: row.agreements.map((a) => a.filePath),
    }));
  }

  async maskMember(input: {
    userId: string;
    email: string;
    previousEmail: string;
    name: string;
    purgedAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction([
      // 주소는 통째로 지운다. 마스킹할 것이 아니라 있으면 안 되는 것이다.
      this.prisma.userAddress.deleteMany({ where: { userId: input.userId } }),
      // 이메일 인증 이력은 userId가 없고 **주소를 평문으로** 들고 있다.
      // 회원 행만 마스킹하면 원래 주소가 여기 영구히 남는다.
      this.prisma.emailVerification.deleteMany({
        where: {
          email: { equals: input.previousEmail, mode: 'insensitive' },
        },
      }),
      this.prisma.user.update({
        where: { id: input.userId },
        data: {
          email: input.email,
          name: input.name,
          purgedAt: input.purgedAt,
        },
      }),
    ]);
    // 동의서 행은 남긴다 — sha256이 §9의 보존 대상이다. 파일만 밖에서 지운다.
  }
}

/**
 * PostgreSQL advisory lock. (`spec-fixed.md` §8.2)
 *
 * 서버를 여러 대로 늘려도 같은 잡이 동시에 돌지 않는다. Redis 같은 추가
 * 인프라가 필요 없다 — 이미 쓰는 Postgres만으로 진짜 분산락이 된다.
 *
 * 세션 단위 락이라 **프로세스가 죽어도 연결이 끊기면서 자동으로 풀린다.**
 */
@Injectable()
export class PostgresJobLock implements JobLock {
  constructor(private readonly prisma: PrismaService) {}

  async tryLock(key: number): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<
      { locked: boolean }[]
    >`SELECT pg_try_advisory_lock(${key}) AS locked`;
    return rows[0]?.locked === true;
  }

  async unlock(key: number): Promise<void> {
    await this.prisma.$queryRaw`SELECT pg_advisory_unlock(${key})`;
  }
}
