/**
 * Clinical safety strings. These are contractual: the API must return them
 * verbatim, and tests assert exact equality. Do not reword or translate.
 */
export const REFUSAL_MESSAGE_AR =
  'لا توجد وثيقة معتمدة كافية للإجابة. الرجاء الرجوع للمسؤول المختص.';

export const DOSE_SAFETY_WARNING_AR =
  'لا يعتمد هذا الحساب دون مراجعة سريرية من المختص.';

export const PLATFORM_NAME = 'BNP Decision Guard';
export const PLATFORM_TAGLINE =
  'Knowledge Governance and Authorized Decision Platform';

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

/** Statuses eligible for AI retrieval. Only ACTIVE documents feed the RAG index. */
export const RETRIEVABLE_STATUSES = [DocumentStatus.ACTIVE];

export enum ApprovalAction {
  SUBMIT_REVIEW = 'SUBMIT_REVIEW',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  INDEX = 'INDEX',
  ACTIVATE = 'ACTIVATE',
  DEACTIVATE = 'DEACTIVATE',
  EXPIRE = 'EXPIRE',
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
