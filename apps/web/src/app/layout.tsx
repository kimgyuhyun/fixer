import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'fixer',
  description: '동네 일거리 중개',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
