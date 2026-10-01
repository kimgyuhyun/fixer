import styles from './SignupSteps.module.css';

/** 가입 단계. 1 이메일 인증 · 2 계정 · 3 주소 · 4 동의서 (spec-fixed §2.2) */
interface SignupStepsProps {
  current: 1 | 2 | 3 | 4;
}

const STEPS = ['이메일 인증', '계정', '주소', '동의서'] as const;

/**
 * 가입 화면 상단의 단계 표시. (#82)
 *
 * "2/4"를 글자로 보여주고 현재 단계에 `aria-current="step"`을 단다.
 * 화면이 넷으로 나뉘어 있어도 하나의 흐름이라는 것을 여기서 말한다.
 */
export function SignupSteps({ current }: SignupStepsProps) {
  return (
    <nav className={styles.steps} aria-label="가입 단계">
      <p className={styles.counter}>
        {current}/{STEPS.length}
      </p>
      <ol className={styles.list}>
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={index + 1 === current ? styles.current : styles.step}
            aria-current={index + 1 === current ? 'step' : undefined}
          >
            {label}
          </li>
        ))}
      </ol>
    </nav>
  );
}
