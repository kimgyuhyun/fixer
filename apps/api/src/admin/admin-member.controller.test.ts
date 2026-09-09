import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ADMIN_ERRORS,
  AUTH_COOKIES,
  type AdminMemberFilter,
  type AdminMemberSummary,
} from '@fixer/shared';
import type { AddressInfo, Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LoginService } from '../auth/login.service';
import { AdminError } from './admin-job-post.service';
import { AdminMemberController } from './admin-member.controller';
import { AdminMemberService } from './admin-member.service';
import { AdminGuard, ROLE_READER } from './admin.guard';

/**
 * **진짜 HTTP로 두드린다.** (이슈 #32)
 *
 * 컨트롤러를 직접 `new`로 만들면 가드가 안 걸려서 AC6("일반 회원이 관리자
 * URL로 접근하면 `FORBIDDEN`")이 검증되지 않는다. #35가 만든 가드를 이
 * 컨트롤러가 제대로 물려받았는지가 여기서만 증명된다.
 */
let app: INestApplication | undefined;

const ROW: AdminMemberSummary = {
  id: 'usr_1',
  name: '김회원',
  email: 'member@example.com',
  joinedAt: '2026-03-01T00:00:00.000Z',
  asPoster: { average: 4.5, count: 4 },
  asWorker: { average: null, count: 0 },
  penaltyCount: 2,
  status: 'ACTIVE',
};

/** 서비스가 받은 필터를 적어 둔다. 쿼리스트링이 그대로 흘렀는지 본다 */
const listCalls: AdminMemberFilter[] = [];

async function startWith(role: 'USER' | 'ADMIN'): Promise<string> {
  listCalls.length = 0;
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminMemberController],
    providers: [
      {
        provide: AdminMemberService,
        useValue: {
          list: (filter: AdminMemberFilter) => {
            listCalls.push(filter);
            return Promise.resolve({
              items: [ROW],
              total: 1,
              page: filter.page,
              pageSize: 20,
            });
          },
          detail: (userId: string) => {
            if (userId === 'usr_missing') {
              return Promise.reject(
                new AdminError(ADMIN_ERRORS.MEMBER_NOT_FOUND),
              );
            }
            return Promise.reject(new Error('쓰이지 않는 경로다'));
          },
        },
      },
      {
        provide: LoginService,
        useValue: {
          authenticate: () => Promise.resolve({ userId: 'usr_admin' }),
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

describe('AdminMemberController', () => {
  it('should answer 403 with ADMIN_FORBIDDEN when a non-admin calls the list', async () => {
    const base = await startWith('USER');

    const response = await fetch(`${base}/admin/members`, {
      headers: { cookie: COOKIE },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: ADMIN_ERRORS.FORBIDDEN,
    });
  });

  it('should answer 403 with ADMIN_FORBIDDEN when a non-admin calls the detail', async () => {
    const base = await startWith('USER');

    const response = await fetch(`${base}/admin/members/usr_1`, {
      headers: { cookie: COOKIE },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: ADMIN_ERRORS.FORBIDDEN,
    });
  });

  it('should answer 200 with the list body when an admin calls it with a filter', async () => {
    const base = await startWith('ADMIN');

    const response = await fetch(
      `${base}/admin/members?q=김회원&sido=서울특별시&page=2`,
      { headers: { cookie: COOKIE } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: 'usr_1', name: '김회원', status: 'ACTIVE' }],
      total: 1,
    });
    // 쿼리스트링이 필터로 그대로 흘렀는지 본다. 안 흐르면 화면이 거른
    // 결과가 아니라 전체를 보게 된다.
    expect(listCalls).toEqual([{ q: '김회원', sido: '서울특별시', page: 2 }]);
  });

  it('should answer 404 with ADMIN_MEMBER_NOT_FOUND when there is no such member', async () => {
    const base = await startWith('ADMIN');

    const response = await fetch(`${base}/admin/members/usr_missing`, {
      headers: { cookie: COOKIE },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: ADMIN_ERRORS.MEMBER_NOT_FOUND,
    });
  });
});
