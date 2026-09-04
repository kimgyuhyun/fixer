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
