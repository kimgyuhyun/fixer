import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicantList } from './ApplicantList';

const APPLICANT = {
  applicationId: 'app_1',
  applicantId: 'usr_seeker',
  applicantName: '김구직',
  status: 'APPLIED',
  appliedVersion: 1,
  createdAt: '2026-09-05T00:00:00.000Z',
  acceptedAt: null,
  ratingAsWorker: null,
  ratingCount: 0,
};

/** `GET /api/applications`의 응답을 흉내 낸다 */
function mockList(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    }),
  );
}

function listOf(
  applicants: unknown[],
  overrides: { headcount?: number; acceptedCount?: number } = {},
) {
  return {
    jobPostId: 'job_1',
    headcount: overrides.headcount ?? 3,
    acceptedCount: overrides.acceptedCount ?? 0,
    applicants,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApplicantList', () => {
  it('should render a 수락 button for an APPLIED applicant', async () => {
    mockList(listOf([APPLICANT]));

    render(<ApplicantList jobPostId="job_1" />);

    expect(
      await screen.findByRole('button', { name: '수락' }),
    ).toBeInTheDocument();
  });

  // 별 1개 받고 평점 1.0으로 낙인찍히는 것을 막는 규칙 (§7).
  it('should render 신규 when the applicant has fewer than 3 ratings', async () => {
    mockList(listOf([{ ...APPLICANT, ratingAsWorker: 1, ratingCount: 2 }]));

    render(<ApplicantList jobPostId="job_1" />);

    expect(await screen.findByText('신규')).toBeInTheDocument();
  });

  it('should render the average when the applicant has 3 or more ratings', async () => {
    mockList(listOf([{ ...APPLICANT, ratingAsWorker: 4.5, ratingCount: 3 }]));

    render(<ApplicantList jobPostId="job_1" />);

    expect(await screen.findByText('4.5')).toBeInTheDocument();
  });

  // 자리가 없는데 버튼이 보이면 누르는 사람마다 409를 본다.
  it('should render no 수락 button when acceptedCount equals headcount', async () => {
    mockList(listOf([APPLICANT], { headcount: 2, acceptedCount: 2 }));

    render(<ApplicantList jobPostId="job_1" />);

    expect(await screen.findByText('김구직')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '수락' })).toBeNull();
  });
});
describe('ApplicantList — 완료 확인 (#23)', () => {
  it('should show the 완료 확인 button to the employer', async () => {
    mockList(
      listOf([{ ...APPLICANT, status: 'ACCEPTED' }], { acceptedCount: 1 }),
    );

    render(<ApplicantList jobPostId="job_1" />);

    expect(
      await screen.findByRole('button', { name: '완료 확인' }),
    ).toBeInTheDocument();
  });

  it('should reload the list after the completion succeeds', async () => {
    // 완료 확인은 신청 상태와 공고 상태를 함께 바꾼다. 목록을 다시 읽지
    // 않으면 화면에 옛 상태가 남는다.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(
          listOf([{ ...APPLICANT, status: 'ACCEPTED' }], { acceptedCount: 1 }),
        ),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApplicantList jobPostId="job_1" />);
    await userEvent.click(
      await screen.findByRole('button', { name: '완료 확인' }),
    );

    const calls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calls).toContain('/api/applications/complete');
    // 첫 조회 · 완료 확인 · 다시 조회
    expect(
      calls.filter((url) => url.startsWith('/api/applications?')),
    ).toHaveLength(2);
  });
});
