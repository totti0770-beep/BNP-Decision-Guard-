import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { LanguageProvider } from '@/lib/language';

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

/**
 * Same reasoning as THEME_INIT, and the reason <html> below carries no static
 * lang/dir: direction has to be right in the very first paint. Setting it only
 * from a React effect would render the whole shell LTR and flip it on
 * hydration — far more jarring for direction than for colour, since every
 * element moves.
 *
 * Defaults to English when nothing is stored, matching readStoredLang().
 */
const LANG_INIT = `
try {
  var l = localStorage.getItem('bnp.lang') === 'ar' ? 'ar' : 'en';
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
} catch (e) {
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // lang/dir are set by LANG_INIT before paint rather than hardcoded here,
    // so a stored Arabic preference is honoured on the very first render.
    <html suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <script dangerouslySetInnerHTML={{ __html: LANG_INIT }} />
      </head>
      <body>
        <LanguageProvider>
          <AuthProvider>{children}</AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
