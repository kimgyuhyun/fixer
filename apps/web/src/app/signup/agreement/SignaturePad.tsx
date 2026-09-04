'use client';

import { useRef, useState } from 'react';
import styles from './page.module.css';

/**
 * 서명 캔버스. (이슈 #7 AC2)
 *
 * **캔버스는 고정 px다** (`spec-fixed.md` §12). rem/%로 두면 화면 폭에 따라
 * 크기가 달라져 서명이 PDF에서 어긋난 위치·비율로 박힌다. `devicePixelRatio`는
 * 선명하게 그리는 데만 쓰고, 밖으로 내보내는 PNG는 항상 논리 크기다.
 */
const WIDTH = 320;
const HEIGHT = 120;

type Props = {
  /** 획이 끝날 때마다 현재 그림을 base64 PNG로 알려준다. 비어 있으면 null */
  onChange: (signaturePngBase64: string | null) => void;
};

export function SignaturePad({ onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);

  /** 캔버스 좌표로 옮긴다. 캔버스가 고정 px라 배율 계산이 단순하다 */
  function pointOf(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pointOf(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pointOf(e);
    ctx.lineTo(x, y);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111111';
    ctx.stroke();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    setSigned(true);
    onChange(exportPng(canvasRef.current));
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, WIDTH, HEIGHT);
    setSigned(false);
    onChange(null);
  }

  return (
    <div className={styles.field}>
      <span className={styles.label} id="signature-label">
        서명
      </span>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        width={WIDTH}
        height={HEIGHT}
        aria-labelledby="signature-label"
        role="img"
        data-signed={signed}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <button className={styles.secondary} type="button" onClick={clear}>
        지우기
      </button>
    </div>
  );
}

/**
 * 캔버스를 base64 PNG로 뽑는다.
 *
 * jsdom에는 canvas 2D 구현이 없어 `toDataURL`이 없을 수 있다. 그때는 null을
 * 돌려준다 — 픽셀이 실제로 그려지는지는 E2E가 볼 몫이고, 여기서 터뜨리면
 * 화면 테스트가 canvas를 흉내 내게 된다.
 */
function exportPng(canvas: HTMLCanvasElement | null): string | null {
  if (typeof canvas?.toDataURL !== 'function') return null;

  // jsdom은 toDataURL을 **갖고 있지만 부르면 던진다**(canvas 구현이 없다).
  // 타입 검사만으로는 못 막으므로 잡는다. 여기서 터지면 서명이 끝났다는
  // 사실조차 부모에게 전해지지 않는다.
  try {
    const url = canvas.toDataURL('image/png');
    const comma = url.indexOf(',');
    return comma === -1 ? null : url.slice(comma + 1);
  } catch {
    return null;
  }
}
