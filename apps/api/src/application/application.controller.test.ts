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
