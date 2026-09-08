import { Injectable } from '@nestjs/common';
import {
  type ApplicationStatus,
  type RateRequest,
  type RatingErrorCode,
  type RatingResult,
  type RatingRole,
  type RatingSummary,
} from '@fixer/shared';

/** 별점이 던지는 도메인 에러 */
export class RatingError extends Error {
  constructor(readonly code: RatingErrorCode) {
    super(code);
    this.name = 'RatingError';
  }
}

/**
 * 별점을 매길 수 있는지 판정하는 데 필요한 거래 정보. **넷뿐이다.**
 *
 * `ApplicationService`를 통째로 주입하지 않는 이유는, 그러면 평점 도메인이
 * 지원·수락·취소에까지 닿게 되기 때문이다 (#17의 `JobPostReader`와 같은 판단).
 */
export interface RatableApplication {
  id: string;
  status: ApplicationStatus;
  applicantId: string;
  employerId: string;
}

/** 저장된 별점 한 건 */
export interface RatingRecord {
  id: string;
  applicationId: string;
  raterId: string;
  rateeId: string;
  rateeRole: RatingRole;
  score: number;
}

export interface RatingStore {
  /** 그 거래의 당사자와 상태. 없으면 null */
  findApplication(applicationId: string): Promise<RatableApplication | null>;

  /**
   * 별점 1행을 쓰고 **그 자리에서** 평가받은 사람의 역할별 캐시를 다시 집계한다.
   *
   * 유니크 제약(`applicationId, raterId`)에 걸리면 `'DUPLICATE'`다 — 예외로
   * 던지지 않는 이유는 **이것이 연타의 정상적인 결과**이기 때문이다 (#17과 같다).
   */
  create(input: {
    applicationId: string;
    raterId: string;
    rateeId: string;
    rateeRole: RatingRole;
    score: number;
  }): Promise<RatingRecord | 'DUPLICATE'>;

  /** 그 회원의 역할별 평점 캐시. 그런 회원이 없으면 null */
  summaryOf(userId: string): Promise<RatingSummary | null>;
}

/**
 * 거래 후 별점. (이슈 #26, `spec-fixed.md` §7)
 *
 * 끝난 거래의 양쪽이 서로에게 1~5를 한 번씩 남기고, 그 평균이 역할별로
 * 나뉘어 회원에게 붙는다.
 */
@Injectable()
export class RatingService {
  constructor(private readonly store: RatingStore) {}

  /** 거래 후 별점을 남긴다 (AC1~AC3) */
  async rate(_input: RateRequest): Promise<RatingResult> {
    throw new Error('not implemented');
  }

  /** 한 회원의 두 평점 (AC4~AC6) */
  async summaryOf(_userId: string): Promise<RatingSummary> {
    throw new Error('not implemented');
  }
}
