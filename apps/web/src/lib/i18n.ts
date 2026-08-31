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

    // Users & roles
    usersTitle: 'Users & Roles',
    usersSubtitle:
      'Role changes are fully audited. Disabling a user revokes their outstanding sessions.',
    loadingUsers: 'Loading users',
    noUsersYet: 'No users yet',
    noUsersYetDesc:
      'Seed the demo data or create the first account with the form beside this list.',
    colName: 'Name',
    colEmail: 'Email',
    colRoles: 'Roles',
    colLastLogin: 'Last login',
    addUser: 'Add user',
    fullName: 'Full name',
    atLeast8CharsHint: 'At least 8 characters',
    role: 'Role',
    roleHint: 'Determines which screens and actions they get',
    rolesSectionTitle: 'Roles',
    rolesSectionDesc: 'Permission sets defined by the platform',
    loadingRoles: 'Loading roles',

    // Upload
    uploadTitle: 'Upload Document',
    uploadSubtitle:
      'New documents start as DRAFT. They must pass review, approval and indexing before the assistant can cite them.',
    pdfFile: 'PDF file',
    titleLabel: 'Title',
    uploadTitlePlaceholder: 'e.g. Vancomycin administration protocol',
    descriptionLabel: 'Description',
    descriptionHint: 'Optional — helps reviewers understand scope',
    expiryDate: 'Expiry date',
    expiryHint: 'Expired documents stop being answerable',

    // Settings
    settingsTitle: 'Settings',
    settingsSubtitle:
      'Platform configuration. Values are JSON and every change is audited.',
    reindexLibrary: 'Reindex knowledge library',
    loadingSettings: 'Loading settings',
    noSettings: 'No settings defined',
    noSettingsDesc:
      'Platform settings are seeded on first run. If this list is empty, the seed step has not completed against this database.',
    saved: 'Saved',

    // Analytics
    analyticsTitle: 'Analytics',
    analyticsSubtitle: 'Knowledge-base health and assistant usage.',
    loadingAnalytics: 'Loading analytics',
    noAnalytics: 'No analytics available',
    noAnalyticsDesc:
      'The overview endpoint returned nothing. This usually means the database has not been seeded yet.',
    documentsByCategory: 'Documents by category',
    questionsLast14Days: 'Questions (last 14 days)',

    // Answer review
    answerReviewTitle: 'AI Answer Review',
    answerReviewSubtitle:
      'Scientific-committee sign-off on nurse-facing answers. Approve, or flag for follow-up.',
    reviewStatus: 'Review status',
    loadingAnswers: 'Loading answers',
    sourcesCited: 'Sources cited',
    approve: 'Approve',
    flagForFollowUp: 'Flag for follow-up',

    // Approvals workflow
    approvalsTitle: 'Document Approval Workflow',
    approvalsSubtitle:
      'DRAFT → IN REVIEW → APPROVED → INDEXED → ACTIVE. Only ACTIVE documents are retrievable by the assistant.',
    filterDocuments: 'Filter documents',
    submitForReview: 'Submit for review',
    reject: 'Reject',
    indexIntoAi: 'Index into AI',
    deactivate: 'Deactivate',
    whyRejecting: 'Why is this being rejected?',
    rejectionRecorded:
      'The reason is recorded in the approval history and shown to the uploader.',
    rejectionPlaceholder:
      'e.g. Dosing table on page 4 contradicts the current protocol',
    confirmRejection: 'Confirm rejection',
    approvalHistory: 'Approval history',
    loadingHistory: 'Loading history',
    noWorkflowEvents: 'No workflow events yet.',

    statusActive: 'Active',
    statusDisabled: 'Disabled',
    disableUser: 'Disable',
    enableUser: 'Enable',
    createUser: 'Create user',
    permissionsCount: '{count} permissions',
    kbGroupTitle: 'Knowledge base',
    kbGroupDesc: 'How much approved material the assistant can draw on',
    mActive: 'Active',
    mTotalUploaded: 'Total uploaded',
    mInReview: 'In review',
    mNearExpiry: 'Near expiry (30d)',
    mExpired: 'Expired',
    mApprovedFormulas: 'Approved formulas',
    usageGroupTitle: 'Assistant usage',
    usageGroupDesc: 'What nurses asked and what came back',
    mQuestionsAsked: 'Questions asked',
    mAnswered: 'Answered',
    mRefusedNoSource: 'Refused (no source)',
    mDoseCalculations: 'Dose calculations',
    govGroupTitle: 'Governance',
    govGroupDesc: 'Accounts and the audit trail',
    mActiveUsers: 'Active users',
    mAuditEvents: 'Audit events',

    noDocumentsUploaded: 'No documents have been uploaded yet.',
    noQuestionsRecently: 'No questions in the last 14 days.',
    noQuestionsYet: 'No questions asked yet.',

    // Account & security
    navAccount: 'Account',
    navSecurity: 'Security',
    navNotifications: 'Notifications',
    securityTitle: 'Security',
    securitySubtitle: 'Your sign-in protection for this account',
    signedInAs: 'Signed in as',
    mfaSectionTitle: 'Two-factor authentication (MFA)',
    mfaSectionDesc:
      'A 6-digit code from an authenticator app, required at every sign-in.',
    mfaStatusLabel: 'Status',
    mfaStatusEnabled: 'Enabled',
    mfaStatusDisabled: 'Not enabled',
    mfaDisabledDesc:
      'Protect your account: after enabling, signing in requires your password and a code from your authenticator app.',
    mfaEnabledDesc:
      'Two-factor authentication is active on this account. Disabling it removes the code step from sign-in.',
    mfaStartEnrolment: 'Enable two-factor authentication',
    mfaScanQr:
      'Scan this QR code with your authenticator app (Google Authenticator, Microsoft Authenticator, …), or enter the secret manually.',
    mfaQrAlt: 'QR code for your authenticator app',
    mfaSecretLabel: 'Manual entry secret',
    mfaSecretHint: 'Shown only once — it is not stored anywhere in the browser.',
    mfaEnterCodeToConfirm: 'Enter the 6-digit code from the app to confirm',
    mfaConfirmEnable: 'Confirm & enable',
    mfaEnableSuccess:
      'Two-factor authentication is now enabled. You will be asked for a code at every sign-in.',
    mfaDisableHint: 'Confirm with your account password.',
    mfaDisable: 'Disable two-factor authentication',
    mfaDisableSuccess: 'Two-factor authentication has been disabled.',

    // Notifications
    notificationsTitle: 'Notifications',
    notificationsSubtitle: 'Governance notices — document expiry and platform events',
    markRead: 'Mark as read',
    unreadLabel: 'Unread',
    noNotifications: 'No notifications',
    noNotificationsDesc: 'Expiry warnings and governance notices will appear here.',

    // Dose formula management
    formulaManageTitle: 'Formula management',
    formulaManageDesc:
      'Draft formulas are unusable in the calculator until a pharmacist approves them.',
    showAllFormulas: 'Show drafts and rejected',
    newFormula: 'New formula',
    formulaName: 'Formula name',
    drugName: 'Drug name',
    formulaTypeLabel: 'Formula type',
    dosePerKgLabel: 'Dose per kg',
    fixedDoseLabel: 'Fixed dose',
    maxSingleDoseLabel: 'Max single dose',
    maxDailyDoseLabel: 'Max daily dose',
    unitLabel: 'Unit',
    defaultRouteLabel: 'Default route',
    frequencyPerDayLabel: 'Frequency per day',
    notesLabel: 'Notes',
    createFormula: 'Create draft formula',
    formulaCreated: 'Draft formula created. It needs pharmacist approval before use.',
    approveFormulaBtn: 'Approve',
    formulaApproved: 'Formula approved — it is now available in the calculator.',
    statusDraft: 'Draft',
    statusApproved: 'Approved',
    statusRejected: 'Rejected',

    // Chat history
    myQuestions: 'My previous questions',
    myQuestionsDesc: 'Your recent questions and the answers or refusals they received.',
    showHistory: 'Show my questions',
    hideHistory: 'Hide my questions',
    refusedBadge: 'Refused',
    answeredBadge: 'Answered',
    noHistory: 'No questions yet',
    noHistoryDesc: 'Questions you ask the assistant will be listed here.',

    // Document versions
    versionHistory: 'Versions',
    versionLabel: 'Version',
    fileNameLabel: 'File',
    sizeLabel: 'Size',
    noVersions: 'No version records for this document.',

    // Settings — RAG operations
    providerCheckBtn: 'Check AI provider',
    providerCheckDesc:
      'Sends one probe embedding to verify the configured provider works, and reports corpus coverage.',
    providerCheckOk: 'Provider OK',
    providerCheckFailed: 'Provider check failed',
    reindexStaleBtn: 'Reindex stale documents',
    reindexStaleDesc:
      'Re-embeds only documents whose chunks were embedded by a different provider.',
    reindexStaleConfirm:
      'Re-embed only the documents with stale retrievable chunks? This may consume external API quota.',

    genericError: 'Something went wrong. Please try again.',

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

    usersTitle: 'المستخدمون والأدوار',
    usersSubtitle:
      'تُدقَّق تغييرات الأدوار بالكامل. وتعطيل المستخدم يُبطل جلساته القائمة.',
    loadingUsers: 'جارٍ تحميل المستخدمين',
    noUsersYet: 'لا يوجد مستخدمون بعد',
    noUsersYetDesc:
      'أضف بيانات العرض التجريبي أو أنشئ أول حساب من النموذج المجاور لهذه القائمة.',
    colName: 'الاسم',
    colEmail: 'البريد الإلكتروني',
    colRoles: 'الأدوار',
    colLastLogin: 'آخر دخول',
    addUser: 'إضافة مستخدم',
    fullName: 'الاسم الكامل',
    atLeast8CharsHint: '8 أحرف على الأقل',
    role: 'الدور',
    roleHint: 'يحدد الشاشات والإجراءات المتاحة له',
    rolesSectionTitle: 'الأدوار',
    rolesSectionDesc: 'مجموعات الصلاحيات المعرّفة في المنصّة',
    loadingRoles: 'جارٍ تحميل الأدوار',

    uploadTitle: 'رفع وثيقة',
    uploadSubtitle:
      'تبدأ الوثائق الجديدة كمسودة. ويجب أن تجتاز المراجعة والاعتماد والفهرسة قبل أن يتمكن المساعد من الاستشهاد بها.',
    pdfFile: 'ملف PDF',
    titleLabel: 'العنوان',
    uploadTitlePlaceholder: 'مثال: بروتوكول إعطاء الفانكومايسين',
    descriptionLabel: 'الوصف',
    descriptionHint: 'اختياري — يساعد المراجعين على فهم النطاق',
    expiryDate: 'تاريخ انتهاء الصلاحية',
    expiryHint: 'الوثائق المنتهية تتوقف عن كونها مصدراً للإجابات',

    settingsTitle: 'الإعدادات',
    settingsSubtitle:
      'إعدادات المنصّة. القيم بصيغة JSON وكل تغيير يُدقَّق.',
    reindexLibrary: 'إعادة فهرسة مكتبة المعرفة',
    loadingSettings: 'جارٍ تحميل الإعدادات',
    noSettings: 'لا توجد إعدادات معرّفة',
    noSettingsDesc:
      'تُزرع إعدادات المنصّة عند أول تشغيل. وإذا كانت هذه القائمة فارغة، فإن خطوة الزرع لم تكتمل على قاعدة البيانات هذه.',
    saved: 'حُفظ',

    analyticsTitle: 'التحليلات',
    analyticsSubtitle: 'حالة قاعدة المعرفة واستخدام المساعد.',
    loadingAnalytics: 'جارٍ تحميل التحليلات',
    noAnalytics: 'لا تتوفر تحليلات',
    noAnalyticsDesc:
      'لم تُرجع واجهة النظرة العامة أي بيانات. وغالباً ما يعني ذلك أن قاعدة البيانات لم تُزرع بعد.',
    documentsByCategory: 'الوثائق حسب التصنيف',
    questionsLast14Days: 'الأسئلة (آخر 14 يوماً)',

    answerReviewTitle: 'مراجعة إجابات الذكاء الاصطناعي',
    answerReviewSubtitle:
      'اعتماد اللجنة العلمية للإجابات الموجّهة للممرضين. اعتمد، أو ضع علامة للمتابعة.',
    reviewStatus: 'حالة المراجعة',
    loadingAnswers: 'جارٍ تحميل الإجابات',
    sourcesCited: 'المصادر المستشهد بها',
    approve: 'اعتماد',
    flagForFollowUp: 'وضع علامة للمتابعة',

    approvalsTitle: 'مسار اعتماد الوثائق',
    approvalsSubtitle:
      'مسودة ← قيد المراجعة ← معتمدة ← مفهرسة ← نشطة. الوثائق النشطة وحدها قابلة للاسترجاع من المساعد.',
    filterDocuments: 'تصفية الوثائق',
    submitForReview: 'إرسال للمراجعة',
    reject: 'رفض',
    indexIntoAi: 'فهرسة في الذكاء الاصطناعي',
    deactivate: 'إلغاء التنشيط',
    whyRejecting: 'ما سبب الرفض؟',
    rejectionRecorded:
      'يُسجَّل السبب في سجل الاعتماد ويُعرض على من رفع الوثيقة.',
    rejectionPlaceholder:
      'مثال: جدول الجرعات في الصفحة 4 يتعارض مع البروتوكول الحالي',
    confirmRejection: 'تأكيد الرفض',
    approvalHistory: 'سجل الاعتماد',
    loadingHistory: 'جارٍ تحميل السجل',
    noWorkflowEvents: 'لا توجد أحداث في المسار بعد.',

    statusActive: 'نشط',
    statusDisabled: 'معطّل',
    disableUser: 'تعطيل',
    enableUser: 'تفعيل',
    createUser: 'إنشاء مستخدم',
    permissionsCount: '{count} صلاحية',
    kbGroupTitle: 'قاعدة المعرفة',
    kbGroupDesc: 'حجم المادة المعتمدة التي يستند إليها المساعد',
    mActive: 'نشطة',
    mTotalUploaded: 'إجمالي المرفوع',
    mInReview: 'قيد المراجعة',
    mNearExpiry: 'تقترب من الانتهاء (30 يوماً)',
    mExpired: 'منتهية',
    mApprovedFormulas: 'معادلات معتمدة',
    usageGroupTitle: 'استخدام المساعد',
    usageGroupDesc: 'ما سأله الممرضون وما عاد إليهم',
    mQuestionsAsked: 'الأسئلة المطروحة',
    mAnswered: 'أُجيب عنها',
    mRefusedNoSource: 'مرفوضة (لا مصدر)',
    mDoseCalculations: 'حسابات الجرعات',
    govGroupTitle: 'الحوكمة',
    govGroupDesc: 'الحسابات وسجل التدقيق',
    mActiveUsers: 'مستخدمون نشطون',
    mAuditEvents: 'أحداث التدقيق',

    noDocumentsUploaded: 'لم تُرفع أي وثائق بعد.',
    noQuestionsRecently: 'لا توجد أسئلة خلال آخر 14 يوماً.',
    noQuestionsYet: 'لم تُطرح أي أسئلة بعد.',

    navAccount: 'الحساب',
    navSecurity: 'الأمان',
    navNotifications: 'التنبيهات',
    securityTitle: 'الأمان',
    securitySubtitle: 'حماية تسجيل الدخول لحسابك',
    signedInAs: 'مسجّل الدخول باسم',
    mfaSectionTitle: 'المصادقة الثنائية (MFA)',
    mfaSectionDesc: 'رمز من 6 أرقام من تطبيق المصادقة، يُطلب عند كل تسجيل دخول.',
    mfaStatusLabel: 'الحالة',
    mfaStatusEnabled: 'مفعّلة',
    mfaStatusDisabled: 'غير مفعّلة',
    mfaDisabledDesc:
      'احمِ حسابك: بعد التفعيل يتطلب تسجيل الدخول كلمة المرور ورمزاً من تطبيق المصادقة.',
    mfaEnabledDesc:
      'المصادقة الثنائية مفعّلة على هذا الحساب. تعطيلها يزيل خطوة الرمز من تسجيل الدخول.',
    mfaStartEnrolment: 'تفعيل المصادقة الثنائية',
    mfaScanQr:
      'امسح رمز QR بتطبيق المصادقة (Google Authenticator أو Microsoft Authenticator…)، أو أدخل المفتاح يدوياً.',
    mfaQrAlt: 'رمز QR لتطبيق المصادقة',
    mfaSecretLabel: 'مفتاح الإدخال اليدوي',
    mfaSecretHint: 'يُعرض مرة واحدة فقط — لا يُخزَّن في المتصفح.',
    mfaEnterCodeToConfirm: 'أدخل الرمز المكوّن من 6 أرقام من التطبيق للتأكيد',
    mfaConfirmEnable: 'تأكيد وتفعيل',
    mfaEnableSuccess: 'فُعّلت المصادقة الثنائية. سيُطلب منك رمز عند كل تسجيل دخول.',
    mfaDisableHint: 'أكّد بكلمة مرور حسابك.',
    mfaDisable: 'تعطيل المصادقة الثنائية',
    mfaDisableSuccess: 'عُطّلت المصادقة الثنائية.',

    notificationsTitle: 'التنبيهات',
    notificationsSubtitle: 'إشعارات الحوكمة — انتهاء صلاحية الوثائق وأحداث المنصة',
    markRead: 'وضع علامة مقروء',
    unreadLabel: 'غير مقروء',
    noNotifications: 'لا توجد تنبيهات',
    noNotificationsDesc: 'ستظهر هنا تحذيرات انتهاء الصلاحية وإشعارات الحوكمة.',

    formulaManageTitle: 'إدارة الصيغ',
    formulaManageDesc:
      'الصيغ في حالة المسودة لا تُستخدم في الحاسبة حتى يعتمدها الصيدلي.',
    showAllFormulas: 'عرض المسودات والمرفوضة',
    newFormula: 'صيغة جديدة',
    formulaName: 'اسم الصيغة',
    drugName: 'اسم الدواء',
    formulaTypeLabel: 'نوع الصيغة',
    dosePerKgLabel: 'الجرعة لكل كغم',
    fixedDoseLabel: 'جرعة ثابتة',
    maxSingleDoseLabel: 'الحد الأقصى للجرعة الواحدة',
    maxDailyDoseLabel: 'الحد الأقصى اليومي',
    unitLabel: 'الوحدة',
    defaultRouteLabel: 'طريق الإعطاء الافتراضي',
    frequencyPerDayLabel: 'عدد المرات في اليوم',
    notesLabel: 'ملاحظات',
    createFormula: 'إنشاء مسودة صيغة',
    formulaCreated: 'أُنشئت مسودة الصيغة. تحتاج اعتماد الصيدلي قبل الاستخدام.',
    approveFormulaBtn: 'اعتماد',
    formulaApproved: 'اعتُمدت الصيغة — أصبحت متاحة في الحاسبة.',
    statusDraft: 'مسودة',
    statusApproved: 'معتمدة',
    statusRejected: 'مرفوضة',

    myQuestions: 'أسئلتي السابقة',
    myQuestionsDesc: 'أسئلتك الأخيرة وما تلقّته من إجابات أو رفض.',
    showHistory: 'عرض أسئلتي',
    hideHistory: 'إخفاء أسئلتي',
    refusedBadge: 'مرفوض',
    answeredBadge: 'مُجاب',
    noHistory: 'لا توجد أسئلة بعد',
    noHistoryDesc: 'ستُعرض هنا الأسئلة التي تطرحها على المساعد.',

    versionHistory: 'الإصدارات',
    versionLabel: 'الإصدار',
    fileNameLabel: 'الملف',
    sizeLabel: 'الحجم',
    noVersions: 'لا توجد سجلات إصدارات لهذه الوثيقة.',

    providerCheckBtn: 'فحص مزوّد الذكاء الاصطناعي',
    providerCheckDesc:
      'يرسل تضميناً تجريبياً واحداً للتحقق من عمل المزوّد المُهيّأ، ويعرض تغطية المكتبة.',
    providerCheckOk: 'المزوّد يعمل',
    providerCheckFailed: 'فشل فحص المزوّد',
    reindexStaleBtn: 'إعادة فهرسة الوثائق المتقادمة',
    reindexStaleDesc: 'يعيد تضمين الوثائق التي ضُمّنت بمزوّد مختلف فقط.',
    reindexStaleConfirm:
      'إعادة تضمين الوثائق ذات الأجزاء المتقادمة فقط؟ قد يستهلك ذلك حصة الواجهة الخارجية.',

    genericError: 'حدث خطأ ما. حاول مرة أخرى.',

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
