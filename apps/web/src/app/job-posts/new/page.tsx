'use client';

import { categoryListSchema, type Category } from '@fixer/shared';
import { useEffect, useState } from 'react';
import styles from './page.module.css';

/** 카테고리를 고르기 전에 뜨는 안내 */
const NOTHING_CHOSEN = '카테고리를 먼저 골라 주세요.';

/**
 * 공고 작성 화면. (이슈 #11)
 *
 * 지금은 **카테고리 선택과 안내 문구까지만**이다. 제목·주소·일시·인원·보상금은
 * #12가 붙인다.
 *
 * 안내 문구를 화면에서 만들지 않고 서버가 준 `placeholderText`를 그대로 쓴다.
 * 문구를 고칠 때 재배포가 필요 없게 하려는 것이 이 설계의 목적이다 (spec-fixed §3.1).
 */
export default function NewJobPostPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [chosenId, setChosenId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // 활성 필터와 정렬은 서버가 한다. 받은 순서를 그대로 쓴다.
        const res = await fetch('/api/categories');
        const json: unknown = await res.json();
        if (cancelled) return;
        setCategories(categoryListSchema.parse(json));
      } catch {
        if (!cancelled) setError('카테고리를 불러오지 못했습니다.');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const chosen = categories.find((category) => category.id === chosenId);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>공고 올리기</h1>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <form className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="category">
            카테고리
          </label>
          <select
            id="category"
            className={styles.input}
            value={chosenId}
            onChange={(e) => setChosenId(e.target.value)}
          >
            <option value="">선택해 주세요</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="detail">
            상세 내용
          </label>
          {/* 고른 카테고리의 안내가 여기 뜬다. 이 이슈의 핵심이다. */}
          <textarea
            id="detail"
            className={styles.textarea}
            rows={8}
            placeholder={chosen?.placeholderText ?? NOTHING_CHOSEN}
          />
        </div>

        <p className={styles.note}>
          제목·근무 주소·일시·모집 인원·보상금은 이슈 #12에서 붙입니다.
        </p>
      </form>
    </main>
  );
}
