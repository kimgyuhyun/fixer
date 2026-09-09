import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ADMIN_ERRORS,
  AUTH_COOKIES,
  EXCHANGE_ERRORS,
  type AdminExchangeRequestSummary,
} from '@fixer/shared';
import type { AddressInfo, Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LoginService } from '../auth/login.service';
import { ExchangeError } from '../exchange/exchange-request.service';
import { AdminError } from './admin-job-post.service';
import { AdminExchangeController } from './admin-exchange.controller';
import { AdminExchangeService } from './admin-exchange.service';
import { AdminGuard, ROLE_READER } from './admin.guard';

/**
 * **진짜 HTTP로 두드린다.** (이슈 #34)
 *
 * 서비스가 던지는 도메인 코드와 화면이 받는 상태 코드의 대응은 여기서만
 * 검증된다. 가드가 이 컨트롤러에도 실제로 걸렸는지도 마찬가지다.
 */
let app: INestApplication | undefined;

const ROW: AdminExchangeRequestSummary = {
  id: 'exr_1',
  requesterName: '김구직',
  amount: 10_000,
  status: 'REQUESTED',
  requestedAt: '2026-09-01T00:00:00.000Z',
  account: {
    bankName: '신한은행',
    maskedAccountNumber: '****5678',
    holderName: '김구직',
    verificationStatus: 'VERIFIED',
  },
};

async function startWith(
  role: 'USER' | 'ADMIN',
  throwing?: Error,
): Promise<string> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminExchangeController],
    providers: [
      {
        provide: AdminExchangeService,
        useValue: {
          list: () =>
            Promise.resolve({ items: [ROW], total: 1, page: 1, pageSize: 20 }),
          approve: () =>
            throwing === undefined
              ? Promise.resolve({ id: 'exr_1', status: 'APPROVED' })
              : Promise.reject(throwing),
          complete: () =>
            throwing === undefined
              ? Promise.resolve({ id: 'exr_1', status: 'COMPLETED' })
              : Promise.reject(throwing),
          reject: () =>
            throwing === undefined
              ? Promise.resolve({
                  id: 'exr_1',
                  status: 'REJECTED',
                  reverted: 10_000,
                })
              : Promise.reject(throwing),
          revealAccount: () =>
            Promise.resolve({ accountNumber: '11012345678' }),
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
  const server = app.getHttpServer() as Server;
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const COOKIE = `${AUTH_COOKIES.access}=tok`;

describe('AdminExchangeController', () => {
  it('should respond 200 with the list for an admin', async () => {
    const base = await startWith('ADMIN');

    const response = await fetch(`${base}/admin/exchange-requests`, {
      headers: { cookie: COOKIE },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ requesterName: '김구직', amount: 10_000 }],
      total: 1,
    });
  });

  it('should respond 403 with ADMIN_FORBIDDEN for a member who is not an admin', async () => {
    const base = await startWith('USER');

    const response = await fetch(
      `${base}/admin/exchange-requests/exr_1/approve`,
      { method: 'POST', headers: { cookie: COOKIE } },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: ADMIN_ERRORS.FORBIDDEN,
    });
  });

  it('should respond 404 with EXCHANGE_REQUEST_NOT_FOUND', async () => {
    const base = await startWith(
      'ADMIN',
      new ExchangeError(EXCHANGE_ERRORS.REQUEST_NOT_FOUND),
    );

    const response = await fetch(
      `${base}/admin/exchange-requests/exr_1/approve`,
      { method: 'POST', headers: { cookie: COOKIE } },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: EXCHANGE_ERRORS.REQUEST_NOT_FOUND,
    });
  });

  it('should respond 409 with EXCHANGE_INVALID_TRANSITION', async () => {
    const base = await startWith(
      'ADMIN',
      new ExchangeError(EXCHANGE_ERRORS.INVALID_TRANSITION),
    );

    const response = await fetch(
      `${base}/admin/exchange-requests/exr_1/complete`,
      { method: 'POST', headers: { cookie: COOKIE } },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: EXCHANGE_ERRORS.INVALID_TRANSITION,
    });
  });

  it('should respond 400 with ADMIN_REASON_REQUIRED when the reason is missing', async () => {
    const base = await startWith(
      'ADMIN',
      new AdminError(ADMIN_ERRORS.REASON_REQUIRED),
    );

    const response = await fetch(
      `${base}/admin/exchange-requests/exr_1/reject`,
      {
        method: 'POST',
        headers: { cookie: COOKIE, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: ADMIN_ERRORS.REASON_REQUIRED,
    });
  });
});
