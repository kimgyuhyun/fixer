import { describe, expect, it } from 'vitest';
import {
  APPLICATION_TRANSITIONS,
  canApplicationTransition,
  formatRating,
  FREE_CANCEL_WINDOW_MS,
  resolveCancelStatus,
} from './application.js';

describe('canApplicationTransition', () => {
  it('should allow APPLIED to WITHDRAWN', () => {
    expect(canApplicationTransition('APPLIED', 'WITHDRAWN')).toBe(true);
  });

  // #18 AC1. 수락이 계약 체결이고, 그 전이가 표에 있어야 일어날 수 있다.
  it('should allow APPLIED to ACCEPTED', () => {
    expect(canApplicationTransition('APPLIED', 'ACCEPTED')).toBe(true);
  });

  // #18 AC5의 서버 쪽 방어. 표에 없어야 중복 수락이 막힌다.
  it('should reject ACCEPTED to ACCEPTED', () => {
    expect(canApplicationTransition('ACCEPTED', 'ACCEPTED')).toBe(false);
  });

  // 재지원 (§4.2 개정). 잘못 눌러 철회한 사람이 다시 들어올 수 있어야 한다.
  it('should allow WITHDRAWN to APPLIED', () => {
    expect(canApplicationTransition('WITHDRAWN', 'APPLIED')).toBe(true);
  });

  // AC5. **표에 없다는 사실**이 곧 금지다. 취소는 #20이 따로 다룬다.
  it('should reject ACCEPTED to WITHDRAWN', () => {
    expect(canApplicationTransition('ACCEPTED', 'WITHDRAWN')).toBe(false);
  });
});

describe('formatRating', () => {
  it('should return the average when the sample count is 5', () => {
    expect(formatRating(4.2, 5)).toBe('4.2');
  });

  // 표본 3건이 경계다 (§7). 딱 3건이면 감추지 않는다.
  it('should return the average when the sample count is exactly 3', () => {
    expect(formatRating(4.5, 3)).toBe('4.5');
  });

  // 별 1개 받고 평점 1.0으로 낙인찍히는 것을 막는 규칙 (§7).
  it('should return 신규 when the sample count is exactly 2', () => {
    expect(formatRating(1, 2)).toBe('신규');
  });

  // 아직 아무도 별점을 안 줬다. 평균이 null이라 표시할 것 자체가 없다.
  it('should return 신규 when the sample count is 0', () => {
    expect(formatRating(null, 0)).toBe('신규');
  });
});

describe('APPLICATION_TRANSITIONS', () => {
  // 표가 곧 사양이라, 표에 실린 줄은 전부 통과해야 한다. 한 줄을 지웠는데
  // 아무 테스트도 안 깨지면 그 줄은 처음부터 없어도 됐다는 뜻이다.
  it('should let every declared transition pass', () => {
    for (const { from, to } of APPLICATION_TRANSITIONS) {
      expect(canApplicationTransition(from, to)).toBe(true);
    }
  });
});

describe('resolveCancelStatus', () => {
  const ACCEPTED_AT = new Date('2026-10-01T09:00:00.000Z');

  /** 수락 시각에서 `ms`만큼 지난 시각 */
  function after(ms: number): Date {
    return new Date(ACCEPTED_AT.getTime() + ms);
  }

  it('should return CANCELLED_FREE when 1 hour has passed since acceptance', () => {
    expect(resolveCancelStatus(ACCEPTED_AT, after(60 * 60 * 1000))).toBe(
      'CANCELLED_FREE',
    );
  });

  it('should return CANCELLED_PENALTY when 3 hours have passed since acceptance', () => {
    expect(resolveCancelStatus(ACCEPTED_AT, after(3 * 60 * 60 * 1000))).toBe(
      'CANCELLED_PENALTY',
    );
  });

  // **경계는 닫혀 있다** (§4.3). 여기서 열어 두면 정확히 2시간에 취소한
  // 사람에게 경고가 쌓인다 — "2시간 안에는 무상"이라고 안내해 놓고서.
  it('should return CANCELLED_FREE when exactly 2 hours have passed', () => {
    expect(resolveCancelStatus(ACCEPTED_AT, after(FREE_CANCEL_WINDOW_MS))).toBe(
      'CANCELLED_FREE',
    );
  });

  it('should return CANCELLED_PENALTY when 2 hours and 1 millisecond have passed', () => {
    expect(
      resolveCancelStatus(ACCEPTED_AT, after(FREE_CANCEL_WINDOW_MS + 1)),
    ).toBe('CANCELLED_PENALTY');
  });
});
