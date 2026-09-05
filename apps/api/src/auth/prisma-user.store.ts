import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUserStore } from './login.service';
import type { UserRecord, UserStore } from './signup.service';

/**
 * `UserStore`의 Prisma 구현체.
 *
 * 판정 로직은 서비스에 있고 여기는 조회·쓰기만 한다 — 그래야 판정을 DB 없이
 * 단위 테스트할 수 있다. (`PrismaEmailVerificationStore`와 같은 구조)
 *
 * 이메일 정규화(소문자)는 서비스가 이미 마친 상태로 넘어온다.
 */
@Injectable()
export class PrismaUserStore implements UserStore, AuthUserStore {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /** 로그인(#4)이 토큰의 회원 id로 다시 조회할 때 쓴다 */
  async findById(id: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(input: {
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<UserRecord> {
    return this.prisma.user.create({ data: input });
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  /** 없는 회원이면 undefined, 활성이면 null, 비활성이면 그 시각 (#9) */
  async findDeactivatedAt(userId: string): Promise<Date | null | undefined> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { deactivatedAt: true },
    });
    return row === null ? undefined : row.deactivatedAt;
  }

  async deactivate(userId: string, at: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { deactivatedAt: at },
    });
  }

  /**
   * 비활성화를 풀고 비밀번호를 갈아끼운다. (#10)
   *
   * **`create`가 아니라 `update`다.** 새 행을 만들면 그 id를 참조하던
   * 평점·경고가 통째로 끊겨 이력 세탁이 성공한다.
   */
  async reactivate(userId: string, passwordHash: string): Promise<UserRecord> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { deactivatedAt: null, passwordHash },
    });
  }
}
