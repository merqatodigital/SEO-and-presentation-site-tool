import { z } from 'zod';

/**
 * Portable Audit & Scorecard JSON contracts for TourForge Lite.
 * Designed with zero browser/AI SDK dependencies so scoring & schema checks
 * run identically on client, server, and external agents.
 */

export const FindingStatusSchema = z.enum(['pass', 'warn', 'fail', 'unknown']);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const AuditCategoryIdSchema = z.enum(['gbp', 'seo', 'contact', 'speed', 'social']);
export type AuditCategoryId = z.infer<typeof AuditCategoryIdSchema>;

export interface CategoryDefinition {
  id: AuditCategoryId;
  label: string;
  weight: number;
}

export const AUDIT_CATEGORIES: CategoryDefinition[] = [
  { id: 'gbp', label: 'Business Profile (GBP) & Reviews', weight: 30 },
  { id: 'seo', label: 'On-page SEO & Structured Data', weight: 20 },
  { id: 'contact', label: 'Contact & Conversion', weight: 20 },
  { id: 'speed', label: 'Speed & Mobile', weight: 15 },
  { id: 'social', label: 'Social & Listings Consistency', weight: 15 },
];

export const AuditFindingSchema = z.object({
  id: z.string().min(1),
  category: AuditCategoryIdSchema,
  label: z.string().min(1),
  status: FindingStatusSchema,
  evidence: z.string(),
  fix: z.string(),
  businessImpact: z.string(),
  weight: z.number().min(1).max(5),
});
export type AuditFinding = z.infer<typeof AuditFindingSchema>;

export const SpeedOpportunitySchema = z.object({
  id: z.string(),
  title: z.string(),
  savingsText: z.string(),
});
export type SpeedOpportunity = z.infer<typeof SpeedOpportunitySchema>;

export const SpeedMetricsSchema = z.object({
  scores: z.object({
    performance: z.number().nullable(),
    seo: z.number().nullable(),
    accessibility: z.number().nullable(),
    bestPractices: z.number().nullable(),
  }),
  fcpMs: z.number().nullable(),
  lcpMs: z.number().nullable(),
  cls: z.number().nullable(),
  tbtMs: z.number().nullable(),
  speedIndexMs: z.number().nullable(),
  totalByteWeight: z.number().nullable(),
  opportunities: z.array(SpeedOpportunitySchema),
});
export type SpeedMetrics = z.infer<typeof SpeedMetricsSchema>;

export const ParsedLinksSchema = z.object({
  tel: z.array(z.string()),
  mailto: z.array(z.string()),
  whatsapp: z.array(z.string()),
  messenger: z.array(z.string()),
  viber: z.array(z.string()),
  facebook: z.array(z.string()),
  instagram: z.array(z.string()),
  tiktok: z.array(z.string()),
  tripadvisor: z.array(z.string()),
  bookingCom: z.array(z.string()),
  agoda: z.array(z.string()),
  airbnb: z.array(z.string()),
  mapLinks: z.array(z.string()),
});
export type ParsedLinks = z.infer<typeof ParsedLinksSchema>;

export const ParsedHtmlFactsSchema = z.object({
  title: z.string(),
  titleLength: z.number(),
  metaDescription: z.string(),
  metaDescriptionLength: z.number(),
  canonical: z.string().nullable(),
  viewport: z.string().nullable(),
  htmlLang: z.string().nullable(),
  h1Count: z.number(),
  h2Count: z.number(),
  headings: z.array(z.string()),
  ogSiteName: z.string().nullable().optional().default(null),
  ogTitle: z.string().nullable(),
  ogDescription: z.string().nullable(),
  ogImage: z.string().nullable(),
  imagesTotal: z.number(),
  imagesMissingAlt: z.number(),
  jsonLdTypes: z.array(z.string()),
  jsonLdInvalidCount: z.number(),
  links: ParsedLinksSchema,
  formCount: z.number(),
  ctaTexts: z.array(z.string()),
});
export type ParsedHtmlFacts = z.infer<typeof ParsedHtmlFactsSchema>;

export const AuditNoteSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type AuditNote = z.infer<typeof AuditNoteSchema>;

export const ContentSourceSchema = z.enum(['raw', 'rendered', 'blocked']);
export type ContentSource = z.infer<typeof ContentSourceSchema>;

export const AuditResultSchema = z.object({
  schemaVersion: z.string().default('1.0'),
  requestedUrl: z.string(),
  finalUrl: z.string().nullable(),
  auditedAt: z.string(),
  httpStatus: z.number().nullable(),
  ttfbMs: z.number().nullable(),
  ttfbSamplesMs: z.array(z.number()).optional(),
  htmlBytes: z.number().nullable(),
  isHttps: z.boolean().nullable(),
  fetchError: z.string().nullable(),
  contentSource: ContentSourceSchema.optional(),
  auditNotes: z.array(AuditNoteSchema).optional(),
  redirectedFromHost: z.string().optional(),
  parsed: ParsedHtmlFactsSchema.nullable(),
  robotsTxt: z.object({
    exists: z.boolean().nullable(),
    allowsIndexing: z.boolean().nullable(),
    reason: z.string().optional(),
  }),
  sitemapXml: z.object({
    exists: z.boolean().nullable(),
    reason: z.string().optional(),
  }),
  speed: SpeedMetricsSchema.nullable(),
  speedReason: z.string().nullable(),
  findings: z.array(AuditFindingSchema),
});
export type AuditResult = z.infer<typeof AuditResultSchema>;

export const TriStateSchema = z.enum(['yes', 'no', 'unknown']);
export type TriState = z.infer<typeof TriStateSchema>;

export const ListingRowSchema = z.object({
  id: z.string(),
  platform: z.string(),
  listed: TriStateSchema.default('unknown'),
  url: z.string().default(''),
  seenName: z.string().default(''),
  seenAddress: z.string().default(''),
  seenPhone: z.string().default(''),
});
export type ListingRow = z.infer<typeof ListingRowSchema>;

export const ManualFootprintSchema = z.object({
  nap: z
    .object({
      businessName: z.string().default(''),
      fullAddress: z.string().default(''),
      phone: z.string().default(''),
    })
    .default({ businessName: '', fullAddress: '', phone: '' }),
  gbp: z
    .object({
      claimed: TriStateSchema.default('unknown'),
      primaryCategorySet: TriStateSchema.default('unknown'),
      hoursListed: TriStateSchema.default('unknown'),
      photoCount: z.number().nullable().default(null),
      postsLast90Days: z.number().nullable().default(null),
      reviewCount: z.number().nullable().default(null),
      averageRating: z.number().nullable().default(null),
      ownerReplies: z.enum(['none', 'some', 'most', 'unknown']).default('unknown'),
      qaAnswered: TriStateSchema.default('unknown'),
      bookingOrMenuLinkSet: TriStateSchema.default('unknown'),
    })
    .default({
      claimed: 'unknown',
      primaryCategorySet: 'unknown',
      hoursListed: 'unknown',
      photoCount: null,
      postsLast90Days: null,
      reviewCount: null,
      averageRating: null,
      ownerReplies: 'unknown',
      qaAnswered: 'unknown',
      bookingOrMenuLinkSet: 'unknown',
    }),
  facebook: z
    .object({
      exists: TriStateSchema.default('unknown'),
      url: z.string().default(''),
      lastPostDate: z.string().default(''),
      followers: z.number().nullable().default(null),
      messengerRepliesWithinDay: TriStateSchema.default('unknown'),
    })
    .default({
      exists: 'unknown',
      url: '',
      lastPostDate: '',
      followers: null,
      messengerRepliesWithinDay: 'unknown',
    }),
  instagram: z
    .object({
      exists: TriStateSchema.default('unknown'),
      url: z.string().default(''),
      lastPostDate: z.string().default(''),
      followers: z.number().nullable().default(null),
    })
    .default({
      exists: 'unknown',
      url: '',
      lastPostDate: '',
      followers: null,
    }),
  listings: z.array(ListingRowSchema).default([]),
  openingHoursText: z.string().optional().default(''),
  priceRange: z.string().optional().default(''),
});
export type ManualFootprint = z.infer<typeof ManualFootprintSchema>;

export const DEFAULT_LISTING_PLATFORMS = [
  { id: 'listing-gbp-hotels', platform: 'GBP Hotels' },
  { id: 'listing-booking', platform: 'Booking.com' },
  { id: 'listing-agoda', platform: 'Agoda' },
  { id: 'listing-tripadvisor', platform: 'TripAdvisor' },
  { id: 'listing-airbnb', platform: 'Airbnb' },
  { id: 'listing-klook', platform: 'Klook / GetYourGuide' },
  { id: 'listing-custom', platform: 'Custom Directory' },
];

export function createEmptyManualFootprint(): ManualFootprint {
  return {
    nap: { businessName: '', fullAddress: '', phone: '' },
    gbp: {
      claimed: 'unknown',
      primaryCategorySet: 'unknown',
      hoursListed: 'unknown',
      photoCount: null,
      postsLast90Days: null,
      reviewCount: null,
      averageRating: null,
      ownerReplies: 'unknown',
      qaAnswered: 'unknown',
      bookingOrMenuLinkSet: 'unknown',
    },
    facebook: {
      exists: 'unknown',
      url: '',
      lastPostDate: '',
      followers: null,
      messengerRepliesWithinDay: 'unknown',
    },
    instagram: {
      exists: 'unknown',
      url: '',
      lastPostDate: '',
      followers: null,
    },
    listings: DEFAULT_LISTING_PLATFORMS.map((item) => ({
      id: item.id,
      platform: item.platform,
      listed: 'unknown',
      url: '',
      seenName: '',
      seenAddress: '',
      seenPhone: '',
    })),
    openingHoursText: '',
    priceRange: '',
  };
}

export const AuditAssumptionsSchema = z.object({
  currency: z.enum(['PHP', 'USD', 'EUR']).optional().default('PHP'),
  monthlyVisitors: z.number().nullable().default(null),
  inquiryRatePct: z.number().min(0).max(100).default(2),
  avgBookingValuePhp: z.number().nullable().default(null),
  slowLoadLossPct: z.number().min(0).max(100).nullable().default(null),
  missingContactLossPct: z.number().min(0).max(100).nullable().default(null),
  lowReviewTrustLossPct: z.number().min(0).max(100).nullable().default(null),
});
export type AuditAssumptions = z.infer<typeof AuditAssumptionsSchema>;

export function createDefaultAssumptions(): AuditAssumptions {
  return {
    currency: 'PHP',
    monthlyVisitors: null,
    inquiryRatePct: 2,
    avgBookingValuePhp: null,
    slowLoadLossPct: null,
    missingContactLossPct: null,
    lowReviewTrustLossPct: null,
  };
}

export type RagBand = 'green' | 'amber' | 'red' | 'unknown';
export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A';

export const CategoryScoreSchema = z.object({
  id: AuditCategoryIdSchema,
  label: z.string(),
  baseWeight: z.number(),
  effectiveWeight: z.number(),
  score: z.number().nullable(),
  rag: z.enum(['green', 'amber', 'red', 'unknown']),
  knownCount: z.number(),
  totalCount: z.number(),
  insufficientData: z.boolean().optional().default(false),
});
export type CategoryScore = z.infer<typeof CategoryScoreSchema>;

export const IgnoredLeadsEstimateSchema = z.object({
  visible: z.boolean(),
  currency: z.enum(['PHP', 'USD', 'EUR']).optional().default('PHP'),
  monthlyVisitors: z.number().nullable(),
  inquiryRatePct: z.number(),
  avgBookingValuePhp: z.number().nullable(),
  effectiveLossPct: z.number(),
  breakdownPct: z.object({
    slowLoad: z.number(),
    missingContact: z.number(),
    lowReviewTrust: z.number(),
  }),
  inquiriesLostLow: z.number(),
  inquiriesLostHigh: z.number(),
  revenueLostPhpLow: z.number().nullable(),
  revenueLostPhpHigh: z.number().nullable(),
  disclaimer: z.string(),
});
export type IgnoredLeadsEstimate = z.infer<typeof IgnoredLeadsEstimateSchema>;

export const ScorecardSchema = z.object({
  overallScore: z.number().nullable(),
  grade: z.enum(['A', 'B', 'C', 'D', 'F', 'N/A']),
  rag: z.enum(['green', 'amber', 'red', 'unknown']),
  dataCompletenessPct: z.number(),
  isProvisional: z.boolean().optional().default(false),
  knownChecks: z.number(),
  totalChecks: z.number(),
  categories: z.array(CategoryScoreSchema),
  fixFirst: z.array(AuditFindingSchema),
  allFindings: z.array(AuditFindingSchema),
  ignoredLeads: IgnoredLeadsEstimateSchema,
});
export type Scorecard = z.infer<typeof ScorecardSchema>;

export const ProspectEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  overallScore: z.number().nullable(),
  grade: z.enum(['A', 'B', 'C', 'D', 'F', 'N/A']),
  rag: z.enum(['green', 'amber', 'red', 'unknown']),
  topFailingFindings: z.array(z.string()),
  auditedAt: z.string(),
  audit: AuditResultSchema.nullable(),
  scorecard: ScorecardSchema.nullable(),
});
export type ProspectEntry = z.infer<typeof ProspectEntrySchema>;
