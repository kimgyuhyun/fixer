import { describe, expect, it } from 'vitest';
import {
  JOB_POST_REQUIRED_FIELDS,
  canTransition,
  changedRequiredFields,
  describeRequiredChanges,
  type RequiredFieldValues,
} from './job-post.js';

const BEFORE: RequiredFieldValues = {
  workAddress: '서울 강남구 테헤란로 1',
  workStartAt: '2026-10-01T09:00:00.000Z',
  workEndAt: '2026-10-01T18:00:00.000Z',
  headcount: 3,
  rewardPerPerson: 50_000,
  requiredDescription: '30평 사무실을 닦습니다.',
};

/** 그 필드를 실제로 바꾼 값 하나 */
const CHANGED: RequiredFieldValues = {
  workAddress: '서울 마포구 월드컵북로 1',
  workStartAt: '2026-10-02T09:00:00.000Z',
  workEndAt: '2026-10-02T18:00:00.000Z',
  headcount: 5,
  rewardPerPerson: 60_000,
  requiredDescription: '창고를 정리합니다.',
};

describe('changedRequiredFields — 6개 각각 (AC4)', () => {
  it('should detect a change in each of the six fields, one at a time', () => {
    // **필드를 7번째로 추가하면 이 테스트도 함께 늘려야 한다** (ADR-JOB-2가
    // 알고도 감수한 위험이고, 그걸 막는 것이 이 순회다).
    expect(JOB_POST_REQUIRED_FIELDS).toHaveLength(6);

    for (const field of JOB_POST_REQUIRED_FIELDS) {
      const patch = { [field]: CHANGED[field] };

      expect(changedRequiredFields(BEFORE, patch)).toEqual([field]);
    }
  });

  it('should report nothing changed for an empty patch', () => {
    expect(changedRequiredFields(BEFORE, {})).toEqual([]);
  });

  it('should report nothing when every field is sent unchanged', () => {
    // 되돌린 수정은 아무것도 안 바뀐 것과 같다 (AC5).
    expect(changedRequiredFields(BEFORE, { ...BEFORE })).toEqual([]);
  });

  it('should compare dates as instants, not strings', () => {
    // `09:00:00.000Z`와 `09:00:00Z`는 문자열로는 다르지만 같은 순간이다.
    // 문자열로 비교하면 안 바뀐 것이 바뀐 것이 되어 지원자 전원이 재동의
    // 대기가 된다.
    const sameInstant = { workStartAt: '2026-10-01T09:00:00Z' };

    expect(changedRequiredFields(BEFORE, sameInstant)).toEqual([]);
  });

  it('should still detect a real date change', () => {
    expect(
      changedRequiredFields(BEFORE, { workStartAt: '2026-10-01T10:00:00Z' }),
    ).toEqual(['workStartAt']);
  });

  it('should ignore fields that do not raise the version', () => {
    // 제목은 필수항목이 아니다. 오탈자 하나에 지원자가 재동의하면 안 된다.
    expect(
      changedRequiredFields(BEFORE, {
        title: '새 제목',
      } as Partial<RequiredFieldValues>),
    ).toEqual([]);
  });

  it('should list every field that changed at once', () => {
    expect(
      changedRequiredFields(BEFORE, {
        headcount: 5,
        rewardPerPerson: 60_000,
      }),
    ).toEqual(['headcount', 'rewardPerPerson']);
  });
});

describe('describeRequiredChanges', () => {
  // AC4. 알림만 보고 무엇이 바뀌었는지 알 수 있어야 한다.
  it('should name the changed required fields in Korean when the reward and the start time changed', () => {
    expect(describeRequiredChanges(['workStartAt', 'rewardPerPerson'])).toBe(
      '바뀐 항목: 근무 시작 시각, 보상금. 계속 참여할지 확인해 주세요.',
    );
  });

  // 들어온 순서가 아니라 선언 순서다. 같은 수정이 사람마다 다른 문장으로
  // 보이면 문의를 대조할 수 없다.
  it('should keep the declared field order when several required fields changed at once', () => {
    expect(
      describeRequiredChanges(['requiredDescription', 'workAddress']),
    ).toBe('바뀐 항목: 근무 주소, 상세 내용. 계속 참여할지 확인해 주세요.');
  });
});

describe('canTransition', () => {
  // #38이 만드는 회귀를 #38이 막는다. 미달인 채로 시작 시각이 지나면 공고는
  // EXPIRED가 되는데, 수락자가 한 명이라도 있으면 그 사람은 일을 하고 대금을
  // 받아야 한다. 완료 확인(#23)이 EXPIRED에서 막히면 그 돈이 갇힌다.
  it('should allow EXPIRED to COMPLETED so accepted workers can still be paid', () => {
    expect(canTransition('EXPIRED', 'COMPLETED')).toBe(true);
  });
});
