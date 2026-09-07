import { describe, expect, it } from 'vitest';
import {
  APPLICATION_TRANSITIONS,
  EMPLOYER_VISIBLE_STATUSES,
  REACCEPT_TARGET_STATUSES,
  canApplicationTransition,
  formatRating,
  FREE_CANCEL_WINDOW_MS,
  hasWorkStarted,
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

describe('hasWorkStarted', () => {
  const WORK_START_AT = new Date('2026-09-10T09:00:00.000Z');

  function offset(ms: number): Date {
    return new Date(WORK_START_AT.getTime() + ms);
  }

  it('should return true when the work start time has already passed', () => {
    expect(hasWorkStarted(WORK_START_AT, offset(60 * 60 * 1000))).toBe(true);
  });

  // **경계는 열려 있다.** AC3이 막는 것은 "근무 시작 **전**"이고 정각은 그
  // 전이 아니다. 닫아 두면 정각에 안 나온 사람을 그 순간에 기록할 수 없다.
  it('should return true when now is exactly the work start time', () => {
    expect(hasWorkStarted(WORK_START_AT, WORK_START_AT)).toBe(true);
  });

  it('should return false when now is one millisecond before the work start time', () => {
    expect(hasWorkStarted(WORK_START_AT, offset(-1))).toBe(false);
  });
});

describe('EMPLOYER_VISIBLE_STATUSES', () => {
  // AC5. 재동의 대기가 되면 목록에서 사라지는 것이 곧 '삭제된 것처럼 보이는
  // 것'이다. 구인자는 그 사람이 왜 빠졌는지 화면에서 알 수 없게 된다.
  it('should contain PENDING_REACCEPT so a demoted application stays visible to the employer', () => {
    expect([...EMPLOYER_VISIBLE_STATUSES] as string[]).toContain(
      'PENDING_REACCEPT',
    );
  });
});

describe('REACCEPT_TARGET_STATUSES', () => {
  // 전환 대상과 전이표가 갈리면 **표에 없는 전이가 저장소에서 조용히
  // 일어난다.** 둘을 한 문장으로 묶어 둔다.
  it('should be exactly the statuses the transition table allows into PENDING_REACCEPT', () => {
    const allowed = APPLICATION_TRANSITIONS.filter(
      (t) => t.to === 'PENDING_REACCEPT',
    ).map((t) => t.from);

    expect([...REACCEPT_TARGET_STATUSES]).toEqual(allowed);
  });
});
