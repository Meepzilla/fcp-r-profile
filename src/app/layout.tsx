import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FCP-R Profile',
  description:
    'Functional Communication Profile - Revised, as a local-only web app. Data stays on this device.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
