import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ADMIN_ERRORS, AUTH_COOKIES } from '@fixer/shared';
import type { AddressInfo } from 'node:net';
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

async function startWith(role: 'USER' | 'ADMIN'): Promise<string> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminJobPostController],
    providers: [
      {
        provide: AdminJobPostService,
        useValue: {
          list: () =>
            Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
          forceCancel: () =>
            Promise.resolve({
              id: 'job_1',
              status: 'CANCELLED',
              released: 0,
              penalized: false,
            }),
        },
      },
      {
        provide: LoginService,
        useValue: { authenticate: () => Promise.resolve({ userId: 'usr_1' }) },
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
  const { port } = app.getHttpServer().address() as AddressInfo;
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
