import { ADMIN_ERRORS } from '@fixer/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminError } from './admin-job-post.service';
import {
  AdminMemberService,
  type AdminMemberDetailRow,
  type AdminMemberRow,
  type AdminMemberStore,
} from './admin-member.service';

/**
 * 목록 한 줄과 상세 한 건의 **모양**은 DB 없이 증명된다. (이슈 #32)
 *
 * 여기서 보는 것은 저장소가 준 재료를 서비스가 어떤 모양으로 내보내는지다 —
 * 날짜가 ISO 문자열이 되는지, 상태가 두 재료에서 계산되는지, 없는 회원이
 * 에러가 되는지. **필터가 실제로 좁히는지는 진짜 SQL만 안다**(§5.1의 유효
 * 제재 조건, 180일 창, 지역 필터). 그건 통합 테스트가 본다.
 */
const ROW: AdminMemberRow = {
  id: 'usr_1',
  name: '김회원',
  email: 'member@example.com',
  joinedAt: new Date('2026-03-01T00:00:00.000Z'),
  deactivatedAt: null,
  hasActiveSuspension: false,
  ratingAsPoster: 4.5,
  ratingAsPosterCount: 4,
  ratingAsWorker: 3.5,
  ratingAsWorkerCount: 6,
  penaltyCount: 2,
};

const DETAIL: AdminMemberDetailRow = {
  ...ROW,
  address: { sido: '서울특별시', sigungu: '강남구', roadAddress: '테헤란로 1' },
  reviews: [
    {
      id: 'rat_1',
      score: 5,
      rateeRole: 'WORKER',
      raterName: '박구인',
      jobPostTitle: '카페 마감 청소',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  ],
  jobPosts: [
    {
      id: 'job_1',
      title: '이사 짐 나르기',
      status: 'COMPLETED',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    },
  ],
  applications: [
    {
      id: 'app_1',
      jobPostId: 'job_2',
      jobPostTitle: '카페 마감 청소',
      status: 'COMPLETED',
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
    },
  ],
  pointBalance: 30_000,
  ledger: [
    {
      id: 'ptx_1',
      type: 'CHARGE',
      amount: 50_000,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    },
    {
      id: 'ptx_2',
      type: 'HOLD',
      amount: -20_000,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    },
  ],
  penalties: [
    {
      id: 'pen_1',
      reason: 'NO_SHOW',
      jobPostId: 'job_3',
      occurredAt: new Date('2026-08-10T00:00:00.000Z'),
    },
  ],
  suspensions: [
    {
      id: 'sus_1',
      startAt: new Date('2026-08-10T00:00:00.000Z'),
      endAt: new Date('2026-08-15T00:00:00.000Z'),
      releasedAt: null,
    },
  ],
};

/** 정해진 한 줄과 한 건만 돌려주는 가짜 저장소 */
class FakeStore implements AdminMemberStore {
  row: AdminMemberRow = ROW;
  detailRow: AdminMemberDetailRow | null = DETAIL;
  total = 1;

  list(): Promise<{ items: AdminMemberRow[]; total: number }> {
    return Promise.resolve({ items: [this.row], total: this.total });
  }

  findDetail(): Promise<AdminMemberDetailRow | null> {
    return Promise.resolve(this.detailRow);
  }
}

let store: FakeStore;
let service: AdminMemberService;

beforeEach(() => {
  store = new FakeStore();
  service = new AdminMemberService(store);
});

describe('AdminMemberService.list', () => {
  it('should return name, email, joinedAt, both role ratings, penalty count and status for every member', async () => {
    const list = await service.list({ page: 1 });

    expect(list.items).toEqual([
      {
        id: 'usr_1',
        name: '김회원',
        email: 'member@example.com',
        joinedAt: '2026-03-01T00:00:00.000Z',
        asPoster: { average: 4.5, count: 4 },
        asWorker: { average: 3.5, count: 6 },
        penaltyCount: 2,
        status: 'ACTIVE',
      },
    ]);
  });

  it('should report the filtered total, the requested page and the page size', async () => {
    store.total = 37;

    const list = await service.list({ page: 2 });

    expect({
      total: list.total,
      page: list.page,
      pageSize: list.pageSize,
    }).toEqual({ total: 37, page: 2, pageSize: 20 });
  });

  // 0.0으로 두면 화면이 "0점을 받았다"와 구분할 수 없다 (#26).
  it('should report a null average and a zero count for a member who has never been rated', async () => {
    store.row = {
      ...ROW,
      ratingAsPoster: null,
      ratingAsPosterCount: 0,
      ratingAsWorker: null,
      ratingAsWorkerCount: 0,
    };

    const list = await service.list({ page: 1 });

    expect(list.items[0]).toMatchObject({
      asPoster: { average: null, count: 0 },
      asWorker: { average: null, count: 0 },
    });
  });

  // AC4: 사라지지 않는다. 분쟁·환전 이력 추적 때문이다 (§2.6).
  it('should still return a deactivated member and mark the row DEACTIVATED', async () => {
    store.row = {
      ...ROW,
      deactivatedAt: new Date('2026-09-01T00:00:00.000Z'),
      hasActiveSuspension: true,
    };

    const list = await service.list({ page: 1 });

    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.status).toBe('DEACTIVATED');
  });
});

describe('AdminMemberService.detail', () => {
  it('should return the name, email, joined date, address and status', async () => {
    const detail = await service.detail('usr_1');

    expect(detail).toMatchObject({
      id: 'usr_1',
      name: '김회원',
      email: 'member@example.com',
      joinedAt: '2026-03-01T00:00:00.000Z',
      status: 'ACTIVE',
      address: {
        sido: '서울특별시',
        sigungu: '강남구',
        roadAddress: '테헤란로 1',
      },
    });
  });

  it('should return empty lists and a zero balance for a member with no activity', async () => {
    store.detailRow = {
      ...DETAIL,
      address: null,
      reviews: [],
      jobPosts: [],
      applications: [],
      pointBalance: 0,
      ledger: [],
      penalties: [],
      suspensions: [],
    };

    const detail = await service.detail('usr_1');

    expect(detail).toMatchObject({
      address: null,
      reviews: [],
      jobPosts: [],
      applications: [],
      pointBalance: 0,
      ledger: [],
      penalties: [],
      suspensions: [],
    });
  });

  it('should throw ADMIN_MEMBER_NOT_FOUND when no such member exists', async () => {
    store.detailRow = null;

    await expect(service.detail('usr_missing')).rejects.toThrow(
      new AdminError(ADMIN_ERRORS.MEMBER_NOT_FOUND),
    );
  });
});
