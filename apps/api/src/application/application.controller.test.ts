import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { APPLICATION_ERRORS } from '@fixer/shared';
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
  it('should respond 201 with the created application summary', async () => {
    const controller = controllerWith({
      apply: vi.fn().mockResolvedValue(SUMMARY),
    });

    const result = await controller.apply({
      applicantId: 'usr_seeker',
      jobPostId: 'job_1',
    });

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
      controller.apply({ applicantId: 'usr_employer', jobPostId: 'job_1' }),
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
      controller.apply({ applicantId: 'usr_seeker', jobPostId: 'job_1' }),
    );

    expect(statusOf(error)).toBe(409);
  });

  it('should respond 400 when the body has no applicantId', async () => {
    const controller = controllerWith({ apply: vi.fn() });

    const error = await rejectionOf(controller.apply({ jobPostId: 'job_1' }));

    expect(statusOf(error)).toBe(400);
  });
});

describe('POST /applications/:id/withdraw', () => {
  it('should respond 200 with status WITHDRAWN', async () => {
    const controller = controllerWith({
      withdraw: vi
        .fn()
        .mockResolvedValue({ ...SUMMARY, status: 'WITHDRAWN' as const }),
    });

    const result = await controller.withdraw('app_1', {
      applicantId: 'usr_seeker',
    });

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

    const error = await rejectionOf(
      controller.withdraw('app_1', { applicantId: 'usr_seeker' }),
    );

    expect(statusOf(error)).toBe(409);
  });
});

describe('GET /applications/me', () => {
  it('should respond 200 with the summary when an application exists', async () => {
    const controller = controllerWith({
      findMine: vi.fn().mockResolvedValue(SUMMARY),
    });

    const result = await controller.mine({
      jobPostId: 'job_1',
      applicantId: 'usr_seeker',
    });

    expect(result).toMatchObject({ id: 'app_1' });
  });

  it('should respond 404 when the applicant has no application', async () => {
    const controller = controllerWith({
      findMine: vi.fn().mockResolvedValue(null),
    });

    const error = await rejectionOf(
      controller.mine({ jobPostId: 'job_1', applicantId: 'usr_seeker' }),
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

    const result = await controller.accept('app_1', {
      employerId: 'usr_employer',
    });

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

    const error = await rejectionOf(
      controller.accept('app_1', { employerId: 'usr_남' }),
    );

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

    const error = await rejectionOf(
      controller.accept('app_1', { employerId: 'usr_employer' }),
    );

    expect(statusOf(error)).toBe(409);
  });

  // 없을 때 500이 나면 원인을 화면에서 알 수 없다.
  it('should respond 400 when the body has no employerId', async () => {
    const controller = controllerWith({ accept: vi.fn() });

    const error = await rejectionOf(controller.accept('app_1', {}));

    expect(statusOf(error)).toBe(400);
  });
});

describe('GET /applications', () => {
  it('should respond 200 with the applicant list', async () => {
    const controller = controllerWith({
      listForEmployer: vi.fn().mockResolvedValue({
        jobPostId: 'job_1',
        headcount: 3,
        acceptedCount: 1,
        applicants: [],
      }),
    });

    const result = await controller.listForEmployer({
      jobPostId: 'job_1',
      employerId: 'usr_employer',
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
      controller.listForEmployer({ jobPostId: 'job_1', employerId: 'usr_남' }),
    );

    expect(statusOf(error)).toBe(403);
  });
});
