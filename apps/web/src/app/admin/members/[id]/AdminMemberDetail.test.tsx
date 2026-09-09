import { render, screen } from '@testing-library/react';
import type { AdminMemberDetail as AdminMemberDetailData } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import { AdminMemberDetail } from './AdminMemberDetail';

const MEMBER: AdminMemberDetailData = {
  id: 'usr_1',
  name: '김회원',
  email: 'member@example.com',
  joinedAt: '2026-03-01T00:00:00.000Z',
  status: 'ACTIVE',
  address: { sido: '서울특별시', sigungu: '강남구', roadAddress: '테헤란로 1' },
  asPoster: { average: 4.5, count: 4 },
  asWorker: { average: 3.5, count: 6 },
  reviews: [
    {
      id: 'rat_1',
      score: 5,
      rateeRole: 'WORKER',
      raterName: '박구인',
      jobPostTitle: '카페 마감 청소',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ],
  jobPosts: [
    {
      id: 'job_1',
      title: '이사 짐 나르기',
      status: 'COMPLETED',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
  ],
  applications: [
    {
      id: 'app_1',
      jobPostId: 'job_2',
      jobPostTitle: '카페 마감 청소',
      status: 'COMPLETED',
      createdAt: '2026-07-15T00:00:00.000Z',
    },
  ],
  pointBalance: 30_000,
  ledger: [
    {
      id: 'ptx_1',
      type: 'CHARGE',
      amount: 50_000,
      createdAt: '2026-06-01T00:00:00.000Z',
    },
  ],
  penalties: [
    {
      id: 'pen_1',
      reason: 'NO_SHOW',
      jobPostId: 'job_2',
      occurredAt: '2026-08-10T00:00:00.000Z',
    },
  ],
  suspensions: [
    {
      id: 'sus_1',
      startAt: '2026-08-10T00:00:00.000Z',
      endAt: '2026-08-15T00:00:00.000Z',
      releasedAt: null,
    },
  ],
};

describe('AdminMemberDetail', () => {
  // AC5가 요구하는 다섯 덩이가 한 화면에 있어야 한다.
  it('should render the rating, review, trade, point and penalty sections', () => {
    render(<AdminMemberDetail member={MEMBER} />);

    expect(screen.getByRole('heading', { name: /김회원/ })).toBeInTheDocument();
    // 평점 — 역할별로 나뉜다 (§2.1)
    expect(screen.getByText(/4\.5/)).toBeInTheDocument();
    expect(screen.getByText(/3\.5/)).toBeInTheDocument();
    // 리뷰 목록 — 거래 상대와 공고가 함께 보인다 (§11.3)
    expect(screen.getByText('박구인')).toBeInTheDocument();
    // 거래 이력 — 등록 공고와 신청 이력
    expect(screen.getByText('이사 짐 나르기')).toBeInTheDocument();
    // 포인트 — 잔액과 원장
    expect(screen.getByText(/30,000/)).toBeInTheDocument();
    // 제재 이력 — 경고 사유는 사람이 읽는 말로
    expect(screen.getByText('무단 불참')).toBeInTheDocument();
  });
});
