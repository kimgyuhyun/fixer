import { describe, expect, it } from 'vitest';
import {
  APPLICATION_TRANSITIONS,
  canApplicationTransition,
} from './application.js';

describe('canApplicationTransition', () => {
  it('should allow APPLIED to WITHDRAWN', () => {
    expect(canApplicationTransition('APPLIED', 'WITHDRAWN')).toBe(true);
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

describe('APPLICATION_TRANSITIONS', () => {
  // 표가 곧 사양이라, 표에 실린 줄은 전부 통과해야 한다. 한 줄을 지웠는데
  // 아무 테스트도 안 깨지면 그 줄은 처음부터 없어도 됐다는 뜻이다.
  it('should let every declared transition pass', () => {
    for (const { from, to } of APPLICATION_TRANSITIONS) {
      expect(canApplicationTransition(from, to)).toBe(true);
    }
  });
});
