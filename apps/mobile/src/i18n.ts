/**
 * Arabic-first bilingual dictionary for the mobile app.
 *
 * The Figma design is Arabic/RTL with an "EN / عربي" toggle chip, so Arabic is
 * the default and English is the secondary locale. Layout direction is derived
 * from the active language rather than React Native's global `I18nManager`,
 * because flipping I18nManager requires an app restart on Android — a toggle
 * the user can see take effect immediately is worth the explicit `flexDirection`
 * handling in the screens.
 *
 * The two governed clinical strings are NEVER translated here: they come from
 * @bnp/shared and the API returns them verbatim.
 */

export type Lang = 'ar' | 'en';

export const dict = {
  ar: {
    // Login
    welcomeTo: 'مرحباً بك في',
    tagline: 'منصة حوكمة المعرفة والقرار',
    serverUrl: 'رابط الخادم',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    signIn: 'دخول',
    signingIn: 'جارٍ الدخول…',
    mfaCode: 'رمز التحقق',
    mfaHint: 'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة',
    verifyCode: 'تحقق من الرمز',
    lightMode: 'الوضع الفاتح',
    darkMode: 'الوضع الداكن',
    // Shell / nav
    home: 'الرئيسية',
    chat: 'المحادثة',
    doses: 'الجرعات',
    audit: 'التدقيق',
    sources: 'المصادر',
    signOut: 'خروج',
    back: 'رجوع',
    // Home
    signedInAs: 'مسجّل كـ',
    activeSession: 'جلسة JWT نشطة',
    decisions: 'قرارات',
    queries: 'استعلامات',
    documents: 'وثائق',
    refused: 'مرفوض',
    pharmaStandards: 'المعايير الصيدلانية',
    nursingPolicies: 'السياسات التمريضية',
    qualityStandards: 'معايير الجودة (سباهي)',
    doseCalculator: 'حاسبة الجرعات',
    // Chat
    askPlaceholder: 'اسأل عن دواء أو بروتوكول…',
    source: 'المصدر',
    page: 'ص',
    confidence: 'الثقة',
    approved: 'اعتُمدت',
    contextualRefusal: 'رفض سياقي — منع الهلوسة',
    closedLoop: 'مصادر معتمدة فقط',
    emptyChat: 'اطرح سؤالاً ليُجاب من الوثائق المعتمدة فقط.',
    // Audit
    auditLog: 'سجل التدقيق',
    all: 'الكل',
    entries: 'قيد',
    noEntries: 'لا توجد قيود.',
    // Dose
    weightKg: 'الوزن (كجم)',
    concentration: 'التركيز (مجم/مل)',
    calculate: 'احسب',
    selectFormula: 'اختر المعادلة',
    finalDose: 'الجرعة النهائية',
    volume: 'الحجم',
    steps: 'خطوات الحساب',
    // Sources
    searchDocs: 'ابحث في الوثائق المعتمدة…',
    // Generic
    loading: 'جارٍ التحميل…',
    retry: 'إعادة المحاولة',
    warnings: 'تنبيهات',
  },
  en: {
    welcomeTo: 'Welcome to',
    tagline: 'Knowledge Governance and Authorized Decision Platform',
    serverUrl: 'Server URL',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    mfaCode: 'Authentication code',
    mfaHint: 'Enter the 6-digit code from your authenticator app',
    verifyCode: 'Verify code',
    lightMode: 'Light mode',
    darkMode: 'Dark mode',
    home: 'Home',
    chat: 'Assistant',
    doses: 'Doses',
    audit: 'Audit',
    sources: 'Sources',
    signOut: 'Sign out',
    back: 'Back',
    signedInAs: 'Signed in as',
    activeSession: 'Active JWT session',
    decisions: 'Answers',
    queries: 'Questions',
    documents: 'Documents',
    refused: 'Refused',
    pharmaStandards: 'Medication Standards',
    nursingPolicies: 'Nursing Policies',
    qualityStandards: 'CBAHI Quality Standards',
    doseCalculator: 'Dose Calculator',
    askPlaceholder: 'Ask about a medication or protocol…',
    source: 'Source',
    page: 'p.',
    confidence: 'Confidence',
    approved: 'approved',
    contextualRefusal: 'Contextual refusal — hallucination prevented',
    closedLoop: 'Approved sources only',
    emptyChat: 'Ask a question — answered only from approved documents.',
    auditLog: 'Audit Log',
    all: 'All',
    entries: 'entries',
    noEntries: 'No entries.',
    weightKg: 'Weight (kg)',
    concentration: 'Concentration (mg/mL)',
    calculate: 'Calculate',
    selectFormula: 'Select formula',
    finalDose: 'Final dose',
    volume: 'Volume',
    steps: 'Calculation steps',
    searchDocs: 'Search approved documents…',
    loading: 'Loading…',
    retry: 'Retry',
    warnings: 'Warnings',
  },
} as const;

export type Key = keyof (typeof dict)['ar'];

export function t(lang: Lang, key: Key): string {
  return dict[lang][key];
}

/** True when the active language lays out right-to-left. */
export function isRtl(lang: Lang): boolean {
  return lang === 'ar';
}

/** `row-reverse` under RTL so Figma's right-anchored rows read correctly. */
export function row(lang: Lang): 'row' | 'row-reverse' {
  return isRtl(lang) ? 'row-reverse' : 'row';
}

/** Text alignment matching the active writing direction. */
export function align(lang: Lang): 'left' | 'right' {
  return isRtl(lang) ? 'right' : 'left';
}

/**
 * Alignment for text whose language is decided by its *content*, not by the
 * interface language — assistant answers above all: the model replies in the
 * language of the question, so a nurse can browse an English UI and receive
 * an Arabic answer. Aligning that by interface language renders clinical text
 * against its own reading direction.
 *
 * Matches on the first strong directional character, mirroring the HTML
 * `dir="auto"` rule, so leading digits or punctuation do not decide it.
 */
export function alignFor(text: string, fallback: Lang): 'left' | 'right' {
  const strong = text.match(/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Latin}]/u);
  if (!strong) return align(fallback);
  return /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(strong[0]) ? 'right' : 'left';
}
