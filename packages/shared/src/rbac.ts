export enum RoleName {
  SUPER_ADMIN = 'SUPER_ADMIN',
  HOSPITAL_ADMIN = 'HOSPITAL_ADMIN',
  NURSING_KNOWLEDGE_MANAGER = 'NURSING_KNOWLEDGE_MANAGER',
  PHARMACIST_REVIEWER = 'PHARMACIST_REVIEWER',
  CBAHI_QUALITY_OFFICER = 'CBAHI_QUALITY_OFFICER',
  NURSE_USER = 'NURSE_USER',
  AUDITOR = 'AUDITOR',
}

export enum Permission {
  // Users & roles
  USERS_READ = 'users:read',
  USERS_MANAGE = 'users:manage',
  ROLES_READ = 'roles:read',
  // No ROLES_MANAGE: role permissions are defined in this file, not at
  // runtime, so there is nothing for such a permission to authorize. See
  // ROLE_PERMISSIONS below and apps/api/src/roles/roles.controller.ts.
  // Documents
  DOCUMENTS_READ = 'documents:read',
  DOCUMENTS_UPLOAD = 'documents:upload',
  DOCUMENTS_MANAGE = 'documents:manage',
  DOCUMENTS_DOWNLOAD = 'documents:download',
  DOCUMENTS_SUBMIT_REVIEW = 'documents:submit-review',
  DOCUMENTS_APPROVE = 'documents:approve',
  DOCUMENTS_INDEX = 'documents:index',
  DOCUMENTS_DEACTIVATE = 'documents:deactivate',
  // AI
  AI_ASK = 'ai:ask',
  AI_SEARCH = 'ai:search',
  AI_REVIEW_ANSWERS = 'ai:review-answers',
  // Dose calculator
  DOSE_CALCULATE = 'dose:calculate',
  DOSE_FORMULAS_MANAGE = 'dose:formulas-manage',
  DOSE_FORMULAS_APPROVE = 'dose:formulas-approve',
  // Governance
  AUDIT_READ = 'audit:read',
  ANALYTICS_READ = 'analytics:read',
  SETTINGS_READ = 'settings:read',
  SETTINGS_MANAGE = 'settings:manage',
  NOTIFICATIONS_READ = 'notifications:read',
}

const ALL_PERMISSIONS = Object.values(Permission);

const CLINICAL_READ: Permission[] = [
  Permission.DOCUMENTS_READ,
  Permission.AI_ASK,
  Permission.AI_SEARCH,
  Permission.DOSE_CALCULATE,
  Permission.NOTIFICATIONS_READ,
];

/**
 * Central RBAC matrix — the SINGLE source of truth for what a role may do.
 *
 * PermissionsGuard authorizes against the permissions JwtStrategy derives from
 * this matrix via permissionsForRoles(); it never reads the database. The
 * matrix is also seeded into roles/role_permissions, but only so the UI can
 * display it — those rows are a projection, not an input. Editing them changes
 * nothing, which is why the roles API is read-only.
 *
 * Consequence worth knowing: a role created directly in the database grants no
 * permissions at all, because it has no entry here. Add roles here first.
 *
 * Note: DOCUMENTS_DOWNLOAD is deliberately withheld from NURSE_USER and
 * AUDITOR — nurses read answers with citations, they do not copy source PDFs.
 */
export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  [RoleName.SUPER_ADMIN]: ALL_PERMISSIONS,
  [RoleName.HOSPITAL_ADMIN]: [
    ...CLINICAL_READ,
    Permission.USERS_READ,
    Permission.USERS_MANAGE,
    Permission.ROLES_READ,
    Permission.DOCUMENTS_UPLOAD,
    Permission.DOCUMENTS_MANAGE,
    Permission.DOCUMENTS_DOWNLOAD,
    Permission.DOCUMENTS_SUBMIT_REVIEW,
    Permission.DOCUMENTS_DEACTIVATE,
    Permission.AUDIT_READ,
    Permission.ANALYTICS_READ,
    Permission.SETTINGS_READ,
    Permission.SETTINGS_MANAGE,
  ],
  [RoleName.NURSING_KNOWLEDGE_MANAGER]: [
    ...CLINICAL_READ,
    Permission.DOCUMENTS_UPLOAD,
    Permission.DOCUMENTS_MANAGE,
    Permission.DOCUMENTS_DOWNLOAD,
    Permission.DOCUMENTS_SUBMIT_REVIEW,
    Permission.DOCUMENTS_APPROVE,
    Permission.DOCUMENTS_INDEX,
    Permission.DOCUMENTS_DEACTIVATE,
    Permission.AI_REVIEW_ANSWERS,
    Permission.ANALYTICS_READ,
  ],
  [RoleName.PHARMACIST_REVIEWER]: [
    ...CLINICAL_READ,
    Permission.DOCUMENTS_DOWNLOAD,
    Permission.DOCUMENTS_APPROVE,
    Permission.DOSE_FORMULAS_MANAGE,
    Permission.DOSE_FORMULAS_APPROVE,
    Permission.AI_REVIEW_ANSWERS,
  ],
  [RoleName.CBAHI_QUALITY_OFFICER]: [
    ...CLINICAL_READ,
    Permission.DOCUMENTS_UPLOAD,
    Permission.DOCUMENTS_DOWNLOAD,
    Permission.DOCUMENTS_SUBMIT_REVIEW,
    Permission.DOCUMENTS_APPROVE,
    Permission.AI_REVIEW_ANSWERS,
    Permission.ANALYTICS_READ,
  ],
  [RoleName.NURSE_USER]: [...CLINICAL_READ],
  [RoleName.AUDITOR]: [
    Permission.DOCUMENTS_READ,
    Permission.AUDIT_READ,
    Permission.ANALYTICS_READ,
    Permission.NOTIFICATIONS_READ,
  ],
};

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  [RoleName.SUPER_ADMIN]: 'Full platform control across all hospitals',
  [RoleName.HOSPITAL_ADMIN]: 'Manages users, settings and documents for the hospital',
  [RoleName.NURSING_KNOWLEDGE_MANAGER]: 'Owns the nursing knowledge base and document lifecycle',
  [RoleName.PHARMACIST_REVIEWER]: 'Reviews medication documents and approves dose formulas',
  [RoleName.CBAHI_QUALITY_OFFICER]: 'Manages CBAHI standards and quality documents',
  [RoleName.NURSE_USER]: 'Asks the AI assistant and uses the dose calculator',
  [RoleName.AUDITOR]: 'Read-only access to audit logs and analytics',
};

export function permissionsForRoles(roles: string[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) {
    const perms = ROLE_PERMISSIONS[role as RoleName];
    if (perms) perms.forEach((p) => set.add(p));
  }
  return [...set];
}
