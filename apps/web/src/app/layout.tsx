import type { Metadata } from 'next';
import NotificationBell from './NotificationBell';
import './globals.css';
import styles from './layout.module.css';

export const metadata: Metadata = {
  title: 'fixer',
  description: '동네 일거리 중개',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko">
      <body>
        {/*
          벨을 여기 두는 이유는 AC1이 "헤더에 미읽음 수"를 요구하기 때문이다.
          화면마다 붙이면 새 화면을 만들 때마다 빠뜨린다 — 미들웨어를 한
          곳에 둔 것(#5)과 같은 이유다.
        */}
        <header className={styles.header}>
          <NotificationBell />
        </header>
        {children}
      </body>
    </html>
  );
}
