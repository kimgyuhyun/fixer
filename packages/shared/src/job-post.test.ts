import { describe, expect, it } from 'vitest';
import {
  JOB_POST_REQUIRED_FIELDS,
  changedRequiredFields,
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
