import { describe, expect, it } from 'vitest';
import {
  isSuspensionActive,
  penaltyWindowStart,
  shouldSuspend,
  suspensionEndAt,
} from './penalty.js';

const NOW = new Date('2026-09-08T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('penaltyWindowStart', () => {
  it('should return the moment 180 days before now', () => {
    expect(penaltyWindowStart(NOW).toISOString()).toBe(
      new Date(NOW.getTime() - 180 * DAY_MS).toISOString(),
    );
  });
});

describe('suspensionEndAt', () => {
  it('should end 5 days after the suspension starts', () => {
    expect(suspensionEndAt(NOW).toISOString()).toBe(
      new Date(NOW.getTime() + 5 * DAY_MS).toISOString(),
    );
  });
});

describe('shouldSuspend', () => {
  // 경계다. 4건까지는 경고가 쌓이기만 한다.
  it('should be false when only 4 penalties are inside the window', () => {
    expect(shouldSuspend(4)).toBe(false);
  });

  it('should be true when exactly 5 penalties are inside the window', () => {
    expect(shouldSuspend(5)).toBe(true);
  });
});

describe('isSuspensionActive', () => {
  const suspension = {
    endAt: new Date('2026-09-13T00:00:00.000Z'),
    releasedAt: null,
  };

  // §5.1의 부등호는 `endAt > now()`다. 정각이면 이미 끝난 것이다.
  it('should be false when now is exactly the end time', () => {
    expect(isSuspensionActive(suspension, suspension.endAt)).toBe(false);
  });

  it('should be true one millisecond before the end time', () => {
    expect(
      isSuspensionActive(suspension, new Date(suspension.endAt.getTime() - 1)),
    ).toBe(true);
  });

  // 관리자가 조기 해제하면(#33) 남은 기간과 무관하게 끝난 것이다 (§5.1).
  it('should be false when the suspension was released early', () => {
    expect(
      isSuspensionActive(
        { ...suspension, releasedAt: new Date('2026-09-09T00:00:00.000Z') },
        new Date('2026-09-10T00:00:00.000Z'),
      ),
    ).toBe(false);
  });
});
