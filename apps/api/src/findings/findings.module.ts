import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Document,
  DocumentVersion,
  FindingEvidence,
  FindingResolution,
  ReviewFinding,
  User,
} from '../entities';
import { RagModule } from '../rag/rag.module';
import { ScanService } from './scan.service';
import { ConflictGateService } from './conflict-gate.service';
import { FindingsService } from './findings.service';
import { FindingsController } from './findings.controller';
import { LiveScanService } from './live-scan.service';

/**
 * Pre-activation conflict detection.
 *
 * Deliberately a sibling of DocumentsModule rather than a part of it, and the
 * dependency runs one way only: DocumentsModule imports this, this imports
 * nothing from DocumentsModule. Nothing here injects DocumentsService — the
 * services take a `Document` instance or an id and reach the tables through
 * `forFeature` — which keeps NotificationsModule → DocumentsModule →
 * FindingsModule acyclic.
 *
 * StorageModule is @Global, so StorageService needs no import here.
 * AuditLogModule is @Global too, hence no import for AuditService.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReviewFinding,
      FindingEvidence,
      FindingResolution,
      Document,
      DocumentVersion,
      User,
    ]),
    RagModule,
  ],
  controllers: [FindingsController],
  providers: [ScanService, ConflictGateService, FindingsService, LiveScanService],
  exports: [ScanService, ConflictGateService, FindingsService],
})
export class FindingsModule {}
