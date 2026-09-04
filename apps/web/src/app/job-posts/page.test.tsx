import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobPostList as JobPostListPage } from './JobPostList';

/**
 * `useSearchParams`와 `useRouter`를 대신한다.
 *
 * **URL이 유일한 진실이라는 것을 이 대역이 그대로 흉내 낸다** (ADR-JOB-4) —
 * `replace`가 URL만 바꾸고, 컴포넌트는 바뀐 URL을 다시 읽는다. 컴포넌트가
 * 몰래 상태를 들고 있으면 이 구조에서 화면이 안 바뀌어 테스트가 잡는다.
 */
let currentQuery = '';
const replace = vi.fn((href: string) => {
  currentQuery = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(currentQuery),
}));

const CATEGORIES = [
  {
    id: 'cat_1',
    name: '청소',
    slug: 'cleaning',
    sortOrder: 1,
    placeholderText: '평수를 적어 주세요.',
  },
];

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job_1',
    title: '사무실 청소',
    categoryId: 'cat_1',
    status: 'OPEN',
    version: 1,
    workAddress: '서울 강남구 테헤란로 1',
    workSido: '서울',
    workSigungu: '강남구',
    workStartAt: '2026-10-01T09:00:00.000Z',
    workEndAt: '2026-10-01T18:00:00.000Z',
    headcount: 3,
    rewardPerPerson: 50_000,
    budget: 150_000,
    createdAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

/** 목록 요청이 어떤 쿼리스트링으로 갔는지 모아 둔다 */
const listUrls: string[] = [];

function mockApi(
  list: { status: number; body: unknown },
  categories = CATEGORIES,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/categories')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(categories),
        });
      }
      listUrls.push(url);
      return Promise.resolve({
        ok: list.status >= 200 && list.status < 300,
        status: list.status,
        json: () => Promise.resolve(list.body),
      });
    }),
  );
}

function listBody(items: unknown[], total: number, page = 1) {
  return { items, total, page, pageSize: 20 };
}

beforeEach(() => {
  currentQuery = '';
  listUrls.length = 0;
  replace.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('공고 목록 (#12 AC5)', () => {
  it('should show a job post that was created', async () => {
    mockApi({ status: 200, body: listBody([summary()], 1) });

    render(<JobPostListPage />);

    expect(await screen.findByText('사무실 청소')).toBeInTheDocument();
    expect(screen.getByText('서울 강남구 테헤란로 1')).toBeInTheDocument();
  });

  it('should show the reward per person', async () => {
    mockApi({ status: 200, body: listBody([summary()], 1) });

    render(<JobPostListPage />);

    expect(await screen.findByText('50,000포인트')).toBeInTheDocument();
  });

  it('should report the total count', async () => {
    mockApi({
      status: 200,
      body: listBody([summary(), summary({ id: 'job_2' })], 21),
    });

    render(<JobPostListPage />);

    expect(await screen.findByText('총 21건')).toBeInTheDocument();
  });

  it('should say nothing matches when the list is empty', async () => {
    mockApi({ status: 200, body: listBody([], 0) });

    render(<JobPostListPage />);

    expect(
      await screen.findByText('조건에 맞는 일거리가 없습니다.'),
    ).toBeInTheDocument();
  });

  it('should show an error instead of an empty list when the request fails', async () => {
    // 빈 목록과 못 불러온 것은 다르다. 같이 보이면 "일거리가 없구나"로 읽힌다.
    // 본문은 모양이 맞는 값을 준다 — 스키마 파싱 실패에 기대는지 본다.
    mockApi({ status: 500, body: listBody([], 0) });

    render(<JobPostListPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '공고를 불러오지 못했습니다.',
    );
    expect(
      screen.queryByText('조건에 맞는 일거리가 없습니다.'),
    ).not.toBeInTheDocument();
  });
});

describe('공고 목록 — 필터는 URL이 진실이다 (#13)', () => {
  it('should read the filter from the query string on first render', async () => {
    // 새로고침·공유해도 필터가 유지된다 (AC3).
    currentQuery = 'category=cat_1&sido=%EC%84%9C%EC%9A%B8';
    mockApi({ status: 200, body: listBody([summary()], 1) });

    render(<JobPostListPage />);

    await waitFor(() => expect(listUrls).toHaveLength(1));
    expect(listUrls[0]).toContain('category=cat_1');
    expect(listUrls[0]).toContain('sido=');
  });

  it('should put the chosen category into the URL', async () => {
    mockApi({ status: 200, body: listBody([summary()], 1) });
    render(<JobPostListPage />);
    await screen.findByText('사무실 청소');

    await userEvent
      .setup()
      .selectOptions(screen.getByLabelText('카테고리'), 'cat_1');

    expect(replace).toHaveBeenCalledWith('/job-posts?category=cat_1');
  });

  it('should reset to page one when a filter changes', async () => {
    // 3페이지를 보다 카테고리를 바꾸면 결과가 1페이지뿐이라 빈 화면이 나온다.
    currentQuery = 'page=3';
    mockApi({ status: 200, body: listBody([summary()], 1, 3) });
    render(<JobPostListPage />);
    await screen.findByText('사무실 청소');

    await userEvent
      .setup()
      .selectOptions(screen.getByLabelText('카테고리'), 'cat_1');

    expect(replace).toHaveBeenCalledWith('/job-posts?category=cat_1');
  });

  it('should show a chip for each applied filter', async () => {
    currentQuery = 'category=cat_1&sigungu=%EA%B0%95%EB%82%A8%EA%B5%AC';
    mockApi({ status: 200, body: listBody([summary()], 1) });

    render(<JobPostListPage />);

    // 카테고리 칩은 id가 아니라 이름으로 보인다.
    expect(await screen.findByText(/카테고리: 청소/)).toBeInTheDocument();
    expect(screen.getByText(/시\/군\/구: 강남구/)).toBeInTheDocument();
  });

  it('should drop only that condition when a chip is removed', async () => {
    // 칩 하나를 지우면 그 조건만 풀리고 나머지는 유지된다 (AC4).
    currentQuery = 'category=cat_1&sido=%EC%84%9C%EC%9A%B8';
    mockApi({ status: 200, body: listBody([summary()], 1) });
    render(<JobPostListPage />);
    const chip = await screen.findByRole('button', { name: /카테고리: 청소/ });

    await userEvent.setup().click(chip);

    const href = String(replace.mock.calls.at(-1)?.[0]);
    expect(href).not.toContain('category=');
    expect(href).toContain('sido=');
  });

  it('should keep no filter state of its own so back navigation stays correct', async () => {
    // 뒤로가기는 URL만 되돌린다. 컴포넌트가 상태를 들고 있으면 화면이
    // 옛 필터에 머문다 (AC8).
    currentQuery = 'sido=%EC%84%9C%EC%9A%B8';
    mockApi({ status: 200, body: listBody([summary()], 1) });
    const view = render(<JobPostListPage />);
    expect(await screen.findByDisplayValue('서울')).toBeInTheDocument();

    // 뒤로가기가 일어난 것처럼 URL만 되돌린다.
    currentQuery = '';
    view.rerender(<JobPostListPage />);

    expect(screen.queryByDisplayValue('서울')).not.toBeInTheDocument();
  });

  it('should move to the next page without losing the filter', async () => {
    currentQuery = 'category=cat_1';
    mockApi({ status: 200, body: listBody([summary()], 21) });
    render(<JobPostListPage />);
    const next = await screen.findByRole('button', { name: '다음' });

    await userEvent.setup().click(next);

    expect(replace).toHaveBeenCalledWith('/job-posts?category=cat_1&page=2');
  });

  it('should hide the pager when everything fits on one page', async () => {
    mockApi({ status: 200, body: listBody([summary()], 1) });

    render(<JobPostListPage />);
    await screen.findByText('사무실 청소');

    expect(
      screen.queryByRole('button', { name: '다음' }),
    ).not.toBeInTheDocument();
  });
});
