/** 가입 단계. 1 이메일 인증 · 2 계정 · 3 주소 · 4 동의서 (spec-fixed §2.2) */
interface SignupStepsProps {
  current: 1 | 2 | 3 | 4;
}

/**
 * 가입 화면 상단의 단계 표시. (#82)
 *
 * "2/4"를 글자로 보여주고 현재 단계에 `aria-current="step"`을 단다.
 */
export function SignupSteps(_props: SignupStepsProps): React.ReactElement {
  throw new Error('not implemented');
}
