import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import {
  RATING_ERRORS,
  type RatingResult,
  type RatingSummary,
} from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { RatingController } from './rating.controller';
import { RatingError, type RatingService } from './rating.service';

const SUMMARY: RatingSummary = {
  userId: 'usr_applicant',
  asPoster: { average: 3, count: 4 },
  asWorker: { average: 4.5, count: 6 },
};

const RESULT: RatingResult = {
  id: 'rat_1',
  applicationId: 'app_1',
  raterId: 'usr_employer',
  rateeId: 'usr_applicant',
  rateeRole: 'WORKER',
  score: 5,
  ratee: SUMMARY,
};

function controllerWith(impl: Partial<RatingService>): RatingController {
  return new RatingController(impl as RatingService);
}

function statusOf(error: unknown): number {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

function bodyOf(error: unknown): { errorCode?: string } {
  return (error as HttpException).getResponse() as { errorCode?: string };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

describe('POST /ratings', () => {
  it("should answer 201 with the rated member's refreshed rating", async () => {
    const controller = controllerWith({
      rate: vi.fn().mockResolvedValue(RESULT),
    });

    expect(
      await controller.rate({
        applicationId: 'app_1',
        raterId: 'usr_employer',
        score: 5,
      }),
    ).toEqual(RESULT);
  });

  // 상태 충돌이다. 며칠 뒤 다시 눌러도 같은 거래는 이미 평가됐다.
  it('should answer 409 with RATING_ALREADY_RATED when the transaction was already rated', async () => {
    const controller = controllerWith({
      rate: vi
        .fn()
        .mockRejectedValue(new RatingError(RATING_ERRORS.ALREADY_RATED)),
    });

    const error = await rejectionOf(
      controller.rate({
        applicationId: 'app_1',
        raterId: 'usr_employer',
        score: 5,
      }),
    );

    expect(statusOf(error)).toBe(409);
    expect(bodyOf(error).errorCode).toBe(RATING_ERRORS.ALREADY_RATED);
  });

  it('should answer 409 with RATING_NOT_COMPLETED when the transaction is not completed', async () => {
    const controller = controllerWith({
      rate: vi
        .fn()
        .mockRejectedValue(new RatingError(RATING_ERRORS.NOT_COMPLETED)),
    });

    const error = await rejectionOf(
      controller.rate({
        applicationId: 'app_1',
        raterId: 'usr_employer',
        score: 5,
      }),
    );

    expect(statusOf(error)).toBe(409);
    expect(bodyOf(error).errorCode).toBe(RATING_ERRORS.NOT_COMPLETED);
  });
});

describe('GET /ratings/:userId', () => {
  it('should answer 200 with the two role averages side by side', async () => {
    const controller = controllerWith({
      summaryOf: vi.fn().mockResolvedValue(SUMMARY),
    });

    const result = await controller.summary('usr_applicant');

    expect(result.asPoster).toEqual({ average: 3, count: 4 });
    expect(result.asWorker).toEqual({ average: 4.5, count: 6 });
  });
});
