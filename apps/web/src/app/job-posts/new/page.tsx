'use client';

import {
  categoryListSchema,
  createJobPostRequestSchema,
  jobPostSummarySchema,
  type Category,
} from '@fixer/shared';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ZodError } from 'zod';
import styles from './page.module.css';

/** 카테고리를 고르기 전에 뜨는 안내 */
const NOTHING_CHOSEN = '카테고리를 먼저 골라 주세요.';

/** 칸별 오류 문구. 키는 zod 스키마의 필드명과 같다 */
type FieldErrors = Record<string, string>;

/**
 * 공고 작성 화면. (이슈 #11 · #12)
 *
 * 안내 문구를 화면에서 만들지 않고 서버가 준 `placeholderText`를 그대로 쓴다.
 * 문구를 고칠 때 재배포가 필요 없게 하려는 것이 그 설계의 목적이다 (§3.1).
 *
 * **근무 주소는 비워 보낼 수 있다.** 서버가 가입 주소로 채운다 — 화면이
 * 채우면 주소를 바꾼 사용자가 옛 값을 보낼 수 있다.
 */
export default function NewJobPostPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [chosenId, setChosenId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // #4가 머지되면 토큰 주체로 바뀐다. 지금은 화면에서 받는다.
  const [employerId, setEmployerId] = useState('');
  const [title, setTitle] = useState('');
  const [workAddress, setWorkAddress] = useState('');
  // 주소를 직접 쓰면 지역도 받아야 한다. 안 받으면 그 공고가 지역
  // 필터에서 조용히 빠져 아무에게도 안 보인다 (#13).
  const [workSido, setWorkSido] = useState('');
  const [workSigungu, setWorkSigungu] = useState('');
  const [workStartAt, setWorkStartAt] = useState('');
  const [workEndAt, setWorkEndAt] = useState('');
  const [headcount, setHeadcount] = useState('1');
  const [rewardPerPerson, setRewardPerPerson] = useState('');
  const [requiredDescription, setRequiredDescription] = useState('');

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

  /** 예산 미리보기. 서버가 잠글 금액과 같은 식이다 */
  const budget = Number(headcount) * Number(rewardPerPerson);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const request = {
      categoryId: chosenId,
      title,
      // 빈 문자열이 아니라 undefined로 보낸다. "안 정했다"와 "빈 값을
      // 정했다"는 다르고, 서버는 전자만 기본값으로 채운다.
      workAddress: workAddress.trim() === '' ? undefined : workAddress,
      workSido: workSido.trim() === '' ? undefined : workSido,
      workSigungu: workSigungu.trim() === '' ? undefined : workSigungu,
      workStartAt: toIso(workStartAt),
      workEndAt: toIso(workEndAt),
      headcount: Number(headcount),
      rewardPerPerson: Number(rewardPerPerson),
      requiredDescription,
    };

    // 서버와 같은 스키마로 먼저 본다. 틀린 요청은 보내지 않고 그 칸 아래에
    // 문구를 띄운다.
    const parsed = createJobPostRequestSchema.safeParse(request);
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/job-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employerId, ...parsed.data }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setFieldErrors(serverFieldErrors(json));
        setError(messageOf(json));
        return;
      }
      setCreatedId(jobPostSummarySchema.parse(json).id);
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  if (createdId !== null) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>공고를 올렸습니다</h1>
        <p className={styles.note}>
          예산 {budget.toLocaleString()}포인트가 잠겼습니다. 모집이 끝나거나
          공고를 취소하면 남은 금액이 돌아옵니다.
        </p>
        <Link className={styles.secondary} href="/job-posts">
          목록에서 보기
        </Link>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>공고 올리기</h1>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="employerId">
            회원 id
          </label>
          <input
            id="employerId"
            className={styles.input}
            value={employerId}
            onChange={(e) => setEmployerId(e.target.value)}
            placeholder="로그인이 붙기 전까지 직접 입력합니다"
          />
        </div>

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
          <FieldError message={fieldErrors.categoryId} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="title">
            제목
          </label>
          <input
            id="title"
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <FieldError message={fieldErrors.title} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="workAddress">
            근무 주소
          </label>
          <input
            id="workAddress"
            className={styles.input}
            value={workAddress}
            onChange={(e) => setWorkAddress(e.target.value)}
            placeholder="비워 두면 가입 주소로 채워집니다"
          />
          <FieldError message={fieldErrors.workAddress} />
        </div>

        {/* 주소를 직접 쓴 경우에만 필요하다. 비워 두면 가입 주소의
            지역이 그대로 따라온다. */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="workSido">
            시/도
          </label>
          <input
            id="workSido"
            className={styles.input}
            value={workSido}
            onChange={(e) => setWorkSido(e.target.value)}
            placeholder="주소를 직접 입력했을 때만"
          />
          <FieldError message={fieldErrors.workSido} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="workSigungu">
            시/군/구
          </label>
          <input
            id="workSigungu"
            className={styles.input}
            value={workSigungu}
            onChange={(e) => setWorkSigungu(e.target.value)}
            placeholder="주소를 직접 입력했을 때만"
          />
          <FieldError message={fieldErrors.workSigungu} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="workStartAt">
            근무 시작
          </label>
          <input
            id="workStartAt"
            className={styles.input}
            type="datetime-local"
            value={workStartAt}
            onChange={(e) => setWorkStartAt(e.target.value)}
          />
          <FieldError message={fieldErrors.workStartAt} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="workEndAt">
            근무 종료
          </label>
          <input
            id="workEndAt"
            className={styles.input}
            type="datetime-local"
            value={workEndAt}
            onChange={(e) => setWorkEndAt(e.target.value)}
          />
          <FieldError message={fieldErrors.workEndAt} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="headcount">
            모집 인원
          </label>
          <input
            id="headcount"
            className={styles.input}
            type="number"
            min={1}
            value={headcount}
            onChange={(e) => setHeadcount(e.target.value)}
          />
          <FieldError message={fieldErrors.headcount} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="rewardPerPerson">
            1인당 보상금
          </label>
          <input
            id="rewardPerPerson"
            className={styles.input}
            type="number"
            step={1000}
            value={rewardPerPerson}
            onChange={(e) => setRewardPerPerson(e.target.value)}
          />
          <FieldError message={fieldErrors.rewardPerPerson} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="detail">
            상세 내용
          </label>
          {/* 고른 카테고리의 안내가 여기 뜬다. #11의 핵심이다. */}
          <textarea
            id="detail"
            className={styles.textarea}
            rows={8}
            value={requiredDescription}
            onChange={(e) => setRequiredDescription(e.target.value)}
            placeholder={chosen?.placeholderText ?? NOTHING_CHOSEN}
          />
          <FieldError message={fieldErrors.requiredDescription} />
        </div>

        <p className={styles.note}>
          등록하면 <strong>{Number.isFinite(budget) ? budget : 0}</strong>
          포인트가 잠깁니다. (모집 인원 × 1인당 보상금)
        </p>

        <button className={styles.submit} type="submit" disabled={loading}>
          {loading ? '올리는 중…' : '공고 올리기'}
        </button>
      </form>
    </main>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className={styles.fieldError} role="alert">
      {message}
    </p>
  );
}

/**
 * `datetime-local` 값을 ISO로 바꾼다.
 *
 * 빈 값은 빈 문자열로 둔다 — `new Date('')`는 `Invalid Date`가 되어
 * "고르지 않았다"가 "1970년"으로 둔갑한다.
 */
function toIso(local: string): string {
  if (local === '') return '';
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

/** zod 오류에서 칸별 첫 문구만 뽑는다 */
function toFieldErrors(error: ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '');
    if (field === '') continue;
    fieldErrors[field] ??= issue.message;
  }
  return fieldErrors;
}

/** 서버가 준 칸별 오류. 첫 문구만 쓴다 */
function serverFieldErrors(json: unknown): FieldErrors {
  const raw = (json as { fieldErrors?: unknown } | null)?.fieldErrors;
  if (typeof raw !== 'object' || raw === null) return {};

  const fieldErrors: FieldErrors = {};
  for (const [field, messages] of Object.entries(raw)) {
    if (Array.isArray(messages) && typeof messages[0] === 'string') {
      fieldErrors[field] = messages[0];
    }
  }
  return fieldErrors;
}

/** 서버가 준 문구를 그대로 쓴다. 화면에서 다시 만들지 않는다 */
function messageOf(json: unknown): string {
  if (
    typeof json === 'object' &&
    json !== null &&
    'message' in json &&
    typeof (json as { message: unknown }).message === 'string'
  ) {
    return (json as { message: string }).message;
  }
  return '요청을 처리하지 못했습니다.';
}
