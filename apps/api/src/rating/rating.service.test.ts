import {
  RATING_ERRORS,
  type ApplicationStatus,
  type RatingSummary,
} from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  RatingError,
  RatingService,
  type RatableApplication,
  type RatingRecord,
  type RatingStore,
} from './rating.service';

const APPLICATION = 'app_1';
const EMPLOYER = 'usr_employer';
const APPLICANT = 'usr_applicant';

function application(status: ApplicationStatus): RatableApplication {
  return {
    id: APPLICATION,
    status,
    applicantId: APPLICANT,
    employerId: EMPLOYER,
  };
}

function emptySummary(userId: string): RatingSummary {
  return {
    userId,
    asPoster: { average: null, count: 0 },
    asWorker: { average: null, count: 0 },
  };
}

/**
 * 별점을 실제로 쌓아 두고 역할별로 다시 세는 가짜 저장소.
 *
 * 평균을 그때그때 계산하는 이유는, **캐시가 갱신됐는지**가 AC1의 문장
 * 자체이기 때문이다. 고정값을 돌려주면 서비스가 저장을 건너뛰어도 통과한다.
 */
class FakeRatings implements RatingStore {
  readonly rows: RatingRecord[] = [];

  constructor(private readonly target: RatableApplication | null) {}

  findApplication(): Promise<RatableApplication | null> {
    return Promise.resolve(this.target);
  }

  create(input: {
    applicationId: string;
    raterId: string;
    rateeId: string;
    rateeRole: RatingRecord['rateeRole'];
    score: number;
  }): Promise<RatingRecord | 'DUPLICATE'> {
    const duplicated = this.rows.some(
      (row) =>
        row.applicationId === input.applicationId &&
        row.raterId === input.raterId,
    );
    if (duplicated) return Promise.resolve('DUPLICATE');

    const row: RatingRecord = { id: `rat_${this.rows.length + 1}`, ...input };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  summaryOf(userId: string): Promise<RatingSummary | null> {
    return Promise.resolve({
      userId,
      asPoster: this.roleOf(userId, 'POSTER'),
      asWorker: this.roleOf(userId, 'WORKER'),
    });
  }

  private roleOf(userId: string, role: RatingRecord['rateeRole']) {
    const scores = this.rows
      .filter((row) => row.rateeId === userId && row.rateeRole === role)
      .map((row) => row.score);
    if (scores.length === 0) return { average: null, count: 0 };
    return {
      average: scores.reduce((sum, score) => sum + score, 0) / scores.length,
      count: scores.length,
    };
  }
}

/** 그런 회원이 아예 없는 저장소 */
class NoSuchUser implements RatingStore {
  findApplication(): Promise<RatableApplication | null> {
    return Promise.resolve(null);
  }

  create(): Promise<RatingRecord | 'DUPLICATE'> {
    throw new Error('쓰지 않는다');
  }

  summaryOf(): Promise<RatingSummary | null> {
    return Promise.resolve(null);
  }
}

function serviceFor(status: ApplicationStatus) {
  const store = new FakeRatings(application(status));
  return { store, service: new RatingService(store) };
}

describe('rate', () => {
  it('should store the score and refresh the worker rating when the employer rates a completed transaction', async () => {
    const { store, service } = serviceFor('COMPLETED');

    const result = await service.rate({
      applicationId: APPLICATION,
      raterId: EMPLOYER,
      score: 4,
    });

    expect(store.rows).toHaveLength(1);
    expect(result.ratee.asWorker).toEqual({ average: 4, count: 1 });
  });

  it('should store the score and refresh the poster rating when the applicant rates the employer', async () => {
    const { service } = serviceFor('COMPLETED');

    const result = await service.rate({
      applicationId: APPLICATION,
      raterId: APPLICANT,
      score: 5,
    });

    expect(result.rateeId).toBe(EMPLOYER);
    expect(result.ratee.asPoster).toEqual({ average: 5, count: 1 });
  });

  // 경계다. 1과 5는 받고 그 밖은 받지 않는다 (§7 "별점 1~5").
  it('should store a score of exactly 1', async () => {
    const { service } = serviceFor('COMPLETED');

    const result = await service.rate({
      applicationId: APPLICATION,
      raterId: EMPLOYER,
      score: 1,
    });

    expect(result.score).toBe(1);
  });

  it('should store a score of exactly 5', async () => {
    const { service } = serviceFor('COMPLETED');

    const result = await service.rate({
      applicationId: APPLICATION,
      raterId: EMPLOYER,
      score: 5,
    });

    expect(result.score).toBe(5);
  });

  it('should reject a score below 1', async () => {
    const { service } = serviceFor('COMPLETED');

    await expect(
      service.rate({ applicationId: APPLICATION, raterId: EMPLOYER, score: 0 }),
    ).rejects.toThrow(ZodError);
  });

  it('should reject a score above 5', async () => {
    const { service } = serviceFor('COMPLETED');

    await expect(
      service.rate({ applicationId: APPLICATION, raterId: EMPLOYER, score: 6 }),
    ).rejects.toThrow(ZodError);
  });

  // 4.5점을 별로 그릴 방법이 화면에 없다.
  it('should reject a fractional score', async () => {
    const { service } = serviceFor('COMPLETED');

    await expect(
      service.rate({
        applicationId: APPLICATION,
        raterId: EMPLOYER,
        score: 4.5,
      }),
    ).rejects.toThrow(ZodError);
  });

  it('should throw RATING_ALREADY_RATED when the same rater rates the same transaction twice', async () => {
    const { service } = serviceFor('COMPLETED');
    await service.rate({
      applicationId: APPLICATION,
      raterId: EMPLOYER,
      score: 4,
    });

    await expect(
      service.rate({ applicationId: APPLICATION, raterId: EMPLOYER, score: 2 }),
    ).rejects.toThrow(new RatingError(RATING_ERRORS.ALREADY_RATED));
  });

  it('should throw RATING_NOT_COMPLETED when the transaction is still ACCEPTED', async () => {
    const { service } = serviceFor('ACCEPTED');

    await expect(
      service.rate({ applicationId: APPLICATION, raterId: EMPLOYER, score: 4 }),
    ).rejects.toThrow(new RatingError(RATING_ERRORS.NOT_COMPLETED));
  });

  it('should throw RATING_NOT_COMPLETED when the transaction ended as NO_SHOW', async () => {
    const { service } = serviceFor('NO_SHOW');

    await expect(
      service.rate({ applicationId: APPLICATION, raterId: EMPLOYER, score: 1 }),
    ).rejects.toThrow(new RatingError(RATING_ERRORS.NOT_COMPLETED));
  });

  it('should throw RATING_NOT_PARTICIPANT when someone outside the transaction rates', async () => {
    const { service } = serviceFor('COMPLETED');

    await expect(
      service.rate({
        applicationId: APPLICATION,
        raterId: 'usr_stranger',
        score: 5,
      }),
    ).rejects.toThrow(new RatingError(RATING_ERRORS.NOT_PARTICIPANT));
  });

  it('should throw RATING_APPLICATION_NOT_FOUND when there is no such transaction', async () => {
    const service = new RatingService(new FakeRatings(null));

    await expect(
      service.rate({ applicationId: 'app_none', raterId: EMPLOYER, score: 3 }),
    ).rejects.toThrow(new RatingError(RATING_ERRORS.APPLICATION_NOT_FOUND));
  });
});

describe('summaryOf', () => {
  it('should report the average of the scores the member received as a worker', async () => {
    const { store, service } = serviceFor('COMPLETED');
    store.rows.push(
      row('rat_1', APPLICANT, 'WORKER', 5),
      row('rat_2', APPLICANT, 'WORKER', 4),
      row('rat_3', APPLICANT, 'WORKER', 3),
    );

    expect((await service.summaryOf(APPLICANT)).asWorker).toEqual({
      average: 4,
      count: 3,
    });
  });

  // 표본이 없으면 평균은 null이다. 0.0으로 두면 "0점을 받았다"와 구분이 안 된다.
  it('should report a null average and a zero count when the member was never rated', async () => {
    const { service } = serviceFor('COMPLETED');

    expect(await service.summaryOf(APPLICANT)).toEqual(emptySummary(APPLICANT));
  });

  // 서버는 감추지 않고 그대로 준다. "신규"로 그릴지는 화면의 판정이다.
  it('should report a count of 2 while the average is still hidden by the display rule', async () => {
    const { store, service } = serviceFor('COMPLETED');
    store.rows.push(
      row('rat_1', APPLICANT, 'WORKER', 1),
      row('rat_2', APPLICANT, 'WORKER', 5),
    );

    expect((await service.summaryOf(APPLICANT)).asWorker).toEqual({
      average: 3,
      count: 2,
    });
  });

  it('should keep the two roles apart when the member was rated in both roles', async () => {
    const { store, service } = serviceFor('COMPLETED');
    store.rows.push(
      row('rat_1', APPLICANT, 'WORKER', 5),
      row('rat_2', APPLICANT, 'POSTER', 2),
    );

    const summary = await service.summaryOf(APPLICANT);

    expect(summary.asWorker).toEqual({ average: 5, count: 1 });
    expect(summary.asPoster).toEqual({ average: 2, count: 1 });
  });

  it('should throw RATING_USER_NOT_FOUND when there is no such member', async () => {
    const service = new RatingService(new NoSuchUser());

    await expect(service.summaryOf('usr_none')).rejects.toThrow(
      new RatingError(RATING_ERRORS.USER_NOT_FOUND),
    );
  });
});

function row(
  id: string,
  rateeId: string,
  rateeRole: RatingRecord['rateeRole'],
  score: number,
): RatingRecord {
  return {
    id,
    applicationId: APPLICATION,
    raterId: 'usr_other',
    rateeId,
    rateeRole,
    score,
  };
}
