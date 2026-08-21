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

    // Dashboard
    welcomeName: 'Welcome, {name}',
    dashboardSubtitle:
      'Governed clinical knowledge — every answer traceable to an approved document.',
    kbHealth: 'Knowledge base health',
    kbHealthDesc: 'What needs your attention right now',
    docsAwaitingReview: 'Documents awaiting review',
    approachingExpiry: 'Approaching expiry (30 days)',
    expiredNotAnswerable: 'Expired — no longer answerable',
    openWorkflow: 'Open workflow',
    reviewDocuments: 'Review documents',
    clear: 'Clear',
    activeDocuments: 'Active documents',
    questionsAsked: 'Questions asked',
    refusalRate: 'Refusal rate',
    refusalRateHint: 'Questions with no approved source',
    auditEvents: 'Audit events',
    goTo: 'Go to',
    assistantDesc: 'Cited answers from approved documents',
    drugPrepDesc: 'Medication-scoped assistant',
    doseCalculatorDesc: 'Pharmacist-approved formulas only',
    policiesDesc: 'Browse the approved knowledge base',
    governanceGuarantee: 'Governance guarantee',
    governanceGuaranteeBody:
      'The assistant answers only from approved, indexed, non-expired documents. When no approved source qualifies it returns exactly:',

    // Policies library
    policiesTitle: 'Policies Library',
    policiesSubtitle: 'Approved, active documents currently feeding the assistant.',
    category: 'Category',
    allCategories: 'All categories',
    searchTitlePlaceholder: 'Search title…',
    loadingDocuments: 'Loading documents',
    noDocumentsMatch: 'No documents match',
    noActiveDocuments: 'No active documents',
    noDocumentsMatchDesc:
      'Try another category, or clear the search to see the whole active library.',
    noActiveDocumentsDesc:
      'Nothing has completed approval and indexing yet. Until a document is ACTIVE the assistant will refuse every question in its area.',
    colTitle: 'Title',
    colStatus: 'Status',
    colVersion: 'Ver',
    colApproved: 'Approved',
    colExpires: 'Expires',
    download: 'Download',
    documentsNoun: 'documents',

    // Audit
    auditTitle: 'Audit Logs',
    auditSubtitle:
      'Every login, question, answer, document action and permission change.',
    action: 'Action',
    actionHint: 'e.g. AI:ANSWER_REFUSED',
    filterByAction: 'Filter by action',
    actor: 'Actor',
    actorHint: 'Email address',
    filterByActor: 'Filter by actor',
    loadingAuditEvents: 'Loading audit events',
    colTime: 'Time',
    colActor: 'Actor',
    colAction: 'Action',
    colResource: 'Resource',
    colDetails: 'Details',
    eventsNoun: 'events',

    noEventsMatch: 'No events match these filters',
    noAuditEvents: 'No audit events yet',
    noEventsMatchDesc:
      'Try a broader action prefix such as AI: or DOC:, or clear the actor filter.',
    noAuditEventsDesc:
      'Events appear here as soon as users sign in, ask questions or act on documents.',
    systemActor: 'system',

    // Assistant screens
    assistantTitle: 'AI Nursing Assistant',
    assistantSubtitle:
      'Ask about policies, procedures, protocols and medications — answers cite approved documents only.',
    assistantPlaceholder:
      'e.g. How long should I rub my hands with alcohol-based hand rub?',
    drugPrepTitle: 'Drug Preparation Assistant',
    drugPrepSubtitle: 'Retrieval is restricted to approved medication documents.',
    drugPrepPlaceholder:
      'e.g. How do I prepare IV paracetamol for a dose below 1000 mg?',

    // CBAHI search
    cbahiTitle: 'CBAHI Standards Search',
    cbahiSubtitle: 'Semantic search across approved CBAHI accreditation documents.',
    cbahiSearchLabel: 'Search CBAHI standards',
    cbahiPlaceholder: 'e.g. high-alert medications double check requirements',
    searchFailed: 'Search failed',
    searchingCbahi: 'Searching approved CBAHI documents',
    cbahiEmptyTitle: 'Search the accreditation library',
    cbahiEmptyDesc:
      'Results are drawn only from CBAHI documents that have been approved, indexed and are not expired. Each result shows its source document, page and approval date.',
    cbahiNoMatchTitle: 'No approved CBAHI content matches',
    cbahiNoMatchDesc:
      'Nothing in the approved library covers \u201C{term}\u201D. Try different wording, or ask the accreditation team to publish the relevant standard.',
    pageAbbrev: 'p.',
    approvedOn: 'approved {date}',
    percentRelevance: '{percent}% relevance',

    // Assistant chat
    noApprovedSource: 'No approved source',
    refusalExplanation:
      'No approved, indexed, non-expired document supports an answer here. The assistant refuses rather than guessing — escalate to the responsible supervisor.',
    whyRefused: 'Why was this refused?',
    closestTextConsidered: 'Closest text considered',
    warningsLabel: 'Warnings',
    approvedSources: 'Approved sources',
    confidence: 'Confidence',
    searchingApprovedDocs: 'Searching approved documents…',
    askClinicalQuestion: 'Ask a clinical question',
    askClinicalQuestionDesc:
      'Answers are drawn only from approved, indexed, non-expired hospital documents and always cite their source. If no approved document covers your question, the assistant will say so rather than guess.',
    couldNotReachAssistant: 'Could not reach the assistant',
    yourQuestion: 'Your question',
    ask: 'Ask',

    // Dose calculator
    doseCalculatorTitle: 'Dose Calculator',
    doseCalculatorSubtitle: 'Only formulas approved by a Pharmacist Reviewer can be used.',
    noApprovedFormulas: 'No approved formulas yet',
    noApprovedFormulasDesc:
      'A Pharmacist Reviewer must approve a dose formula before it can be used for calculation. Ask your pharmacy team to publish one.',
    approvedFormula: 'Approved formula',
    weightKg: 'Weight (kg)',
    weightInvalid: 'Enter a weight greater than 0',
    ageYears: 'Age (years)',
    optional: 'Optional',
    concentrationMgMl: 'Concentration (mg/mL)',
    concentrationHint: 'Needed to compute volume',
    prescribedDoseMg: 'Prescribed dose (mg)',
    prescribedDoseHint: 'Compared against the calculation',
    route: 'Route',
    formulaDefault: 'Formula default',
    frequencyPerDay: 'Frequency (per day)',
    calculateDose: 'Calculate dose',
    calculationSteps: 'Calculation steps',
    sourceLabel: 'Source:',
    noCalculationYet: 'No calculation yet',
    noCalculationYetDesc:
      'Pick an approved formula and enter the patient weight. The result will show the dose, the volume to administer, and every step used to reach it.',
    calculationFailed: 'Calculation failed',

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

    welcomeName: 'أهلاً بك، {name}',
    dashboardSubtitle:
      'معرفة سريرية محوكمة — كل إجابة تعود إلى وثيقة معتمدة.',
    kbHealth: 'حالة قاعدة المعرفة',
    kbHealthDesc: 'ما يحتاج انتباهك الآن',
    docsAwaitingReview: 'وثائق بانتظار المراجعة',
    approachingExpiry: 'تقترب من انتهاء الصلاحية (30 يوماً)',
    expiredNotAnswerable: 'منتهية الصلاحية — لم تعد قابلة للاستشهاد',
    openWorkflow: 'فتح المسار',
    reviewDocuments: 'مراجعة الوثائق',
    clear: 'لا شيء معلّق',
    activeDocuments: 'وثائق نشطة',
    questionsAsked: 'الأسئلة المطروحة',
    refusalRate: 'نسبة الرفض',
    refusalRateHint: 'أسئلة بلا مصدر معتمد',
    auditEvents: 'أحداث التدقيق',
    goTo: 'انتقل إلى',
    assistantDesc: 'إجابات موثّقة من وثائق معتمدة',
    drugPrepDesc: 'مساعد مخصّص للأدوية',
    doseCalculatorDesc: 'معادلات معتمدة من الصيدلي فقط',
    policiesDesc: 'تصفّح قاعدة المعرفة المعتمدة',
    governanceGuarantee: 'ضمان الحوكمة',
    governanceGuaranteeBody:
      'يجيب المساعد فقط من وثائق معتمدة ومفهرسة وسارية. وعندما لا يوجد مصدر معتمد مؤهل، يعيد حرفياً:',

    policiesTitle: 'مكتبة السياسات',
    policiesSubtitle: 'الوثائق المعتمدة والنشطة التي يستند إليها المساعد حالياً.',
    category: 'التصنيف',
    allCategories: 'كل التصنيفات',
    searchTitlePlaceholder: 'ابحث في العناوين…',
    loadingDocuments: 'جارٍ تحميل الوثائق',
    noDocumentsMatch: 'لا توجد وثائق مطابقة',
    noActiveDocuments: 'لا توجد وثائق نشطة',
    noDocumentsMatchDesc:
      'جرّب تصنيفاً آخر، أو امسح البحث لعرض المكتبة النشطة كاملة.',
    noActiveDocumentsDesc:
      'لم تكتمل بعد أي وثيقة في الاعتماد والفهرسة. وحتى تصبح الوثيقة نشطة، سيرفض المساعد كل سؤال في مجالها.',
    colTitle: 'العنوان',
    colStatus: 'الحالة',
    colVersion: 'الإصدار',
    colApproved: 'تاريخ الاعتماد',
    colExpires: 'تنتهي في',
    download: 'تنزيل',
    documentsNoun: 'وثيقة',

    auditTitle: 'سجلات التدقيق',
    auditSubtitle:
      'كل تسجيل دخول وسؤال وإجابة وإجراء على الوثائق وتغيير في الصلاحيات.',
    action: 'الإجراء',
    actionHint: 'مثال: AI:ANSWER_REFUSED',
    filterByAction: 'تصفية حسب الإجراء',
    actor: 'المنفّذ',
    actorHint: 'البريد الإلكتروني',
    filterByActor: 'تصفية حسب المنفّذ',
    loadingAuditEvents: 'جارٍ تحميل أحداث التدقيق',
    colTime: 'الوقت',
    colActor: 'المنفّذ',
    colAction: 'الإجراء',
    colResource: 'المورد',
    colDetails: 'التفاصيل',
    eventsNoun: 'حدث',

    noEventsMatch: 'لا توجد أحداث مطابقة لهذه التصفية',
    noAuditEvents: 'لا توجد أحداث تدقيق بعد',
    noEventsMatchDesc:
      'جرّب بادئة إجراء أوسع مثل ‎AI:‎ أو ‎DOC:‎، أو امسح تصفية المنفّذ.',
    noAuditEventsDesc:
      'تظهر الأحداث هنا فور تسجيل المستخدمين للدخول أو طرح الأسئلة أو التعامل مع الوثائق.',
    systemActor: 'النظام',

    assistantTitle: 'المساعد التمريضي الذكي',
    assistantSubtitle:
      'اسأل عن السياسات والإجراءات والبروتوكولات والأدوية — تستند الإجابات إلى وثائق معتمدة فقط.',
    assistantPlaceholder: 'مثال: كم مدة فرك اليدين بالمطهر الكحولي؟',
    drugPrepTitle: 'مساعد تحضير الأدوية',
    drugPrepSubtitle: 'الاسترجاع مقتصر على وثائق الأدوية المعتمدة.',
    drugPrepPlaceholder:
      'مثال: كيف أحضّر الباراسيتامول الوريدي لجرعة أقل من 1000 مجم؟',

    cbahiTitle: 'البحث في معايير سباهي',
    cbahiSubtitle: 'بحث دلالي في وثائق اعتماد سباهي المعتمدة.',
    cbahiSearchLabel: 'ابحث في معايير سباهي',
    cbahiPlaceholder: 'مثال: متطلبات التحقق المزدوج للأدوية عالية الخطورة',
    searchFailed: 'فشل البحث',
    searchingCbahi: 'جارٍ البحث في وثائق سباهي المعتمدة',
    cbahiEmptyTitle: 'ابحث في مكتبة الاعتماد',
    cbahiEmptyDesc:
      'تُستمد النتائج فقط من وثائق سباهي المعتمدة والمفهرسة وغير المنتهية. وتعرض كل نتيجة وثيقتها المصدر والصفحة وتاريخ الاعتماد.',
    cbahiNoMatchTitle: 'لا يوجد محتوى سباهي معتمد مطابق',
    cbahiNoMatchDesc:
      'لا شيء في المكتبة المعتمدة يغطي \u201C{term}\u201D. جرّب صياغة مختلفة، أو اطلب من فريق الاعتماد نشر المعيار المعني.',
    pageAbbrev: 'ص',
    approvedOn: 'اعتُمدت {date}',
    percentRelevance: 'الصلة {percent}%',

    noApprovedSource: 'لا يوجد مصدر معتمد',
    refusalExplanation:
      'لا توجد وثيقة معتمدة ومفهرسة وسارية تدعم إجابة هنا. يرفض المساعد بدلاً من التخمين — يُرجى التصعيد إلى المشرف المسؤول.',
    whyRefused: 'لماذا رُفض هذا؟',
    closestTextConsidered: 'أقرب نص جرى النظر فيه',
    warningsLabel: 'تنبيهات',
    approvedSources: 'المصادر المعتمدة',
    confidence: 'الثقة',
    searchingApprovedDocs: 'جارٍ البحث في الوثائق المعتمدة…',
    askClinicalQuestion: 'اطرح سؤالاً سريرياً',
    askClinicalQuestionDesc:
      'تُستمد الإجابات فقط من وثائق المستشفى المعتمدة والمفهرسة والسارية، وتستشهد دائماً بمصدرها. وإذا لم تغطِّ أي وثيقة معتمدة سؤالك، سيقول المساعد ذلك بدلاً من التخمين.',
    couldNotReachAssistant: 'تعذّر الوصول إلى المساعد',
    yourQuestion: 'سؤالك',
    ask: 'اسأل',

    doseCalculatorTitle: 'حاسبة الجرعات',
    doseCalculatorSubtitle: 'لا يمكن استخدام إلا المعادلات المعتمدة من صيدلي مراجع.',
    noApprovedFormulas: 'لا توجد معادلات معتمدة بعد',
    noApprovedFormulasDesc:
      'يجب أن يعتمد صيدلي مراجع معادلة الجرعة قبل استخدامها في الحساب. اطلب من فريق الصيدلة نشر واحدة.',
    approvedFormula: 'معادلة معتمدة',
    weightKg: 'الوزن (كجم)',
    weightInvalid: 'أدخل وزناً أكبر من 0',
    ageYears: 'العمر (سنوات)',
    optional: 'اختياري',
    concentrationMgMl: 'التركيز (مجم/مل)',
    concentrationHint: 'مطلوب لحساب الحجم',
    prescribedDoseMg: 'الجرعة الموصوفة (مجم)',
    prescribedDoseHint: 'تُقارن بنتيجة الحساب',
    route: 'طريق الإعطاء',
    formulaDefault: 'الافتراضي للمعادلة',
    frequencyPerDay: 'التكرار (يومياً)',
    calculateDose: 'احسب الجرعة',
    calculationSteps: 'خطوات الحساب',
    sourceLabel: 'المصدر:',
    noCalculationYet: 'لا يوجد حساب بعد',
    noCalculationYetDesc:
      'اختر معادلة معتمدة وأدخل وزن المريض. ستُظهر النتيجة الجرعة والحجم المطلوب إعطاؤه وكل خطوة أدّت إليها.',
    calculationFailed: 'فشل الحساب',

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

export type Params = Record<string, string | number>;

/**
 * Translate a key, optionally filling `{name}`-style placeholders.
 *
 * Interpolation rather than string concatenation because word order differs
 * between the two languages — "Welcome, {name}" and "{name} أهلاً بك يا" put the
 * name in different places, which splicing fragments together cannot express.
 * An unknown placeholder is left visible rather than silently blanked, so a
 * typo shows up instead of producing a sentence with a hole in it.
 */
export function t(lang: Lang, key: Key, params?: Params): string {
  const value: string = dict[lang][key];
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (whole, name) =>
    name in params ? String(params[name]) : whole,
  );
}

/** True when the active language lays out right-to-left. */
export function isRtl(lang: Lang): boolean {
  return lang === 'ar';
}

export function dirFor(lang: Lang): 'rtl' | 'ltr' {
  return isRtl(lang) ? 'rtl' : 'ltr';
}

/**
 * BCP-47 tag for Intl formatting.
 *
 * Arabic pins the `latn` numbering system on purpose. Arabic locales default to
 * Eastern Arabic-Indic digits (٠١٢٣…), which are correct for prose but a poor
 * fit here: this app renders dose figures, version numbers, page citations and
 * audit timestamps that clinicians cross-check against English source PDFs and
 * external systems. Keeping the digits Latin makes those directly comparable
 * while month names, ordering and separators still localise.
 */
export function localeTag(lang: Lang): string {
  return lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
}

export function formatDateTime(lang: Lang, iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(localeTag(lang));
}
