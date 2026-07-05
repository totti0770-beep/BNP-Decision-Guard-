import {
  AssistantType,
  ConfidenceLevel,
  DocumentCategory,
  DocumentStatus,
  DoseRoute,
} from './constants';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
}

export interface CitationDto {
  documentId: string;
  documentTitle: string;
  pageNumber: number | null;
  approvalDate: string | null;
  similarity: number;
  snippet?: string;
}

export interface AiAnswerDto {
  questionId: string;
  answerId: string;
  refused: boolean;
  shortAnswer: string;
  steps: string[];
  warnings: string[];
  confidence: ConfidenceLevel;
  citations: CitationDto[];
}

export interface AskRequestDto {
  question: string;
  assistantType?: AssistantType;
  category?: DocumentCategory;
}

export interface DoseCalculationRequestDto {
  formulaId: string;
  weightKg: number;
  ageYears?: number;
  concentrationMgPerMl?: number;
  requiredDoseMg?: number;
  route?: DoseRoute;
  frequencyPerDay?: number;
}

export interface DoseCalculationResultDto {
  formulaName: string;
  drugName: string;
  steps: string[];
  finalDoseMg: number;
  volumeMl: number | null;
  perDoseMg?: number;
  warnings: string[];
  safetyWarning: string;
}

export interface DocumentDto {
  id: string;
  title: string;
  category: DocumentCategory;
  status: DocumentStatus;
  versionNumber: number;
  fileName: string;
  expiryDate: string | null;
  approvalDate: string | null;
  createdAt: string;
}
