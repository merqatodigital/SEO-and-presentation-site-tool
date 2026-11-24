import {
  AiMentionCheckResultSchema,
  AuditAssumptionsSchema,
  AuditResultSchema,
  ManualFootprintSchema,
  ProspectEntrySchema,
  ScorecardSchema,
  SiteAnalysisReportSchema,
  createDefaultAssumptions,
  createEmptyManualFootprint,
} from './types';
import {
  CURRENT_BUNDLE_SCHEMA_VERSION,
  FullProjectBundle,
} from '../types/tour';

export function migrateImportedBundle(raw: unknown): Partial<FullProjectBundle> {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Imported JSON is not an object.');
  }

  const record = raw as Record<string, unknown>;

  const rawAudit = record.audit ? AuditResultSchema.safeParse(record.audit) : null;
  const rawManual = record.manualFootprint
    ? ManualFootprintSchema.safeParse(record.manualFootprint)
    : null;
  const rawAssumptions = record.assumptions
    ? AuditAssumptionsSchema.safeParse(record.assumptions)
    : null;
  const rawScorecard = record.scorecard ? ScorecardSchema.safeParse(record.scorecard) : null;
  const rawMentionCheck = record.aiMentionCheck
    ? AiMentionCheckResultSchema.safeParse(record.aiMentionCheck)
    : null;
  const rawAnalysisReport = record.siteAnalysisReport
    ? SiteAnalysisReportSchema.safeParse(record.siteAnalysisReport)
    : null;

  let prospects = undefined;
  if (Array.isArray(record.prospects)) {
    prospects = record.prospects
      .map((entry) => ProspectEntrySchema.safeParse(entry))
      .filter((res) => res.success)
      .map((res) => res.data);
  }

  return {
    schemaVersion:
      typeof record.schemaVersion === 'string'
        ? record.schemaVersion
        : CURRENT_BUNDLE_SCHEMA_VERSION,
    exportedAt:
      typeof record.exportedAt === 'string' ? record.exportedAt : new Date().toISOString(),
    project: record.project as FullProjectBundle['project'] | undefined,
    pageFacts: (record.pageFacts as FullProjectBundle['pageFacts']) ?? null,
    aiSearchLayer: record.aiSearchLayer as FullProjectBundle['aiSearchLayer'] | undefined,
    walkthrough: record.walkthrough as FullProjectBundle['walkthrough'] | undefined,
    footprint: record.footprint as FullProjectBundle['footprint'] | undefined,
    pricingTiers: record.pricingTiers as FullProjectBundle['pricingTiers'] | undefined,
    audit: rawAudit?.success ? rawAudit.data : null,
    manualFootprint: rawManual?.success ? rawManual.data : createEmptyManualFootprint(),
    assumptions: rawAssumptions?.success ? rawAssumptions.data : createDefaultAssumptions(),
    scorecard: rawScorecard?.success ? rawScorecard.data : null,
    prospects,
    aiMentionCheck: rawMentionCheck?.success ? rawMentionCheck.data : null,
    siteAnalysisReport: rawAnalysisReport?.success ? rawAnalysisReport.data : null,
  };
}
