'use client';

import { jobPostDetailSchema, type JobPostDetail } from '@fixer/shared';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApplyPanel } from './ApplyPanel';
import styles from './page.module.css';

/** 상태를 사람 말로. 코드가 그대로 보이면 무슨 뜻인지 알 수 없다 */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '작성 중',
  OPEN: '모집 중',
  CLOSED: '모집 마감',
  COMPLETED: '완료',
  CANCELLED: '취소됨',
  EXPIRED: '기간 만료',
};

/**
 * 공고 상세. (이슈 #14)
 *
 * **소프트 삭제된 공고는 없는 것처럼 보인다.** "삭제되었습니다"를 띄우면
 * 그 공고가 존재했다는 사실과 id가 유효했다는 것이 새어나간다.
 */
export function JobPostDetail({ id }: { id: string }) {
  const [post, setPost] = useState<JobPostDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/job-posts/${encodeURIComponent(id)}`);
        const json: unknown = await res.json();
        if (cancelled) return;

        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error('상세 요청이 실패했습니다.');
        setPost(jobPostDetailSchema.parse(json));
      } catch {
        if (!cancelled) setError('공고를 불러오지 못했습니다.');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (notFound) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>공고를 찾을 수 없습니다</h1>
        <p className={styles.lead}>
          주소가 잘못되었거나 더 이상 볼 수 없는 공고입니다.
        </p>
        <Link className={styles.back} href="/job-posts">
          목록으로
        </Link>
      </main>
    );
  }

  if (error !== null) {
    return (
      <main className={styles.page}>
        <p className={styles.error} role="alert">
          {error}
        </p>
        <Link className={styles.back} href="/job-posts">
          목록으로
        </Link>
      </main>
    );
  }

  if (post === null) {
    return (
      <main className={styles.page}>
        <p className={styles.lead}>불러오는 중…</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <p className={styles.category}>{post.categoryName}</p>
      <h1 className={styles.title}>{post.title}</h1>
      <p className={styles.status}>
        {STATUS_LABELS[post.status] ?? post.status}
      </p>

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>근무 주소</dt>
          <dd>{post.workAddress}</dd>
        </div>
        <div className={styles.fact}>
          <dt>근무 시간</dt>
          <dd>
            <time dateTime={post.workStartAt}>
              {formatDateTime(post.workStartAt)}
            </time>
            {' ~ '}
            <time dateTime={post.workEndAt}>
              {formatDateTime(post.workEndAt)}
            </time>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>확정 인원</dt>
          {/* "3 / 6" 형태. 몇 명이 더 필요한지 한눈에 보여야 한다 (AC2) */}
          <dd className={styles.numbers}>
            {post.acceptedCount} / {post.headcount}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>1인당 보상금</dt>
          <dd className={styles.numbers}>
            {post.rewardPerPerson.toLocaleString()}포인트
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>잠긴 예산</dt>
          <dd className={styles.numbers}>
            {post.budget.toLocaleString()}포인트
          </dd>
        </div>
      </dl>

      <section className={styles.description}>
        <h2 className={styles.subtitle}>상세 내용</h2>
        <p className={styles.body}>{post.requiredDescription}</p>
      </section>

      <ApplyPanel jobPostId={post.id} />

      <Link className={styles.back} href="/job-posts">
        목록으로
      </Link>
    </main>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
