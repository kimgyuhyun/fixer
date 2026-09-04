'use client';

import {
  JOB_POST_PAGE_SIZE,
  categoryListSchema,
  filterToQuery,
  jobPostListSchema,
  type Category,
  type JobPostFilter,
  type JobPostSummary,
} from '@fixer/shared';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from './page.module.css';

/** 타이핑을 멈추고 이만큼 지나면 적용한다. (§11.2) */
const TYPING_DELAY_MS = 300;

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

  /**
   * 타이핑 필터의 디바운스 타이머. (§11.2 — 300ms)
   *
   * 글자마다 URL을 바꾸면 요청이 글자 수만큼 나가고, 히스토리에도 글자마다
   * 엔트리가 쌓여 뒤로가기를 열 번 눌러야 빠져나온다.
   */
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (typingTimer.current !== null) clearTimeout(typingTimer.current);
    },
    [],
  );

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
   *
   * **`replace`가 아니라 `push`다.** `ADR-JOB-4`는 `replace`를 적었지만
   * 그러면 히스토리에 엔트리가 안 쌓여, 필터를 두 번 바꾼 뒤 뒤로가기를
   * 누르면 이전 필터가 아니라 **목록 화면 자체를 벗어난다.** AC8이 요구하는
   * 것은 이전 필터로 돌아가는 것이라 `push`여야 한다.
   */
  function apply(changes: Partial<Record<Chip['key'] | 'page', string>>) {
    const next: JobPostFilter = {
      category: pick(changes, 'category', category),
      sido: pick(changes, 'sido', sido),
      sigungu: pick(changes, 'sigungu', sigungu),
      q: pick(changes, 'q', q),
      // 필터를 바꾸면 1페이지로 되돌린다. 페이지 이동일 때만 그 값을 쓴다.
      page: 'page' in changes ? Number(changes.page ?? '1') || 1 : 1,
    };

    const search = filterToQuery(next);
    router.push(search === '' ? '/job-posts' : `/job-posts?${search}`);
  }

  /** 타이핑은 멈춘 뒤에 적용한다. 글자마다 URL을 바꾸지 않는다 */
  function applyLater(changes: Partial<Record<Chip['key'], string>>) {
    if (typingTimer.current !== null) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => apply(changes), TYPING_DELAY_MS);
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

        {/*
          타이핑 칸은 `key`에 URL 값을 준다. URL이 바뀌면 다시 마운트되어
          그 값이 그대로 뜬다 — **필터 상태를 컴포넌트가 들고 있지 않으면서**
          타이핑 중에는 화면이 튀지 않는다 (ADR-JOB-4).
        */}
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>시/도</span>
          <input
            key={`sido:${sido}`}
            className={styles.filterInput}
            defaultValue={sido}
            onChange={(e) => applyLater({ sido: e.target.value })}
          />
        </label>

        <label className={styles.filterField}>
          <span className={styles.filterLabel}>시/군/구</span>
          <input
            key={`sigungu:${sigungu}`}
            className={styles.filterInput}
            defaultValue={sigungu}
            onChange={(e) => applyLater({ sigungu: e.target.value })}
          />
        </label>

        <label className={styles.filterField}>
          <span className={styles.filterLabel}>검색</span>
          <input
            key={`q:${q}`}
            className={styles.filterInput}
            defaultValue={q}
            onChange={(e) => applyLater({ q: e.target.value })}
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
              <h2 className={styles.cardTitle}>
                {/* 목록에서 클릭하면 상세로 간다 (#14 AC1) */}
                <Link href={`/job-posts/${item.id}`}>{item.title}</Link>
              </h2>
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

/** 바뀐 값이 있으면 그것을, 없으면 지금 값을. 빈 문자열은 "해제"다 */
function pick(
  changes: Partial<Record<string, string>>,
  key: string,
  current: string,
): string | undefined {
  const next = key in changes ? (changes[key] ?? '') : current;
  return next === '' ? undefined : next;
}
