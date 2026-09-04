import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  MemberChecker,
  UserAddressRecord,
  UserAddressStore,
} from './user-address.service';

/**
 * `UserAddressStore`의 Prisma 구현체.
 *
 * 판정 로직은 서비스에 있고 여기는 쓰기만 한다 — 그래야 판정을 DB 없이 단위
 * 테스트할 수 있다. (`PrismaUserStore`와 같은 구조)
 */
@Injectable()
export class PrismaUserAddressStore implements UserAddressStore {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    userId: string;
    label: string;
    postalCode: string;
    roadAddress: string;
    jibunAddress: string;
    sido: string;
    sigungu: string;
    lat: number | null;
    lng: number | null;
  }): Promise<UserAddressRecord> {
    return this.prisma.userAddress.create({ data: input });
  }
}

/**
 * `MemberChecker`의 Prisma 구현체.
 *
 * 회원 전체를 읽지 않고 id 한 칸만 뽑는 이유는 포트가 예/아니오 하나만
 * 묻기 때문이다. 해시나 이메일을 굳이 메모리에 올리지 않는다.
 */
@Injectable()
export class PrismaMemberChecker implements MemberChecker {
  constructor(private readonly prisma: PrismaService) {}

  async exists(userId: string): Promise<boolean> {
    const found = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    return found !== null;
  }
}
