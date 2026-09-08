import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { SuspensionRecord } from './penalty-transaction';

/**
 * 제재 중인지 묻는 포트. (이슈 #25, §5)
 *
 * 공고 등록(#12)과 지원(#17)이 **이것만** 본다. 두 곳뿐이라 가드로 올리지
 * 않는다 — 회원 식별이 아직 본문으로 오기 때문에 가드가 볼 주체도 없다.
 */
export interface SuspensionReader {
  /** 지금 유효한 제재. 없으면 null (§5.1의 `releasedAt IS NULL AND endAt > now()`) */
  findActive(userId: string, now: Date): Promise<SuspensionRecord | null>;
}

@Injectable()
export class PrismaSuspensionReader implements SuspensionReader {
  constructor(private readonly prisma: PrismaService) {}

  findActive(userId: string, now: Date): Promise<SuspensionRecord | null> {
    throw new Error('not implemented');
  }
}
