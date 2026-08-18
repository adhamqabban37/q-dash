import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Q DASH — Cognitive Cockpit',
  description: 'Live cognitive operating system dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-q-bg text-q-text antialiased overflow-hidden h-screen">
        {children}
      </body>
    </html>
  );
}
