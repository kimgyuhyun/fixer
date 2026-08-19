/**
 * 히스토리가 이미 Conventional Commits라 지금 고정하면 이탈이 생기지 않는다.
 * config-conventional이 subject-full-stop(마침표 금지)까지 포함하므로
 * 이 저장소의 기존 관례가 그대로 규칙이 된다.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // config-conventional 기본값은 100자다. 이 저장소 관례인 72자로 좁힌다.
    'header-max-length': [2, 'always', 72],
  },
};
