import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignaturePad } from './SignaturePad';

/**
 * 캔버스에 픽셀이 실제로 그려지는지는 보지 않는다 — jsdom에 canvas 2D
 * 구현이 없다. **"그렸다는 상태가 잡히는가"와 "지우기가 되돌리는가"** 까지가
 * 단위 테스트의 경계이고, 그림 자체는 E2E 몫이다.
 */
async function drawStroke(canvas: HTMLElement) {
  await userEvent.pointer([
    { target: canvas, keys: '[MouseLeft>]', coords: { x: 10, y: 10 } },
    { target: canvas, coords: { x: 40, y: 30 } },
    { target: canvas, keys: '[/MouseLeft]' },
  ]);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SignaturePad', () => {
  it('should mark itself signed after a pointer stroke', async () => {
    render(<SignaturePad onChange={vi.fn()} />);
    const canvas = screen.getByRole('img', { name: '서명' });

    await drawStroke(canvas);

    expect(canvas).toHaveAttribute('data-signed', 'true');
  });

  it('should clear the signed state when 지우기 is pressed', async () => {
    render(<SignaturePad onChange={vi.fn()} />);
    const canvas = screen.getByRole('img', { name: '서명' });
    await drawStroke(canvas);

    await userEvent.click(screen.getByRole('button', { name: '지우기' }));

    expect(canvas).toHaveAttribute('data-signed', 'false');
  });

  it('should report the drawn image to its parent on stroke end', async () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);

    await drawStroke(screen.getByRole('img', { name: '서명' }));

    // jsdom에는 toDataURL이 없어 null이 온다. 중요한 것은 **부모에게
    // 알렸다는 사실**이고, 실제 이미지는 E2E가 본다.
    expect(onChange).toHaveBeenCalled();
  });
});
