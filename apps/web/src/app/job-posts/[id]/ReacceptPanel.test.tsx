import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReacceptPanel } from './ReacceptPanel';

/** `GET /api/applications/app_1/version-diff`의 응답을 흉내 낸다 (#22) */
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

const RESTORED = {
  id: 'app_1',
  jobPostId: 'job_1',
  applicantId: 'usr_seeker',
  status: 'ACCEPTED',
  appliedVersion: 2,
  createdAt: '2026-09-05T00:00:00.000Z',
  acceptedAt: null,
};

/** diff는 diff대로, 재동의·거절은 그 응답대로 돌려주는 가짜 fetch */
function mockFetch(settled: unknown = RESTORED) {
  const fetch = vi.fn((input: unknown) => {
    const url = String(input);
    const body = url.includes('version-diff') ? DIFF : settled;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ReacceptPanel', () => {
  it('should send the reaccept request when 재동의 is pressed', async () => {
    const fetch = mockFetch();
    render(
      <ReacceptPanel
        applicationId="app_1"
        applicantId="usr_seeker"
        onSettled={vi.fn()}
      />,
    );

    await userEvent.click(
      await screen.findByRole('button', { name: '재동의' }),
    );

    expect(fetch).toHaveBeenCalledWith(
      '/api/applications/app_1/reaccept',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('should send the decline request when 거절 is pressed', async () => {
    const fetch = mockFetch({
      ...RESTORED,
      status: 'CANCELLED_BY_VERSION_CHANGE',
    });
    render(
      <ReacceptPanel
        applicationId="app_1"
        applicantId="usr_seeker"
        onSettled={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: '거절' }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/applications/app_1/decline',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
