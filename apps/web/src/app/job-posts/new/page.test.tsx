import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewJobPostPage from './page';

/** 서버는 활성만 정렬순으로 준다. 화면은 받은 순서를 그대로 쓴다 */
const CATEGORIES = [
  {
    id: 'cat_1',
    name: '청소',
    slug: 'cleaning',
    sortOrder: 1,
    placeholderText: '평수와 방 개수를 적어 주세요.',
  },
  {
    id: 'cat_2',
    name: '배달·심부름',
    slug: 'delivery',
    sortOrder: 2,
    placeholderText: '출발지와 도착지를 적어 주세요.',
  },
];

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('NewJobPostPage', () => {
  it('should list the active categories in sort order', async () => {
    mockFetchOnce(CATEGORIES);
    render(<NewJobPostPage />);

    const select = await screen.findByLabelText('카테고리');
    const names = Array.from(
      select.querySelectorAll('option[value]:not([value=""])'),
    ).map((option) => option.textContent);

    expect(names).toEqual(['청소', '배달·심부름']);
  });

  it('should show a guide before any category is chosen', async () => {
    mockFetchOnce(CATEGORIES);
    render(<NewJobPostPage />);

    await screen.findByLabelText('카테고리');

    expect(screen.getByLabelText('상세 내용')).toHaveAttribute(
      'placeholder',
      '카테고리를 먼저 골라 주세요.',
    );
  });

  it('should show the placeholderText of the chosen category in the detail field', async () => {
    mockFetchOnce(CATEGORIES);
    render(<NewJobPostPage />);

    await userEvent.selectOptions(
      await screen.findByLabelText('카테고리'),
      'cat_1',
    );

    expect(screen.getByLabelText('상세 내용')).toHaveAttribute(
      'placeholder',
      CATEGORIES[0].placeholderText,
    );
  });

  it('should swap the placeholder when another category is chosen', async () => {
    mockFetchOnce(CATEGORIES);
    render(<NewJobPostPage />);
    const select = await screen.findByLabelText('카테고리');

    await userEvent.selectOptions(select, 'cat_1');
    await userEvent.selectOptions(select, 'cat_2');

    expect(screen.getByLabelText('상세 내용')).toHaveAttribute(
      'placeholder',
      CATEGORIES[1].placeholderText,
    );
  });
});

/** 요청 URL로 응답을 고른다. 순서로 짝지으면 조용히 다른 것을 검사하게 된다 */
function mockRoutes(routes: Record<string, { status: number; body: unknown }>) {
  const fetchMock = vi.fn((input: unknown, init?: { body?: unknown }) => {
    void init;
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    const hit = key === undefined ? { status: 404, body: {} } : routes[key];
    return Promise.resolve({
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      json: () => Promise.resolve(hit.body),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const CREATED = {
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
  rewardPerPerson: 50000,
  budget: 150000,
  createdAt: '2026-09-05T00:00:00.000Z',
};

/** 유효한 값으로 폼을 채운다. 주소는 일부러 비워 둔다 (#12 AC6) */
async function fillForm(overrides: { address?: string } = {}) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('회원 id'), 'usr_1');
  await user.selectOptions(screen.getByLabelText('카테고리'), 'cat_1');
  await user.type(screen.getByLabelText('제목'), '사무실 청소');
  if (overrides.address !== undefined) {
    await user.type(screen.getByLabelText('근무 주소'), overrides.address);
  }
  await user.type(screen.getByLabelText('근무 시작'), '2026-10-01T09:00');
  await user.type(screen.getByLabelText('근무 종료'), '2026-10-01T18:00');
  await user.clear(screen.getByLabelText('모집 인원'));
  await user.type(screen.getByLabelText('모집 인원'), '3');
  await user.type(screen.getByLabelText('1인당 보상금'), '50000');
  await user.type(
    screen.getByLabelText('상세 내용'),
    '30평 사무실을 닦습니다.',
  );
  return user;
}

describe('공고 등록 (#12)', () => {
  it('should send the form and show that the budget was held', async () => {
    const fetchMock = mockRoutes({
      '/api/categories': { status: 200, body: CATEGORIES },
      '/api/job-posts': { status: 201, body: CREATED },
    });
    render(<NewJobPostPage />);
    await screen.findByRole('option', { name: '청소' });

    const user = await fillForm();
    await user.click(screen.getByRole('button', { name: '공고 올리기' }));

    expect(
      await screen.findByRole('heading', { name: '공고를 올렸습니다' }),
    ).toBeInTheDocument();
    const sent = fetchMock.mock.calls.find(
      (call) => String(call[0]) === '/api/job-posts',
    );
    expect(sent).toBeDefined();
  });

  it('should leave the work address out so the server fills it in', async () => {
    // 화면이 채우면 주소를 바꾼 사용자가 옛 값을 보낼 수 있다 (AC6).
    const fetchMock = mockRoutes({
      '/api/categories': { status: 200, body: CATEGORIES },
      '/api/job-posts': { status: 201, body: CREATED },
    });
    render(<NewJobPostPage />);
    await screen.findByRole('option', { name: '청소' });

    const user = await fillForm();
    await user.click(screen.getByRole('button', { name: '공고 올리기' }));

    await screen.findByRole('heading', { name: '공고를 올렸습니다' });
    const sent = fetchMock.mock.calls.find(
      (call) => String(call[0]) === '/api/job-posts',
    );
    const body = JSON.parse(String(sent?.[1]?.body ?? '{}')) as Record<
      string,
      unknown
    >;
    expect(body.workAddress).toBeUndefined();
    expect(body.employerId).toBe('usr_1');
  });

  it('should not send the request when a required field is empty', async () => {
    const fetchMock = mockRoutes({
      '/api/categories': { status: 200, body: CATEGORIES },
    });
    render(<NewJobPostPage />);
    await screen.findByRole('option', { name: '청소' });

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: '공고 올리기' }));

    const posted = fetchMock.mock.calls.filter(
      (call) => String(call[0]) === '/api/job-posts',
    );
    expect(posted).toHaveLength(0);
    expect(
      await screen.findByText('제목을 입력해 주세요.'),
    ).toBeInTheDocument();
  });

  it('should show how much is missing when the balance is short', async () => {
    mockRoutes({
      '/api/categories': { status: 200, body: CATEGORIES },
      '/api/job-posts': {
        status: 409,
        body: {
          errorCode: 'POINT_INSUFFICIENT_BALANCE',
          message: '포인트가 50,000원 부족합니다. 충전 후 다시 시도해 주세요.',
          shortfall: 50000,
        },
      },
    });
    render(<NewJobPostPage />);
    await screen.findByRole('option', { name: '청소' });

    const user = await fillForm();
    await user.click(screen.getByRole('button', { name: '공고 올리기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '포인트가 50,000원 부족합니다',
    );
  });

  it('should put a server field error under that field', async () => {
    mockRoutes({
      '/api/categories': { status: 200, body: CATEGORIES },
      '/api/job-posts': {
        status: 400,
        body: {
          errorCode: 'VALIDATION_FAILED',
          message: '입력값을 확인해 주세요.',
          fieldErrors: { headcount: ['한 명 이상 모집해야 합니다.'] },
        },
      },
    });
    render(<NewJobPostPage />);
    await screen.findByRole('option', { name: '청소' });

    const user = await fillForm();
    await user.click(screen.getByRole('button', { name: '공고 올리기' }));

    expect(
      await screen.findByText('한 명 이상 모집해야 합니다.'),
    ).toBeInTheDocument();
  });
});

describe('공고 작성 — 지역 (#13)', () => {
  it('should ask for a region when the address is typed by hand', async () => {
    // 지역 없이 저장되면 그 공고는 지역 필터에서 조용히 빠진다.
    const fetchMock = mockRoutes({
      '/api/categories': { status: 200, body: CATEGORIES },
      '/api/job-posts': { status: 201, body: CREATED },
    });
    render(<NewJobPostPage />);
    await screen.findByRole('option', { name: '청소' });

    const user = await fillForm({ address: '서울 마포구 월드컵북로 1' });
    await user.click(screen.getByRole('button', { name: '공고 올리기' }));

    expect(
      await screen.findByText('주소를 직접 입력하면 시/도도 함께 골라 주세요.'),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/job-posts'),
    ).toHaveLength(0);
  });

  it('should send the region along with a hand-typed address', async () => {
    const fetchMock = mockRoutes({
      '/api/categories': { status: 200, body: CATEGORIES },
      '/api/job-posts': { status: 201, body: CREATED },
    });
    render(<NewJobPostPage />);
    await screen.findByRole('option', { name: '청소' });

    const user = await fillForm({ address: '서울 마포구 월드컵북로 1' });
    await user.type(screen.getByLabelText('시/도'), '서울');
    await user.type(screen.getByLabelText('시/군/구'), '마포구');
    await user.click(screen.getByRole('button', { name: '공고 올리기' }));

    await screen.findByRole('heading', { name: '공고를 올렸습니다' });
    const sent = fetchMock.mock.calls.find(
      (call) => String(call[0]) === '/api/job-posts',
    );
    const body = JSON.parse(String(sent?.[1]?.body ?? '{}')) as Record<
      string,
      unknown
    >;
    expect(body.workSido).toBe('서울');
    expect(body.workSigungu).toBe('마포구');
  });
});
