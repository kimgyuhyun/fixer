import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { APPLICATION_ERRORS, PENALTY_ERRORS } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationController } from './application.controller';
import {
  ApplicationError,
  type ApplicationService,
} from './application.service';

function controllerWith(
  impl: Partial<ApplicationService>,
): ApplicationController {
  return new ApplicationController(impl as ApplicationService);
}

function statusOf(error: unknown): number {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

const SUMMARY = {
  id: 'app_1',
  jobPostId: 'job_1',
  applicantId: 'usr_seeker',
  status: 'APPLIED' as const,
  appliedVersion: 1,
  createdAt: '2026-09-05T00:00:00.000Z',
};

describe('POST /applications', () => {
  it('should apply as the caller when the body carries only jobPostId', async () => {
    const apply = vi.fn().mockResolvedValue(SUMMARY);
    const controller = controllerWith({ apply });

    await controller.apply('usr_seeker', { jobPostId: 'job_1' });

    expect(apply).toHaveBeenCalledWith({
      applicantId: 'usr_seeker',
      jobPostId: 'job_1',
    });
  });

  it('should ignore an applicantId in the body and apply as the caller', async () => {
    const apply = vi.fn().mockResolvedValue(SUMMARY);
    const controller = controllerWith({ apply });

    await controller.apply('usr_seeker', {
      applicantId: 'usr_someone_else',
      jobPostId: 'job_1',
    });

    expect(apply).toHaveBeenCalledWith({
      applicantId: 'usr_seeker',
      jobPostId: 'job_1',
    });
  });

  it('should respond 201 with the created application summary', async () => {
    const controller = controllerWith({
      apply: vi.fn().mockResolvedValue(SUMMARY),
    });

    const result = await controller.apply('usr_seeker', { jobPostId: 'job_1' });

    expect(result).toMatchObject({ id: 'app_1', status: 'APPLIED' });
  });

  // 없다고 하지 않는다. 본인 공고라는 사실만 말한다.
  it('should respond 403 when the error code is APPLICATION_OWN_JOB_POST', async () => {
    const controller = controllerWith({
      apply: vi
        .fn()
        .mockRejectedValue(
          new ApplicationError(APPLICATION_ERRORS.OWN_JOB_POST),
        ),
    });

    const error = await rejectionOf(
      controller.apply('usr_employer', { jobPostId: 'job_1' }),
    );

    expect(statusOf(error)).toBe(403);
  });

  it('should respond 409 when the error code is APPLICATION_ALREADY_APPLIED', async () => {
    const controller = controllerWith({
      apply: vi
        .fn()
        .mockRejectedValue(
          new ApplicationError(APPLICATION_ERRORS.ALREADY_APPLIED),
        ),
    });

    const error = await rejectionOf(
      controller.apply('usr_seeker', { jobPostId: 'job_1' }),
    );

    expect(statusOf(error)).toBe(409);
  });
});

describe('POST /applications/:id/withdraw', () => {
  it('should respond 200 with status WITHDRAWN', async () => {
    const controller = controllerWith({
      withdraw: vi
        .fn()
        .mockResolvedValue({ ...SUMMARY, status: 'WITHDRAWN' as const }),
    });

    const result = await controller.withdraw('usr_seeker', 'app_1');

    expect(result.status).toBe('WITHDRAWN');
  });

  // AC5. 버튼을 숨겨도 API를 직접 부르는 경로가 남는다.
  it('should respond 409 when the application is ACCEPTED', async () => {
    const controller = controllerWith({
      withdraw: vi
        .fn()
        .mockRejectedValue(
          new ApplicationError(APPLICATION_ERRORS.INVALID_TRANSITION),
        ),
    });

    const error = await rejectionOf(controller.withdraw('usr_seeker', 'app_1'));

    expect(statusOf(error)).toBe(409);
  });
});

describe('GET /applications/me', () => {
  it('should respond 200 with the summary when an application exists', async () => {
    const controller = controllerWith({
      findMine: vi.fn().mockResolvedValue(SUMMARY),
    });

    const result = await controller.mine('usr_seeker', { jobPostId: 'job_1' });

    expect(result).toMatchObject({ id: 'app_1' });
  });

  it('should respond 404 when the applicant has no application', async () => {
    const controller = controllerWith({
      findMine: vi.fn().mockResolvedValue(null),
    });

    const error = await rejectionOf(
      controller.mine('usr_seeker', { jobPostId: 'job_1' }),
    );

    expect(statusOf(error)).toBe(404);
  });
});

describe('POST /applications/:id/accept', () => {
  it('should respond 200 with status ACCEPTED', async () => {
    const controller = controllerWith({
      accept: vi.fn().mockResolvedValue({
        ...SUMMARY,
        status: 'ACCEPTED',
        acceptedAt: '2026-09-05T01:00:00.000Z',
      }),
    });

    const result = await controller.accept('usr_employer', 'app_1');

    expect(result).toMatchObject({ id: 'app_1', status: 'ACCEPTED' });
  });

  // 없다고 하지 않는다. 이 공고의 구인자가 아니라는 사실만 말한다.
  it('should respond 403 when the error code is APPLICATION_NOT_EMPLOYER', async () => {
    const controller = controllerWith({
      accept: vi
        .fn()
        .mockRejectedValue(
          new ApplicationError(APPLICATION_ERRORS.NOT_EMPLOYER),
        ),
    });

    const error = await rejectionOf(controller.accept('usr_남', 'app_1'));

    expect(statusOf(error)).toBe(403);
  });

  it('should respond 409 when the error code is APPLICATION_HEADCOUNT_FULL', async () => {
    const controller = controllerWith({
      accept: vi
        .fn()
        .mockRejectedValue(
          new ApplicationError(APPLICATION_ERRORS.HEADCOUNT_FULL),
        ),
    });

    const error = await rejectionOf(controller.accept('usr_employer', 'app_1'));

    expect(statusOf(error)).toBe(409);
  });

  // 없을 때 500이 나면 원인을 화면에서 알 수 없다.
});

describe('POST /applications/:id/reject', () => {
  it('should respond 200 with status REJECTED', async () => {
    const controller = controllerWith({
      reject: vi.fn().mockResolvedValue({ ...SUMMARY, status: 'REJECTED' }),
    });

    const result = await controller.reject('usr_employer', 'app_1');

    expect(result).toMatchObject({ id: 'app_1', status: 'REJECTED' });
  });

  // AC3. 수락된 신청은 취소 규칙(#20)을 따라야 한다.
  it('should respond 409 when the error code is APPLICATION_INVALID_TRANSITION', async () => {
    const controller = controllerWith({
      reject: vi
        .fn()
        .mockRejectedValue(
          new ApplicationError(APPLICATION_ERRORS.INVALID_TRANSITION),
        ),
    });

    const error = await rejectionOf(controller.reject('usr_employer', 'app_1'));

    expect(statusOf(error)).toBe(409);
  });

  // 없을 때 500이 나면 원인을 화면에서 알 수 없다.
});

describe('GET /applications', () => {
  it('should list applicants for the caller when the query carries only jobPostId', async () => {
    const listForEmployer = vi.fn().mockResolvedValue({ items: [] });
    const controller = controllerWith({ listForEmployer });

    await controller.listForEmployer('usr_employer', { jobPostId: 'job_1' });

    expect(listForEmployer).toHaveBeenCalledWith({
      jobPostId: 'job_1',
      employerId: 'usr_employer',
    });
  });

  it('should respond 200 with the applicant list', async () => {
    const controller = controllerWith({
      listForEmployer: vi.fn().mockResolvedValue({
        jobPostId: 'job_1',
        headcount: 3,
        acceptedCount: 1,
        applicants: [],
      }),
    });

    const result = await controller.listForEmployer('usr_employer', {
      jobPostId: 'job_1',
    });

    expect(result).toMatchObject({ headcount: 3, acceptedCount: 1 });
  });

  it('should respond 403 when the caller does not own the job post', async () => {
    const controller = controllerWith({
      listForEmployer: vi
        .fn()
        .mockRejectedValue(
          new ApplicationError(APPLICATION_ERRORS.NOT_EMPLOYER),
        ),
    });

    const error = await rejectionOf(
      controller.listForEmployer('usr_남', { jobPostId: 'job_1' }),
    );

    expect(statusOf(error)).toBe(403);
  });
});
const COMPLETION = {
  jobPostId: 'job_1',
  status: 'COMPLETED' as const,
  paidCount: 3,
  paidTotal: 30_000,
  releasedTotal: 30_000,
};

describe('POST /applications/complete', () => {
  it('should return the completion summary', async () => {
    const controller = controllerWith({
      complete: vi.fn().mockResolvedValue(COMPLETION),
    });

    const result = await controller.complete('usr_employer', {
      jobPostId: 'job_1',
    });

    expect(result).toMatchObject({
      status: 'COMPLETED',
      paidCount: 3,
      releasedTotal: 30_000,
    });
  });

  it('should answer 409 when the post is already COMPLETED', async () => {
    const controller = controllerWith({
      complete: vi
        .fn()
        .mockRejectedValue(
          new ApplicationError(APPLICATION_ERRORS.JOB_POST_INVALID_TRANSITION),
        ),
    });

    const error = await rejectionOf(
      controller.complete('usr_employer', { jobPostId: 'job_1' }),
    );

    expect(statusOf(error)).toBe(409);
  });
});

describe('POST /applications/:id/cancel', () => {
  const CANCELLED = {
    ...SUMMARY,
    status: 'CANCELLED_FREE' as const,
    acceptedAt: '2026-09-05T00:00:00.000Z',
  };

  it('should answer 200 with the cancelled application when the applicant cancels', async () => {
    const controller = controllerWith({
      cancel: vi.fn().mockResolvedValue(CANCELLED),
    });

    const result = await controller.cancel('usr_seeker', 'app_1');

    expect(result).toMatchObject({ id: 'app_1', status: 'CANCELLED_FREE' });
  });

  // 회원 식별이 없으면 누가 취소했는지 모른 채 계약이 깨진다.
});

describe('POST /applications/:id/no-show', () => {
  it('should answer 200 with the NO_SHOW application when the employer marks it', async () => {
    const controller = controllerWith({
      markNoShow: vi
        .fn()
        .mockResolvedValue({ ...SUMMARY, status: 'NO_SHOW' as const }),
    });

    const result = await controller.markNoShow('usr_employer', 'app_1');

    expect(result).toMatchObject({ id: 'app_1', status: 'NO_SHOW' });
  });
});

/** 제재 중 차단은 403이다. 며칠짜리라 다시 눌러도 소용없다 (#25 AC4) */
describe('POST /applications — 제재 중 (#25)', () => {
  it('should answer 403 with PENALTY_SUSPENDED when the applicant is suspended', async () => {
    const controller = controllerWith({
      apply: vi
        .fn()
        .mockRejectedValue(new ApplicationError(PENALTY_ERRORS.SUSPENDED)),
    });

    const error = await rejectionOf(
      controller.apply('usr_seeker', { jobPostId: 'job_1' }),
    );

    expect(statusOf(error)).toBe(403);
  });
});

/** 재동의 대기 화면이 받는 변경 전/후 한 벌 (#22) */
const DIFF = {
  applicationId: 'app_1',
  jobPostId: 'job_1',
  before: {
    version: 1,
    workAddress: '서울특별시 강남구 테헤란로 1',
    workStartAt: '2026-01-01T09:00:00.000Z',
    workEndAt: '2026-01-01T18:00:00.000Z',
    headcount: 2,
    rewardPerPerson: 10_000,
    requiredDescription: '창고 정리',
  },
  after: {
    version: 2,
    workAddress: '서울특별시 강남구 테헤란로 1',
    workStartAt: '2026-01-01T09:00:00.000Z',
    workEndAt: '2026-01-01T18:00:00.000Z',
    headcount: 2,
    rewardPerPerson: 12_000,
    requiredDescription: '창고 정리',
  },
  changedFields: ['rewardPerPerson' as const],
};

describe('GET /applications/:id/version-diff', () => {
  it("should answer the diff of the applicant's demoted application", async () => {
    const controller = controllerWith({
      versionDiff: vi.fn().mockResolvedValue(DIFF),
    });

    const result = await controller.versionDiff('usr_seeker', 'app_1');

    expect(result).toMatchObject({
      applicationId: 'app_1',
      changedFields: ['rewardPerPerson'],
    });
  });
});

describe('POST /applications/:id/reaccept', () => {
  it('should answer the restored application summary', async () => {
    const controller = controllerWith({
      reaccept: vi.fn().mockResolvedValue({
        ...SUMMARY,
        status: 'ACCEPTED' as const,
        appliedVersion: 2,
      }),
    });

    const result = await controller.reaccept('usr_seeker', 'app_1');

    expect(result).toMatchObject({ status: 'ACCEPTED', appliedVersion: 2 });
  });
});

describe('POST /applications/:id/decline', () => {
  it('should answer the cancelled application summary', async () => {
    const controller = controllerWith({
      declineVersionChange: vi.fn().mockResolvedValue({
        ...SUMMARY,
        status: 'CANCELLED_BY_VERSION_CHANGE' as const,
      }),
    });

    const result = await controller.decline('usr_seeker', 'app_1');

    expect(result).toMatchObject({ status: 'CANCELLED_BY_VERSION_CHANGE' });
  });
});
