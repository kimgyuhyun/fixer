import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SignupSteps } from './SignupSteps';

/** aria-current="step"이 달린 단계들의 이름 */
function currentSteps(): string[] {
  return screen
    .getAllByRole('listitem')
    .filter((item) => item.getAttribute('aria-current') === 'step')
    .map((item) => item.textContent ?? '');
}

describe('SignupSteps', () => {
  it('should show "2/4" and mark only the second step with aria-current="step" when current is 2', () => {
    render(<SignupSteps current={2} />);

    expect({
      counter: screen.queryByText('2/4') !== null,
      current: currentSteps(),
    }).toEqual({ counter: true, current: ['계정'] });
  });

  it('should show "1/4" and mark the first step when current is 1', () => {
    render(<SignupSteps current={1} />);

    expect({
      counter: screen.queryByText('1/4') !== null,
      current: currentSteps(),
    }).toEqual({ counter: true, current: ['이메일 인증'] });
  });

  it('should show "4/4" and mark the last step when current is 4', () => {
    render(<SignupSteps current={4} />);

    expect({
      counter: screen.queryByText('4/4') !== null,
      current: currentSteps(),
    }).toEqual({ counter: true, current: ['동의서'] });
  });
});
