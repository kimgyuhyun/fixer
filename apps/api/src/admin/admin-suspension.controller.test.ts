import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ADMIN_ERRORS,
  AUTH_COOKIES,
  type AdminSuspensionSummary,
} from '@fixer/shared';
import type { AddressInfo, Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LoginService } from '../auth/login.service';
import { AdminSuspensionController } from './admin-suspension.controller';
import { AdminSuspensionService } from './admin-suspension.service';
import { AdminGuard, ROLE_READER } from './admin.guard';

/**
 * **진짜 HTTP로 두드린다.** (이슈 #33)
 *
 * 컨트롤러를 직접 `new`로 만들면 가드가 안 걸려서 "관리자가 아니면 403"이
 * 검증되지 않는다. #35가 만든 가드를 이 컨트롤러가 제대로 물려받았는지가
 * 여기서만 증명된다.
 */
let app: INestApplication | undefined;

const ROW: AdminSuspensionSummary = {
  id: 'sus_1',
  userId: 'usr_penalized',
  userName: '김제재',
  startAt: '2026-09-08T00:00:00.000Z',
  endAt: '2026-09-13T00:00:00.000Z',
  reasons: ['NO_SHOW'],
  penaltyCount: 5,
};

/**
 * 서비스가 받은 인자를 적어 둔다.
 *
 * **감사 로그의 "누가"가 어디서 왔는지**를 이걸로 본다. `adminId`를 손으로
 * 넘기는 테스트만 있으면 세션에서 왔는지 본문에서 왔는지 구분할 수 없다.
 */
const releaseCalls: {
  adminId: string;
  suspensionId: string;
  reason: string;
}[] = [];

async function startWith(
  role: 'USER' | 'ADMIN',
  sessionUserId = 'usr_1',
): Promise<string> {
  releaseCalls.length = 0;
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminSuspensionController],
    providers: [
      {
        provide: AdminSuspensionService,
        useValue: {
          list: () =>
            Promise.resolve({
              items: [ROW],
              total: 1,
              page: 1,
              pageSize: 20,
            }),
          release: (input: {
            adminId: string;
            suspensionId: string;
            reason: string;
          }) => {
            releaseCalls.push(input);
            return Promise.resolve({
              id: input.suspensionId,
              userId: 'usr_penalized',
              releasedAt: '2026-09-09T00:00:00.000Z',
              releasedBy: input.adminId,
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

describe('AdminSuspensionController', () => {
  it('should answer 403 with ADMIN_FORBIDDEN when a non-admin calls the list endpoint', async () => {
    const base = await startWith('USER');

    const response = await fetch(`${base}/admin/suspensions`, {
      headers: { cookie: COOKIE },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: ADMIN_ERRORS.FORBIDDEN,
    });
  });

  it('should answer 200 with the list body when an admin calls the list endpoint', async () => {
    const base = await startWith('ADMIN');

    const response = await fetch(`${base}/admin/suspensions?q=김제재`, {
      headers: { cookie: COOKIE },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: 'sus_1', userName: '김제재', penaltyCount: 5 }],
      total: 1,
    });
  });

  it('should answer 400 with ADMIN_REASON_REQUIRED when the release body has no reason', async () => {
    const base = await startWith('ADMIN');

    const response = await fetch(`${base}/admin/suspensions/sus_1/release`, {
      method: 'POST',
      headers: { cookie: COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: ADMIN_ERRORS.REASON_REQUIRED,
    });
  });

  it('should pass the session user id to release rather than any value from the request body', async () => {
    // 세션이 말하는 사람과 본문이 주장하는 사람을 **다르게** 둔다.
    const base = await startWith('ADMIN', 'usr_from_cookie');

    await fetch(`${base}/admin/suspensions/sus_1/release`, {
      method: 'POST',
      headers: { cookie: COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '이의 인정', adminId: 'usr_forged' }),
    });

    // 본문이 주장한 값을 쓰면 아무나 남의 이름으로 조치할 수 있다.
    expect(releaseCalls).toEqual([
      {
        adminId: 'usr_from_cookie',
        suspensionId: 'sus_1',
        reason: '이의 인정',
      },
    ]);
  });
});
