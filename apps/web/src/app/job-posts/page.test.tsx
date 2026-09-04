import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JobPostListPage from './page';

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job_1',
    title: '사무실 청소',
    categoryId: 'cat_1',
    status: 'OPEN',
    version: 1,
    workAddress: '서울 강남구 테헤란로 1',
    workStartAt: '2026-10-01T09:00:00.000Z',
    workEndAt: '2026-10-01T18:00:00.000Z',
    headcount: 3,
    rewardPerPerson: 50_000,
    budget: 150_000,
    createdAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

function mockList(status: number, body: unknown) {
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

describe('공고 목록 (#12 AC5)', () => {
  it('should show a job post that was created', async () => {
    mockList(200, { items: [summary()], total: 1 });

    render(<JobPostListPage />);

    expect(await screen.findByText('사무실 청소')).toBeInTheDocument();
    expect(screen.getByText('서울 강남구 테헤란로 1')).toBeInTheDocument();
  });

  it('should show the reward per person', async () => {
    mockList(200, { items: [summary()], total: 1 });

    render(<JobPostListPage />);

    expect(await screen.findByText('50,000포인트')).toBeInTheDocument();
  });

  it('should report the total count', async () => {
    // #13의 페이징이 쓸 값이지만 지금도 사람이 알아야 한다.
    mockList(200, { items: [summary(), summary({ id: 'job_2' })], total: 2 });

    render(<JobPostListPage />);

    expect(await screen.findByText('총 2건')).toBeInTheDocument();
  });

  it('should say the list is empty when nothing is open', async () => {
    mockList(200, { items: [], total: 0 });

    render(<JobPostListPage />);

    expect(
      await screen.findByText('아직 올라온 일거리가 없습니다.'),
    ).toBeInTheDocument();
  });

  it('should show an error instead of an empty list when the request fails', async () => {
    // 빈 목록과 못 불러온 것은 다르다. 같이 보이면 "일거리가 없구나"로 읽힌다.
    // 본문은 **모양이 맞는 값**을 준다 — 스키마 파싱 실패에 기대는지 본다.
    mockList(500, { items: [], total: 0 });

    render(<JobPostListPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '공고를 불러오지 못했습니다.',
    );
    expect(
      screen.queryByText('아직 올라온 일거리가 없습니다.'),
    ).not.toBeInTheDocument();
  });
});
