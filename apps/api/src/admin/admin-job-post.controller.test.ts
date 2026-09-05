import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ADMIN_ERRORS,
  AUTH_COOKIES,
  type AdminJobPostSummary,
} from '@fixer/shared';
import type { AddressInfo, Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LoginService } from '../auth/login.service';
import { AdminJobPostController } from './admin-job-post.controller';
import { AdminJobPostService } from './admin-job-post.service';
import { AdminGuard, ROLE_READER } from './admin.guard';

/**
 * **진짜 HTTP로 두드린다.** 컨트롤러를 직접 `new`로 만들면 가드가 안 걸려서
 * "관리자가 아니면 403"이 검증되지 않는다 — 이 이슈에서 가드가 산출물이므로
 * 그 배선까지가 검증 대상이다.
 */
let app: INestApplication | undefined;

const ROW: AdminJobPostSummary = {
  id: 'job_1',
  title: '사무실 청소',
  employerName: '박구인',
  categoryName: '청소',
  status: 'OPEN',
  createdAt: '2026-09-01T00:00:00.000Z',
};

/**
 * 서비스가 받은 인자를 적어 둔다.
 *
 * **감사 로그의 "누가"가 어디서 왔는지**를 이걸로 본다. `adminId`를 손으로
 * 넘기는 테스트만 있으면 세션에서 왔는지 본문에서 왔는지 구분할 수 없다.
 */
const forceCancelCalls: { adminId: string; jobPostId: string }[] = [];

async function startWith(
  role: 'USER' | 'ADMIN',
  sessionUserId = 'usr_1',
): Promise<string> {
  forceCancelCalls.length = 0;
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminJobPostController],
    providers: [
      {
        provide: AdminJobPostService,
        useValue: {
          list: () =>
            Promise.resolve({
              items: [ROW],
              total: 1,
              page: 1,
              pageSize: 20,
            }),
          forceCancel: (input: { adminId: string; jobPostId: string }) => {
            forceCancelCalls.push(input);
            return Promise.resolve({
              id: input.jobPostId,
              status: 'CANCELLED',
              released: 150_000,
              penalized: false,
            });
          },
        },
      },
      {
        provide: LoginService,
        useValue: {
          authenticate: () => Promise.resolve({ userId: sessionUserId }),
        },
      },
      // 진짜 가드를 쓴다. 대역으로 바꿔치면 배선이 빠져도 초록불이 된다.
      AdminGuard,
      {
        provide: ROLE_READER,
        useValue: { roleOf: () => Promise.resolve(role) },
      },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  const server = app.getHttpServer() as Server;
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const COOKIE = `${AUTH_COOKIES.access}=tok`;

describe('AdminJobPostController', () => {
  it('should answer 403 with ADMIN_FORBIDDEN when a non-admin calls the list endpoint', async () => {
    const base = await startWith('USER');

    const response = await fetch(`${base}/admin/job-posts`, {
      headers: { cookie: COOKIE },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: ADMIN_ERRORS.FORBIDDEN,
    });
  });

  it('should answer 400 with ADMIN_REASON_REQUIRED when the cancel body has no reason', async () => {
    const base = await startWith('ADMIN');

    const response = await fetch(`${base}/admin/job-posts/job_1/cancel`, {
      method: 'POST',
      headers: { cookie: COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: ADMIN_ERRORS.REASON_REQUIRED,
    });
  });
});

/**
 * `@ac-verifier`가 AC1·AC4를 부분 충족으로 판정해 더한 것들. (Green 이후)
 *
 * 위의 둘은 거절 경로만 본다 — 관리자가 실제로 통과했을 때 무엇이 오는지,
 * 그리고 **감사 로그의 "누가"가 어디서 오는지**가 비어 있었다.
 */
describe('AdminJobPostController — 관리자가 통과했을 때', () => {
  it('should answer 200 with the list body when an admin calls the list endpoint', async () => {
    const base = await startWith('ADMIN');

    const response = await fetch(`${base}/admin/job-posts?q=박구인`, {
      headers: { cookie: COOKIE },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: 'job_1', employerName: '박구인', categoryName: '청소' }],
      total: 1,
    });
  });

  it('should answer 200 with the cancel result when an admin posts a valid reason', async () => {
    const base = await startWith('ADMIN');

    const response = await fetch(`${base}/admin/job-posts/job_1/cancel`, {
      method: 'POST',
      headers: { cookie: COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '허위 공고' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'job_1',
      status: 'CANCELLED',
      released: 150_000,
      penalized: false,
    });
  });

  it('should pass the session user id to forceCancel rather than any value from the request body', async () => {
    // 세션이 말하는 사람과 본문이 주장하는 사람을 **다르게** 둔다.
    const base = await startWith('ADMIN', 'usr_from_cookie');

    await fetch(`${base}/admin/job-posts/job_1/cancel`, {
      method: 'POST',
      headers: { cookie: COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '허위 공고', adminId: 'usr_forged' }),
    });

    // 본문이 주장한 값을 쓰면 아무나 남의 이름으로 조치할 수 있다.
    expect(forceCancelCalls).toEqual([
      { adminId: 'usr_from_cookie', jobPostId: 'job_1', reason: '허위 공고' },
    ]);
  });
});
