import { Injectable } from '@nestjs/common';
import { type RatingRole, type RatingSummary } from '@fixer/shared';
import { PrismaService } from '../prisma/prisma.service';
import type {
  RatableApplication,
  RatingRecord,
  RatingStore,
} from './rating.service';

/**
 * 별점 저장소. (이슈 #26)
 *
 * **삽입과 캐시 재집계가 한 트랜잭션이다** (`ADR-PEN-3`). 나뉘면 `Rating`
 * 행은 커밋됐는데 `User`의 평균이 옛 값인 상태가 남고, 그걸 고쳐 줄 배치가
 * 없다 (§8.1). #25가 경고와 제재를 한 트랜잭션에 둔 이유와 같다.
 */
@Injectable()
export class PrismaRatingStore implements RatingStore {
  constructor(private readonly prisma: PrismaService) {}

  async findApplication(
    _applicationId: string,
  ): Promise<RatableApplication | null> {
    throw new Error('not implemented');
  }

  async create(_input: {
    applicationId: string;
    raterId: string;
    rateeId: string;
    rateeRole: RatingRole;
    score: number;
  }): Promise<RatingRecord | 'DUPLICATE'> {
    throw new Error('not implemented');
  }

  async summaryOf(_userId: string): Promise<RatingSummary | null> {
    throw new Error('not implemented');
  }
}
