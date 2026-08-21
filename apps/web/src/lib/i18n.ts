/**
 * Bilingual dictionary for the web app.
 *
 * Mirrors `apps/mobile/src/i18n.ts` deliberately — same `dict` / `t()` /
 * `isRtl()` shape — so the two clients stay recognisably one system. Two
 * differences, both intentional:
 *
 * 1. **English is the default here; mobile is Arabic-first.** Mobile follows an
 *    Arabic/RTL Figma design. The web app is already live and in daily use, and
 *    its governance screens (audit, users, analytics) skew English-speaking, so
 *    English-default means nothing changes for a current user until they opt in.
 *    Both languages are one toggle away on either client.
 *
 * 2. **No `row()` / `align()` / `alignFor()` helpers.** Mobile needs them because
 *    React Native has no `dir`: it must compute `flexDirection` and `textAlign`
 *    per element. The browser does this natively — `dir="rtl"` on <html> flips
 *    layout, and `dir="auto"` picks direction from content. The screens already
 *    use `dir="auto"` on free text (assistant answers, which come back in the
 *    language of the question), so mobile's `alignFor()` has a native equivalent
 *    that needs no code.
 *
 * The two governed clinical strings are NEVER in this dictionary: they come from
 * `@bnp/shared` and the API returns them verbatim. Translating them here would
 * fork the safety contract the API tests assert on.
 */

export type Lang = 'en' | 'ar';

export const LANGS: Lang[] = ['en', 'ar'];

/** What the toggle shows for the *other* language, in that language. */
export const LANG_LABEL: Record<Lang, string> = {
  en: 'EN',
  ar: 'عربي',
};

export const dict = {
  en: {
    // Brand / shell
    appName: 'BNP Decision Guard',
    tagline: 'Governed clinical answers',
    loginTagline: 'Knowledge governance and authorized decision platform',
    skipToContent: 'Skip to content',
    mainNav: 'Main',
    openNav: 'Open navigation',
    closeNav: 'Close navigation',
    signOut: 'Sign out',

    // Nav groups
    navClinical: 'Clinical',
    navKnowledge: 'Knowledge',
    navGovernance: 'Governance',

    // Nav items
    navDashboard: 'Dashboard',
    navAssistant: 'Nursing Assistant',
    navDrugPrep: 'Drug Preparation',
    navDoseCalculator: 'Dose Calculator',
    navCbahi: 'CBAHI Standards',
    navPolicies: 'Policies Library',
    navUpload: 'Upload Document',
    navApprovals: 'Approval Workflow',
    navAnswerReview: 'Answer Review',
    navUsers: 'Users & Roles',
    navAudit: 'Audit Log',
    navAnalytics: 'Analytics',
    navSettings: 'Settings',

    // Login
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    mfaCode: 'Authentication code',
    mfaHint: '6-digit code from your authenticator app',
    verifyCode: 'Verify code',
    backToSignIn: 'Back to sign in',
    forgotPassword: 'Forgot password?',
    loginFailed: 'Login failed',

    // Forgot / reset password
    resetPassword: 'Reset password',
    resetIntroRequest:
      'Enter your email and we\u2019ll send you a reset link. Links are single-use and expire shortly.',
    resetIntroChoose:
      'Choose a new password. This link is single-use and expires shortly.',
    resetLinkSentHint:
      'If that account exists, a reset link is on its way. Check your inbox, then follow the link. It expires shortly.',
    sendResetLink: 'Send reset link',
    sendAgain: 'Send again',
    resetToken: 'Reset token',
    newPassword: 'New password',
    atLeast8Chars: 'At least 8 characters',
    setNewPassword: 'Set new password',
    passwordUpdated: 'Password updated. Every previous session has been signed out.',

    // Generic
    loading: 'Loading…',
    retry: 'Retry',
    cancel: 'Cancel',
    save: 'Save',
    search: 'Search',
    switchToArabic: 'التبديل إلى العربية',
    switchToEnglish: 'Switch to English',
  },

  ar: {
    appName: 'BNP Decision Guard',
    tagline: 'إجابات سريرية محوكمة',
    loginTagline: 'منصة حوكمة المعرفة والقرار المعتمد',
    skipToContent: 'تخطَّ إلى المحتوى',
    mainNav: 'التنقل الرئيسي',
    openNav: 'فتح التنقل',
    closeNav: 'إغلاق التنقل',
    signOut: 'تسجيل الخروج',

    navClinical: 'سريري',
    navKnowledge: 'المعرفة',
    navGovernance: 'الحوكمة',

    navDashboard: 'لوحة المعلومات',
    navAssistant: 'المساعد التمريضي',
    navDrugPrep: 'تحضير الأدوية',
    navDoseCalculator: 'حاسبة الجرعات',
    navCbahi: 'معايير سباهي',
    navPolicies: 'مكتبة السياسات',
    navUpload: 'رفع وثيقة',
    navApprovals: 'مسار الاعتماد',
    navAnswerReview: 'مراجعة الإجابات',
    navUsers: 'المستخدمون والأدوار',
    navAudit: 'سجل التدقيق',
    navAnalytics: 'التحليلات',
    navSettings: 'الإعدادات',

    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    signIn: 'تسجيل الدخول',
    mfaCode: 'رمز التحقق',
    mfaHint: 'الرمز المكوّن من 6 أرقام من تطبيق المصادقة',
    verifyCode: 'تحقق من الرمز',
    backToSignIn: 'العودة لتسجيل الدخول',
    forgotPassword: 'نسيت كلمة المرور؟',
    loginFailed: 'فشل تسجيل الدخول',

    resetPassword: 'إعادة تعيين كلمة المرور',
    resetIntroRequest:
      'أدخل بريدك الإلكتروني وسنرسل إليك رابط إعادة التعيين. يُستخدم الرابط مرة واحدة وتنتهي صلاحيته قريباً.',
    resetIntroChoose:
      'اختر كلمة مرور جديدة. يُستخدم هذا الرابط مرة واحدة وتنتهي صلاحيته قريباً.',
    resetLinkSentHint:
      'إذا كان الحساب موجوداً، فرابط إعادة التعيين في طريقه إليك. تفقّد بريدك ثم افتح الرابط. تنتهي صلاحيته قريباً.',
    sendResetLink: 'إرسال رابط إعادة التعيين',
    sendAgain: 'إرسال مرة أخرى',
    resetToken: 'رمز إعادة التعيين',
    newPassword: 'كلمة المرور الجديدة',
    atLeast8Chars: '8 أحرف على الأقل',
    setNewPassword: 'حفظ كلمة المرور',
    passwordUpdated: 'تم تحديث كلمة المرور. تم تسجيل الخروج من كل الجلسات السابقة.',

    loading: 'جارٍ التحميل…',
    retry: 'إعادة المحاولة',
    cancel: 'إلغاء',
    save: 'حفظ',
    search: 'بحث',
    switchToArabic: 'التبديل إلى العربية',
    switchToEnglish: 'Switch to English',
  },
} as const;

export type Key = keyof (typeof dict)['en'];

export function t(lang: Lang, key: Key): string {
  return dict[lang][key];
}

/** True when the active language lays out right-to-left. */
export function isRtl(lang: Lang): boolean {
  return lang === 'ar';
}

export function dirFor(lang: Lang): 'rtl' | 'ltr' {
  return isRtl(lang) ? 'rtl' : 'ltr';
}
