import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'BNP Decision Guard',
  description:
    'Knowledge Governance and Authorized Decision Platform for nursing teams',
};

/**
 * Applies the stored (or OS) theme before first paint. Without this the page
 * renders light and then snaps to dark on hydration, and routes outside the
 * app shell — notably /login — would ignore the preference entirely.
 */
const THEME_INIT = `
try {
  var s = localStorage.getItem('bnp.theme');
  var d = s ? s === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  if (d) document.documentElement.classList.add('dark');
} catch (e) {}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
