'use client';

import type { ReactElement } from 'react';
import {
  formatRating,
  type AdminMemberDetail as AdminMemberDetailData,
  type AdminMemberStatus,
  type ApplicationStatus,
  type JobPostStatus,
  type PenaltyReason,
  type PointTransactionType,
} from '@fixer/shared';
import styles from './page.module.css';

export interface AdminMemberDetailProps {
  member: AdminMemberDetailData | null;
  /** 403을 받았다. 상세 대신 안내를 그린다 */
  forbidden?: boolean;
}

const MEMBER_STATUS_LABELS: Record<AdminMemberStatus, string> = {
  ACTIVE: '정상',
  SUSPENDED: '제재중',
  DEACTIVATED: '비활성화',
};

const JOB_POST_STATUS_LABELS: Record<JobPostStatus, string> = {
  DRAFT: '작성 중',
  OPEN: '모집 중',
  CLOSED: '모집 마감',
  COMPLETED: '완료',
  CANCELLED: '취소됨',
  EXPIRED: '기간 만료',
};

const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  APPLIED: '지원함',
  ACCEPTED: '수락됨',
  REJECTED: '거절됨',
  WITHDRAWN: '철회함',
  PENDING_REACCEPT: '재동의 대기',
  COMPLETED: '완료',
  CANCELLED_FREE: '취소됨',
  CANCELLED_PENALTY: '취소됨',
  CANCELLED_BY_VERSION_CHANGE: '조건 변경으로 취소됨',
  NO_SHOW: '불참',
};

const LEDGER_TYPE_LABELS: Record<PointTransactionType, string> = {
  CHARGE: '충전',
  HOLD: '예산 잠금',
  RELEASE: '잠금 해제',
  PAYOUT: '지급',
  EXCHANGE_REQUEST: '환전 요청',
  EXCHANGE_REVERT: '환전 반려',
  REFUND: '결제 취소',
};

const PENALTY_REASON_LABELS: Record<PenaltyReason, string> = {
  NO_SHOW: '무단 불참',
  LATE_CANCEL: '지각 취소',
  SAME_DAY_CANCEL: '당일 취소',
  POSTER_CANCEL: '구인자 취소',
};

/** 역할별 평점의 라벨 (§2.1) */
const ROLE_LABELS = { POSTER: '구인자', WORKER: '구직자' } as const;

/** ISO 문자열에서 날짜만. 관리자 목록과 같은 자르기다 */
function day(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * 관리자 회원 상세. (이슈 #32, `spec-fixed.md` §11.3)
 *
 * AC5가 요구하는 다섯 덩이(평점·리뷰·거래 이력·포인트·제재 이력)를 한 화면에
 * 그린다. 서버가 한 번에 주므로 여기서 덩이마다 부르지 않는다.
 */
export function AdminMemberDetail({
  member,
  forbidden,
}: AdminMemberDetailProps): ReactElement {
  if (forbidden === true || member === null) {
    return (
      <main className={styles.page}>
        <p className={styles.notice}>
          {forbidden === true ? '권한이 없습니다.' : '회원을 찾을 수 없습니다.'}
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>
        {member.name} ({MEMBER_STATUS_LABELS[member.status]})
      </h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>기본 정보</h2>
        <dl className={styles.info}>
          <dt>이메일</dt>
          <dd>{member.email}</dd>
          <dt>가입일</dt>
          <dd>{day(member.joinedAt)}</dd>
          <dt>주소</dt>
          <dd>
            {member.address === null
              ? '등록된 주소가 없습니다'
              : `${member.address.sido} ${member.address.sigungu} ${member.address.roadAddress}`}
          </dd>
        </dl>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>평점</h2>
        <dl className={styles.info}>
          {/* 역할별로 나뉜다 (§2.1). 표본이 모자라면 "신규"다 (§7) */}
          <dt>구인자로서</dt>
          <dd>
            {formatRating(member.asPoster.average, member.asPoster.count)} (
            {member.asPoster.count}건)
          </dd>
          <dt>구직자로서</dt>
          <dd>
            {formatRating(member.asWorker.average, member.asWorker.count)} (
            {member.asWorker.count}건)
          </dd>
        </dl>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>받은 별점</h2>
        <ul className={styles.list}>
          {member.reviews.map((review) => (
            <li key={review.id}>
              <span className={styles.score}>{review.score}점</span>{' '}
              <span>{ROLE_LABELS[review.rateeRole]}로서</span> ·{' '}
              <span>{review.jobPostTitle}</span> ·{' '}
              <span>{review.raterName}</span> · {day(review.createdAt)}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>등록한 공고</h2>
        <ul className={styles.list}>
          {member.jobPosts.map((post) => (
            <li key={post.id}>
              <span>{post.title}</span> · {JOB_POST_STATUS_LABELS[post.status]}{' '}
              · {day(post.createdAt)}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>신청 이력</h2>
        <ul className={styles.list}>
          {member.applications.map((application) => (
            <li key={application.id}>
              {application.jobPostTitle} ·{' '}
              {APPLICATION_STATUS_LABELS[application.status]} ·{' '}
              {day(application.createdAt)}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>포인트</h2>
        {/* 캐시가 아니라 원장 합이다 (ADR-PAY-1) */}
        <p className={styles.balance}>
          잔액 {member.pointBalance.toLocaleString('ko-KR')}P
        </p>
        <ul className={styles.list}>
          {member.ledger.map((entry) => (
            <li key={entry.id}>
              {LEDGER_TYPE_LABELS[entry.type]} ·{' '}
              {entry.amount.toLocaleString('ko-KR')}P · {day(entry.createdAt)}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>제재 이력</h2>
        <ul className={styles.list}>
          {member.penalties.map((penalty) => (
            <li key={penalty.id}>
              <span>{PENALTY_REASON_LABELS[penalty.reason]}</span> ·{' '}
              {day(penalty.occurredAt)}
            </li>
          ))}
        </ul>
        <ul className={styles.list}>
          {member.suspensions.map((suspension) => (
            <li key={suspension.id}>
              {day(suspension.startAt)} ~ {day(suspension.endAt)}
              {suspension.releasedAt === null
                ? ''
                : ` · ${day(suspension.releasedAt)} 해제`}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
