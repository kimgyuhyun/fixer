import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobPostDetail } from './JobPostDetail';

const DETAIL = {
  id: 'job_1',
  title: '사무실 청소',
  categoryId: 'cat_1',
  categoryName: '청소',
  status: 'OPEN',
  version: 1,
  workAddress: '서울 강남구 테헤란로 1',
  workSido: '서울',
  workSigungu: '강남구',
  workStartAt: '2026-10-01T09:00:00.000Z',
  workEndAt: '2026-10-01T18:00:00.000Z',
  headcount: 6,
  rewardPerPerson: 50_000,
  budget: 300_000,
  requiredDescription: '30평 사무실 바닥과 창문을 닦습니다.',
  acceptedCount: 3,
  createdAt: '2026-09-05T00:00:00.000Z',
};

function mockDetail(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

/**
 * 본체를 직접 렌더한다.
 *
 * 페이지 껍데기는 `use(params)`로 id를 푸는 일만 하는데, `use()`는 프라미스를
 * 기다리며 렌더를 멈춰 테스트가 화면을 못 본다. 검증 대상은 본체다.
 */
function renderDetail(id: string) {
  return render(<JobPostDetail id={id} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('공고 상세 (#14 AC1)', () => {
  it('should show every required field', async () => {
    mockDetail(200, DETAIL);

    renderDetail('job_1');

    expect(
      await screen.findByRole('heading', { name: '사무실 청소' }),
    ).toBeInTheDocument();
    expect(screen.getByText('서울 강남구 테헤란로 1')).toBeInTheDocument();
    expect(
      screen.getByText('30평 사무실 바닥과 창문을 닦습니다.'),
    ).toBeInTheDocument();
    expect(screen.getByText('50,000포인트')).toBeInTheDocument();
  });

  it('should show the category name instead of its id', async () => {
    // 화면이 카테고리를 다시 조회하면 요청이 두 번 나가고 깜빡인다.
    mockDetail(200, DETAIL);

    renderDetail('job_1');

    expect(await screen.findByText('청소')).toBeInTheDocument();
    expect(screen.queryByText('cat_1')).not.toBeInTheDocument();
  });

  it('should show the locked budget', async () => {
    mockDetail(200, DETAIL);

    renderDetail('job_1');

    expect(await screen.findByText('300,000포인트')).toBeInTheDocument();
  });
});

describe('공고 상세 — 확정 인원 (#14 AC2)', () => {
  it('should show the confirmed headcount as "3 / 6"', async () => {
    mockDetail(200, DETAIL);

    renderDetail('job_1');

    expect(await screen.findByText('3 / 6')).toBeInTheDocument();
  });

  it('should show zero accepted until applications exist', async () => {
    mockDetail(200, { ...DETAIL, acceptedCount: 0 });

    renderDetail('job_1');

    expect(await screen.findByText('0 / 6')).toBeInTheDocument();
  });
});

describe('공고 상세 — 없는 공고 (#14 AC3)', () => {
  it('should say the post cannot be found', async () => {
    mockDetail(404, {
      errorCode: 'JOB_POST_NOT_FOUND',
      message: '공고를 찾을 수 없습니다.',
    });

    renderDetail('job_gone');

    expect(
      await screen.findByRole('heading', { name: '공고를 찾을 수 없습니다' }),
    ).toBeInTheDocument();
  });

  it('should not hint that the post ever existed', async () => {
    // "삭제되었습니다"를 띄우면 존재했다는 사실이 새어나간다.
    mockDetail(404, {
      errorCode: 'JOB_POST_NOT_FOUND',
      message: '공고를 찾을 수 없습니다.',
    });

    renderDetail('job_gone');
    await screen.findByRole('heading', { name: '공고를 찾을 수 없습니다' });

    expect(screen.queryByText(/삭제/)).not.toBeInTheDocument();
  });

  it('should show an error separate from not-found when the request fails', async () => {
    mockDetail(500, {});

    renderDetail('job_1');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '공고를 불러오지 못했습니다.',
    );
  });

  it('should still show a cancelled post', async () => {
    // 목록에는 안 뜨지만 이미 지원한 사람은 다시 열 수 있어야 한다.
    mockDetail(200, { ...DETAIL, status: 'CANCELLED' });

    renderDetail('job_1');

    expect(await screen.findByText('취소됨')).toBeInTheDocument();
  });
});
