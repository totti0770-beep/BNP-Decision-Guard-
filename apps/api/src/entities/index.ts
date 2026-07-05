import { PermissionEntity, Role, User } from './user.entity';
import {
  Document,
  DocumentApproval,
  DocumentChunk,
  DocumentVersion,
} from './document.entity';
import { AiAnswer, AiQuestion, Citation } from './ai.entity';
import { DoseCalculation, DoseFormula } from './dose.entity';
import { AuditLog, Notification, Setting } from './misc.entity';

export {
  PermissionEntity,
  Role,
  User,
  Document,
  DocumentApproval,
  DocumentChunk,
  DocumentVersion,
  AiAnswer,
  AiQuestion,
  Citation,
  DoseCalculation,
  DoseFormula,
  AuditLog,
  Notification,
  Setting,
};

export const entities = [
  PermissionEntity,
  Role,
  User,
  Document,
  DocumentApproval,
  DocumentChunk,
  DocumentVersion,
  AiAnswer,
  AiQuestion,
  Citation,
  DoseCalculation,
  DoseFormula,
  AuditLog,
  Notification,
  Setting,
];
