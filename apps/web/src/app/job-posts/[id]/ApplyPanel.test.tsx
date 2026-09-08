import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplyPanel } from './ApplyPanel';

const SUMMARY = {
  id: 'app_1',
  jobPostId: 'job_1',
  applicantId: 'usr_seeker',
  status: 'APPLIED',
  appliedVersion: 1,
  createdAt: '2026-09-05T00:00:00.000Z',
};

/** `GET /api/applications/me`의 응답을 흉내 낸다 */
function mockMine(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApplyPanel', () => {
  it('should render a 지원하기 button when the applicant has no application', async () => {
    mockMine(404, { errorCode: 'APPLICATION_NOT_FOUND' });

    render(<ApplyPanel jobPostId="job_1" />);

    expect(
      await screen.findByRole('button', { name: '지원하기' }),
    ).toBeInTheDocument();
  });

  it('should render a 지원 철회 button when the application is APPLIED', async () => {
    mockMine(200, SUMMARY);

    render(<ApplyPanel jobPostId="job_1" />);

    expect(
      await screen.findByRole('button', { name: '지원 철회' }),
    ).toBeInTheDocument();
  });

  // 재지원 (§4.2 개정). 화면은 "없음"과 같아 보이지만 서버는 되살린다.
  it('should render a 지원하기 button again when the application is WITHDRAWN', async () => {
    mockMine(200, { ...SUMMARY, status: 'WITHDRAWN' });

    render(<ApplyPanel jobPostId="job_1" />);

    expect(
      await screen.findByRole('button', { name: '지원하기' }),
    ).toBeInTheDocument();
  });

  /**
   * AC5. 취소는 #20의 무상 취소 창 규칙을 따라야 하므로, 여기에 철회
   * 버튼을 두면 그 판정을 건너뛰는 경로가 생긴다.
   */
  it('should render neither a 지원하기 nor a 지원 철회 button when the application is ACCEPTED', async () => {
    mockMine(200, { ...SUMMARY, status: 'ACCEPTED' });

    render(<ApplyPanel jobPostId="job_1" />);

    // 상태 문구가 뜬 뒤에 확인한다 — 로딩 중에는 어떤 버튼도 없어서
    // 기다리지 않으면 그냥 통과해 버린다.
    await screen.findByText('수락됨');
    expect(
      screen.queryByRole('button', { name: '지원 철회' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '지원하기' }),
    ).not.toBeInTheDocument();
  });
});
/**
 * 재동의 대기 (#22 AC1).
 *
 * #21의 알림이 공고 상세로 보내므로 **그 화면에서 바로** 변경 전/후가
 * 보여야 한다. `/api/applications/me`와 diff 두 곳을 부르므로 URL로 나눈다.
 */
describe('ApplyPanel — 재동의 대기', () => {
  const DIFF = {
    applicationId: 'app_1',
    jobPostId: 'job_1',
    before: {
      version: 1,
      workAddress: '서울특별시 강남구 테헤란로 1',
      workStartAt: '2026-01-01T09:00:00.000Z',
      workEndAt: '2026-01-01T18:00:00.000Z',
      headcount: 2,
      rewardPerPerson: 10_000,
      requiredDescription: '창고 정리',
    },
    after: {
      version: 2,
      workAddress: '서울특별시 강남구 테헤란로 1',
      workStartAt: '2026-01-01T09:00:00.000Z',
      workEndAt: '2026-01-01T18:00:00.000Z',
      headcount: 2,
      rewardPerPerson: 12_000,
      requiredDescription: '창고 정리',
    },
    changedFields: ['rewardPerPerson'],
  };

  it('should show the before and after value of every changed field when the application is PENDING_REACCEPT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        const url = String(input);
        const body = url.includes('version-diff')
          ? DIFF
          : { ...SUMMARY, status: 'PENDING_REACCEPT' };
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(body),
        });
      }),
    );

    render(<ApplyPanel jobPostId="job_1" />);

    expect(await screen.findByText('10,000')).toBeInTheDocument();
    expect(await screen.findByText('12,000')).toBeInTheDocument();
  });
});
