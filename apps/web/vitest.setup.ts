import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// 테스트 사이에 DOM을 비운다. 안 비우면 앞 테스트가 남긴 요소를
// 다음 테스트의 쿼리가 잡아서 "왜 두 개가 나오지" 같은 오류가 난다.
afterEach(() => {
  cleanup();
});
