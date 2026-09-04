'use client';

import {
  JOB_POST_PAGE_SIZE,
  categoryListSchema,
  jobPostListSchema,
  type Category,
  type JobPostSummary,
} from '@fixer/shared';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from './page.module.css';

/** 적용된 조건 하나. 칩으로 보이고 개별 해제된다 (§11.2) */
interface Chip {
  key: 'category' | 'sido' | 'sigungu' | 'q';
  label: string;
}

/**
 * 공고 목록. (이슈 #12 · #13)
 *
 * **필터의 진실은 URL 하나다** (`ADR-JOB-4`). 이 컴포넌트는 필터를 상태로
 * 들고 있지 않는다 — `useState`와 URL 둘을 두면 뒤로가기에서 어긋나고,
 * 그게 AC8이 확인하는 항목이다.
 */
export function JobPostList() {
  const router = useRouter();
  const params = useSearchParams();

  const category = params.get('category') ?? '';
  const sido = params.get('sido') ?? '';
  const sigungu = params.get('sigungu') ?? '';
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const [items, setItems] = useState<JobPostSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // 목록은 URL이 바뀔 때마다 다시 읽는다. URL이 곧 요청이다.
  const query = params.toString();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/job-posts?${query}`);
        const json: unknown = await res.json();
        if (cancelled) return;
        // 상태를 먼저 본다. 스키마 파싱이 우연히 실패해 주는 것에 기대면,
        // 서버가 500과 함께 그럴듯한 모양을 주는 날 조용히 통과한다.
        if (!res.ok) throw new Error('목록 요청이 실패했습니다.');
        const list = jobPostListSchema.parse(json);
        setItems(list.items);
        setTotal(list.total);
        setError(null);
      } catch {
        if (!cancelled) setError('공고를 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [query]);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      try {
        const res = await fetch('/api/categories');
        const json: unknown = await res.json();
        if (!cancelled) setCategories(categoryListSchema.parse(json));
      } catch {
        // 카테고리를 못 읽어도 목록은 보여준다. 필터만 못 거는 것이다.
      }
    }

    void loadCategories();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 조건 하나를 바꾼다. **URL만 고친다.**
   *
   * 필터를 바꾸면 페이지를 1로 되돌린다 — 3페이지를 보다 카테고리를 바꾸면
   * 결과가 1페이지뿐이라 빈 화면이 나온다.
   */
  function apply(changes: Partial<Record<Chip['key'] | 'page', string>>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in changes)) next.delete('page');

    const search = next.toString();
    router.replace(search === '' ? '/job-posts' : `/job-posts?${search}`);
  }

  const chips: Chip[] = [];
  if (category) {
    const name = categories.find((c) => c.id === category)?.name ?? category;
    chips.push({ key: 'category', label: `카테고리: ${name}` });
  }
  if (sido) chips.push({ key: 'sido', label: `시/도: ${sido}` });
  if (sigungu) chips.push({ key: 'sigungu', label: `시/군/구: ${sigungu}` });
  if (q) chips.push({ key: 'q', label: `검색: ${q}` });

  const lastPage = Math.max(1, Math.ceil(total / JOB_POST_PAGE_SIZE));

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>일거리</h1>
        <Link className={styles.newLink} href="/job-posts/new">
          공고 올리기
        </Link>
      </div>

      <div className={styles.filters}>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>카테고리</span>
          <select
            className={styles.filterInput}
            value={category}
            onChange={(e) => apply({ category: e.target.value })}
          >
            <option value="">전체</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.filterField}>
          <span className={styles.filterLabel}>시/도</span>
          <input
            className={styles.filterInput}
            value={sido}
            onChange={(e) => apply({ sido: e.target.value })}
          />
        </label>

        <label className={styles.filterField}>
          <span className={styles.filterLabel}>시/군/구</span>
          <input
            className={styles.filterInput}
            value={sigungu}
            onChange={(e) => apply({ sigungu: e.target.value })}
          />
        </label>

        <label className={styles.filterField}>
          <span className={styles.filterLabel}>검색</span>
          <input
            className={styles.filterInput}
            value={q}
            onChange={(e) => apply({ q: e.target.value })}
            placeholder="제목"
          />
        </label>
      </div>

      {chips.length > 0 && (
        <ul className={styles.chips}>
          {chips.map((chip) => (
            <li key={chip.key}>
              {/* 칩 하나를 지우면 그 조건만 풀리고 나머지는 남는다 (AC4) */}
              <button
                className={styles.chip}
                type="button"
                onClick={() => apply({ [chip.key]: '' })}
              >
                {chip.label} <span aria-hidden="true">×</span>
                <span className={styles.srOnly}>해제</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {loaded && !error && <p className={styles.total}>총 {total}건</p>}

      {loaded && !error && items.length === 0 ? (
        <p className={styles.empty}>조건에 맞는 일거리가 없습니다.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.card}>
              <h2 className={styles.cardTitle}>{item.title}</h2>
              <p className={styles.address}>{item.workAddress}</p>
              <dl className={styles.meta}>
                <div className={styles.metaRow}>
                  <dt>근무</dt>
                  <dd>
                    <time dateTime={item.workStartAt}>
                      {formatDateTime(item.workStartAt)}
                    </time>
                    {' ~ '}
                    <time dateTime={item.workEndAt}>
                      {formatDateTime(item.workEndAt)}
                    </time>
                  </dd>
                </div>
                <div className={styles.metaRow}>
                  <dt>모집</dt>
                  <dd>{item.headcount}명</dd>
                </div>
                <div className={styles.metaRow}>
                  <dt>1인당</dt>
                  <dd className={styles.reward}>
                    {item.rewardPerPerson.toLocaleString()}포인트
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      {loaded && !error && total > JOB_POST_PAGE_SIZE && (
        <nav className={styles.pager} aria-label="페이지">
          <button
            className={styles.pagerButton}
            type="button"
            disabled={page <= 1}
            onClick={() => apply({ page: String(page - 1) })}
          >
            이전
          </button>
          <span className={styles.pagerNow}>
            {page} / {lastPage}
          </span>
          <button
            className={styles.pagerButton}
            type="button"
            disabled={page >= lastPage}
            onClick={() => apply({ page: String(page + 1) })}
          >
            다음
          </button>
        </nav>
      )}
    </main>
  );
}

/** 화면에 보일 일시. 서버가 준 ISO를 그대로 `dateTime`에 남긴다 */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
