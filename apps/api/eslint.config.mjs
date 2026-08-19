// @ts-check
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },
  // Prettier는 ESLint 밖에서 독립 실행한다(루트 `pnpm format`). eslint-plugin-prettier처럼
  // 린터 안에서 돌리면 포맷 오류가 린트 에러로 섞여 나오고 린트가 느려진다.
  // eslint-config-prettier는 규칙을 끄기만 하므로 반드시 마지막에 온다.
  eslintConfigPrettier,
);
