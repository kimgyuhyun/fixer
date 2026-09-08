import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemberRating } from './MemberRating';

/** `GET /api/ratings/:userId`의 응답을 흉내 낸다 */
function mockSummary(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    }),
  );
}

function summaryOf(
  asPoster: { average: number | null; count: number },
  asWorker: { average: number | null; count: number },
) {
  return { userId: 'usr_1', asPoster, asWorker };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MemberRating', () => {
  it('should show the poster rating and the worker rating as separate rows', async () => {
    mockSummary(
      summaryOf({ average: 4.4, count: 5 }, { average: 3.2, count: 9 }),
    );

    render(<MemberRating userId="usr_1" />);

    expect(await screen.findByText('4.4')).toBeInTheDocument();
    expect(await screen.findByText('3.2')).toBeInTheDocument();
  });

  // 별 1개 받고 평점 1.0으로 낙인찍히는 것을 막는다 (§7).
  it('should show 신규 instead of the average when only 2 ratings were received', async () => {
    mockSummary(
      summaryOf({ average: null, count: 0 }, { average: 1, count: 2 }),
    );

    render(<MemberRating userId="usr_1" />);

    expect(await screen.findAllByText('신규')).toHaveLength(2);
  });

  // 경계다. 정확히 3건부터 평균을 보여준다 (§7 "3건 미만").
  it('should show the average when exactly 3 ratings were received', async () => {
    mockSummary(
      summaryOf({ average: null, count: 0 }, { average: 4, count: 3 }),
    );

    render(<MemberRating userId="usr_1" />);

    expect(await screen.findByText('4.0')).toBeInTheDocument();
  });
});
