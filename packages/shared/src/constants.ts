/**
 * Clinical safety strings. These are contractual: the API must return them
 * verbatim, and tests assert exact equality. Do not reword or translate.
 */
export const REFUSAL_MESSAGE_AR =
  'لا توجد وثيقة معتمدة كافية للإجابة. الرجاء الرجوع للمسؤول المختص.';

export const DOSE_SAFETY_WARNING_AR =
  'لا يعتمد هذا الحساب دون مراجعة سريرية من المختص.';

/**
 * Returned verbatim when the PHI screen rejects an input. Contractual in the
 * same way as the two strings above, and here for the same reason: the message
 * a nurse sees when the platform refuses their input is part of the clinical
 * contract, not a controller detail. It has to tell them what to remove — a
 * bare "invalid input" teaches nothing and invites a retry with the same data.
 */
export const PHI_REJECTION_MESSAGE_AR =
  'لا تُدخل بيانات تعريف المرضى. أعد صياغة السؤال دون رقم هوية أو رقم ملف أو تاريخ ميلاد أو رقم جوال أو اسم مريض.';

export const PLATFORM_NAME = 'BNP Decision Guard';
export enum DocumentCategory {
  MEDICATIONS = 'MEDICATIONS',
  NURSING_POLICIES = 'NURSING_POLICIES',
  CBAHI = 'CBAHI',
  PROCEDURES = 'PROCEDURES',
  PROTOCOLS = 'PROTOCOLS',
}

export enum DocumentStatus {
  DRAFT = 'DRAFT',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  INDEXED = 'INDEXED',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  INACTIVE = 'INACTIVE',
}

export enum ApprovalAction {
  SUBMIT_REVIEW = 'SUBMIT_REVIEW',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  INDEX = 'INDEX',
  ACTIVATE = 'ACTIVATE',
  DEACTIVATE = 'DEACTIVATE',
  EXPIRE = 'EXPIRE',
}

/**
 * Pre-activation conflict detection.
 *
 * A finding is something a deterministic check noticed in a document while it
 * sat in review. BLOCKING findings stop `approve()`; MAJOR and MINOR are
 * recorded for the reviewer and stop nothing.
 */
export enum FindingSeverity {
  BLOCKING = 'BLOCKING',
  MAJOR = 'MAJOR',
  MINOR = 'MINOR',
}

/**
 * WAIVER_PENDING is the state after one of the two required signatures. The
 * approval gate treats it as still blocking — a half-signed waiver is not a
 * waiver — and it exists so the reviewer can be shown "1 of 2" rather than a
 * finding that looks untouched.
 *
 * SUPERSEDED is cosmetic. Whether a finding still blocks is decided by
 * `version_number = documents.version_number` in the gate's WHERE clause, not
 * by this status. See ConflictGateService.
 */
export enum FindingStatus {
  OPEN = 'OPEN',
  WAIVER_PENDING = 'WAIVER_PENDING',
  RESOLVED = 'RESOLVED',
  WAIVED = 'WAIVED',
  SUPERSEDED = 'SUPERSEDED',
  DISMISSED = 'DISMISSED',
}

export enum FindingAction {
  RESOLVE = 'RESOLVE',
  WAIVE = 'WAIVE',
  DISMISS = 'DISMISS',
}

export enum ConfidenceLevel {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  NONE = 'NONE',
}

export enum AssistantType {
  NURSING = 'NURSING',
  DRUG_PREPARATION = 'DRUG_PREPARATION',
  CBAHI = 'CBAHI',
}

export enum DoseFormulaStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum DoseFormulaType {
  MG_PER_KG_PER_DOSE = 'MG_PER_KG_PER_DOSE',
  MG_PER_KG_PER_DAY = 'MG_PER_KG_PER_DAY',
  FIXED_DOSE = 'FIXED_DOSE',
}

export enum DoseRoute {
  IV = 'IV',
  IM = 'IM',
  PO = 'PO',
  SC = 'SC',
  INHALATION = 'INHALATION',
  TOPICAL = 'TOPICAL',
}
