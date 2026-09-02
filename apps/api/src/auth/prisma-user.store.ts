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
}
