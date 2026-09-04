import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { JOB_POST_ERRORS } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { JobPostController } from './job-post.controller';
import { JobPostError, type JobPostService } from './job-post.service';

function controllerWith(impl: Partial<JobPostService>): JobPostController {
  return new JobPostController(impl as JobPostService);
}

function statusOf(error: unknown): number {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

function bodyOf(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

const CREATED = {
  id: 'job_1',
  title: '사무실 청소',
  categoryId: 'cat_1',
  status: 'OPEN' as const,
  version: 1,
  workAddress: '서울 강남구 테헤란로 1',
  workSido: '서울',
  workSigungu: '강남구',
  workStartAt: '2026-10-01T09:00:00.000Z',
  workEndAt: '2026-10-01T18:00:00.000Z',
  headcount: 3,
  rewardPerPerson: 50_000,
  budget: 150_000,
  createdAt: '2026-09-05T00:00:00.000Z',
};

const VALID_BODY = {
  employerId: 'usr_1',
  categoryId: 'cat_1',
  title: '사무실 청소',
  workStartAt: '2026-10-01T09:00:00.000Z',
  workEndAt: '2026-10-01T18:00:00.000Z',
  headcount: 3,
  rewardPerPerson: 50_000,
  requiredDescription: '30평 사무실을 닦습니다.',
};

describe('POST /job-posts', () => {
  it('should return 201 with the created post', async () => {
    const controller = controllerWith({
      create: vi.fn().mockResolvedValue(CREATED),
    });

    await expect(controller.create(VALID_BODY)).resolves.toEqual(CREATED);
  });

  it('should return 400 when employerId is missing', async () => {
    const create = vi.fn();
    const controller = controllerWith({ create });

    const error = await rejectionOf(
      controller.create({ ...VALID_BODY, employerId: undefined }),
    );

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
    expect(create).not.toHaveBeenCalled();
  });

  it('should return 400 with a per-field error for an empty title', async () => {
    // 어느 칸이 잘못됐는지 그 칸 아래에 표시할 수 있어야 한다.
    const controller = controllerWith({ create: vi.fn() });

    const error = await rejectionOf(
      controller.create({ ...VALID_BODY, title: '' }),
    );

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(error)).toHaveProperty('fieldErrors.title');
  });

  it('should return 409 with the shortfall when the balance is short', async () => {
    const controller = controllerWith({
      create: vi.fn().mockRejectedValue(
        new JobPostError(JOB_POST_ERRORS.INSUFFICIENT_BALANCE, {
          required: 150_000,
          balance: 100_000,
          shortfall: 50_000,
        }),
      ),
    });

    const error = await rejectionOf(controller.create(VALID_BODY));

    expect(statusOf(error)).toBe(HttpStatus.CONFLICT);
    expect(bodyOf(error)).toMatchObject({
      errorCode: JOB_POST_ERRORS.INSUFFICIENT_BALANCE,
      shortfall: 50_000,
    });
    // 얼마가 모자란지 문구에도 담는다.
    expect(String(bodyOf(error).message)).toContain('50,000');
  });

  it('should return 400 when the member has no address to fall back on', async () => {
    const controller = controllerWith({
      create: vi
        .fn()
        .mockRejectedValue(
          new JobPostError(JOB_POST_ERRORS.NO_DEFAULT_ADDRESS),
        ),
    });

    const error = await rejectionOf(controller.create(VALID_BODY));

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(error).errorCode).toBe(JOB_POST_ERRORS.NO_DEFAULT_ADDRESS);
  });

  it('should let an unknown error through so it becomes 500', async () => {
    // 여기서 삼키면 원인 모를 400이 되어 디버깅이 어려워진다.
    const controller = controllerWith({
      create: vi.fn().mockRejectedValue(new Error('DB가 죽었다')),
    });

    const error = await rejectionOf(controller.create(VALID_BODY));

    expect(error).not.toBeInstanceOf(HttpException);
  });
});

describe('GET /job-posts', () => {
  it('should return the items and the total', async () => {
    const controller = controllerWith({
      list: vi.fn().mockResolvedValue({
        items: [CREATED],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    });

    await expect(controller.list({})).resolves.toEqual({
      items: [CREATED],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('should pass the query string filter straight through', async () => {
    // 필터의 진실은 URL 하나다 (ADR-JOB-4). 컨트롤러가 값을 만들어내면 안 된다.
    const list = vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 2, pageSize: 20 });
    const controller = controllerWith({ list });

    await controller.list({ category: 'cat_1', sido: '서울', page: '2' });

    expect(list).toHaveBeenCalledWith({
      category: 'cat_1',
      sido: '서울',
      page: 2,
    });
  });

  it('should fall back to page one for a page that is not a number', async () => {
    // 링크를 손으로 고친 사람에게 500을 주는 것보다 첫 페이지가 낫다.
    const list = vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    const controller = controllerWith({ list });

    await controller.list({ page: 'abc' });

    expect(list).toHaveBeenCalledWith({ page: 1 });
  });

  it('should return an empty list without failing', async () => {
    const controller = controllerWith({
      list: vi
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    });

    await expect(controller.list({})).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });
});

describe('GET /job-posts/:id', () => {
  const DETAIL = {
    ...CREATED,
    categoryName: '청소',
    requiredDescription: '30평 사무실을 닦습니다.',
    acceptedCount: 1,
  };

  it('should return the detail', async () => {
    const controller = controllerWith({
      findById: vi.fn().mockResolvedValue(DETAIL),
    });

    await expect(controller.detail('job_1')).resolves.toEqual(DETAIL);
  });

  it('should return 404 for a post that cannot be found', async () => {
    const controller = controllerWith({
      findById: vi
        .fn()
        .mockRejectedValue(new JobPostError(JOB_POST_ERRORS.NOT_FOUND)),
    });

    const error = await rejectionOf(controller.detail('job_gone'));

    expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
    expect(bodyOf(error).errorCode).toBe(JOB_POST_ERRORS.NOT_FOUND);
  });
});
describe('PATCH /job-posts/:id', () => {
  const UPDATED = {
    ...CREATED,
    version: 2,
    rewardPerPerson: 60_000,
    categoryName: '청소',
    requiredDescription: '30평 사무실을 닦습니다.',
    acceptedCount: 0,
  };

  it('should return the updated post', async () => {
    const controller = controllerWith({
      update: vi.fn().mockResolvedValue(UPDATED),
    });

    await expect(
      controller.update('job_1', {
        employerId: 'usr_1',
        rewardPerPerson: 60_000,
      }),
    ).resolves.toEqual(UPDATED);
  });

  it('should not pass employerId through as a field to change', async () => {
    // 회원 id는 수정 대상이 아니다. 그대로 넘기면 스키마가 모르는 칸이 섞인다.
    const update = vi.fn().mockResolvedValue(UPDATED);
    const controller = controllerWith({ update });

    await controller.update('job_1', {
      employerId: 'usr_1',
      rewardPerPerson: 60_000,
    });

    expect(update).toHaveBeenCalledWith({
      employerId: 'usr_1',
      jobPostId: 'job_1',
      patch: { rewardPerPerson: 60_000 },
    });
  });

  it('should return 400 when employerId is missing', async () => {
    const update = vi.fn();
    const controller = controllerWith({ update });

    const error = await rejectionOf(
      controller.update('job_1', { rewardPerPerson: 60_000 }),
    );

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
    expect(update).not.toHaveBeenCalled();
  });

  it('should return 403 for a post owned by another member', async () => {
    const controller = controllerWith({
      update: vi
        .fn()
        .mockRejectedValue(new JobPostError(JOB_POST_ERRORS.NOT_OWNED)),
    });

    const error = await rejectionOf(
      controller.update('job_1', { employerId: 'usr_1' }),
    );

    expect(statusOf(error)).toBe(HttpStatus.FORBIDDEN);
  });

  it('should return 409 when the post is not open', async () => {
    const controller = controllerWith({
      update: vi
        .fn()
        .mockRejectedValue(new JobPostError(JOB_POST_ERRORS.NOT_EDITABLE)),
    });

    const error = await rejectionOf(
      controller.update('job_1', { employerId: 'usr_1' }),
    );

    expect(statusOf(error)).toBe(HttpStatus.CONFLICT);
    expect(bodyOf(error).errorCode).toBe(JOB_POST_ERRORS.NOT_EDITABLE);
  });

  it('should return 404 for a post that cannot be found', async () => {
    const controller = controllerWith({
      update: vi
        .fn()
        .mockRejectedValue(new JobPostError(JOB_POST_ERRORS.NOT_FOUND)),
    });

    const error = await rejectionOf(
      controller.update('job_gone', { employerId: 'usr_1' }),
    );

    expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
  });
});

describe('GET /job-posts/:id/versions/:version', () => {
  const SNAPSHOT = {
    version: 2,
    workAddress: '서울 강남구 테헤란로 1',
    workStartAt: '2026-10-01T09:00:00.000Z',
    workEndAt: '2026-10-01T18:00:00.000Z',
    headcount: 3,
    rewardPerPerson: 60_000,
    requiredDescription: '30평 사무실을 닦습니다.',
  };

  it('should return the six required fields of that version', async () => {
    const findVersion = vi.fn().mockResolvedValue(SNAPSHOT);
    const controller = controllerWith({ findVersion });

    await expect(controller.version('job_1', '2')).resolves.toEqual(SNAPSHOT);
    expect(findVersion).toHaveBeenCalledWith('job_1', 2);
  });

  it('should return 404 for a version that was never written', async () => {
    const controller = controllerWith({
      findVersion: vi
        .fn()
        .mockRejectedValue(new JobPostError(JOB_POST_ERRORS.VERSION_NOT_FOUND)),
    });

    const error = await rejectionOf(controller.version('job_1', '9'));

    expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
  });
});
