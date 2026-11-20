import { z } from 'zod';
import type {
  AuditAssumptions,
  AuditResult,
  ManualFootprint,
  ProspectEntry,
  Scorecard,
} from '../audit/types';

export type RoadmapQuarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface HighlightBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WalkthroughScene {
  screenshotIndex: number;
  narration: string;
  caption: string;
  highlight: HighlightBox;
  findingRefs?: string[];
}

export interface ProposalOutcome {
  title: string;
  description: string;
  findingRef?: string;
  evidence?: string;
}

export interface RoadmapQuarterPlan {
  quarter: RoadmapQuarter;
  items: string[];
}

export interface WalkthroughData {
  title: string;
  scenes: WalkthroughScene[];
  outcomes: ProposalOutcome[];
  roadmap: RoadmapQuarterPlan[];
}

export interface ScreenshotAsset {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface ProjectBrief {
  clientName: string;
  businessType: string;
  brief: string;
  brandColor: string;
  logoDataUrl: string | null;
  websiteUrl?: string;
}

export interface FootprintNode {
  id: 'website' | 'ai-agent' | 'automations' | 'social';
  label: string;
  summary: string;
}

export interface PricingTier {
  id: string;
  name: string;
  audience: string;
  setupPrice: string;
  monthlyPrice: string;
  recommended: boolean;
  features: string[];
}

export interface PageFacts {
  url?: string;
  title: string;
  description: string;
  headings: string[];
  ctas: string[];
}

export interface AISearchQA {
  question: string;
  answer: string;
}

export interface AISearchLayerData {
  enabled: boolean;
  serviceArea: string;
  primaryOffer: string;
  keyDifferentiator: string;
  websiteUrl: string;
  contactInfo: string;
  faqs: AISearchQA[];
}

export interface AISettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  captureUrl: string;
  captureToken: string;
}

export interface FullProjectBundle {
  schemaVersion?: string;
  exportedAt: string;
  project: ProjectBrief;
  pageFacts?: PageFacts | null;
  aiSearchLayer?: AISearchLayerData;
  walkthrough: WalkthroughData;
  footprint: FootprintNode[];
  pricingTiers: PricingTier[];
  audit?: AuditResult | null;
  manualFootprint?: ManualFootprint | null;
  assumptions?: AuditAssumptions | null;
  scorecard?: Scorecard | null;
  prospects?: ProspectEntry[];
}

export const CURRENT_BUNDLE_SCHEMA_VERSION = '2.0';

export const DEFAULT_AI_SETTINGS: AISettings = {
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: '',
  model: '',
  captureUrl: '/api',
  captureToken: '',
};

export function buildDefaultAISearchLayer(
  project: ProjectBrief,
  pageFacts: PageFacts | null,
  walkthrough: WalkthroughData | null
): AISearchLayerData {
  const name = project.clientName.trim() || pageFacts?.title || 'Your Business';
  const type = project.businessType.trim() || 'Local Services';
  const summaryFromBrief = project.brief.trim() || pageFacts?.description || '';
  const topOutcome = walkthrough?.outcomes?.[0]?.description || '';
  const firstCta = pageFacts?.ctas?.[0] || 'Book or inquire directly on our website';

  return {
    enabled: true,
    serviceArea: 'Local & surrounding service area',
    primaryOffer:
      pageFacts?.description ||
      summaryFromBrief ||
      `${type} provided directly by ${name}.`,
    keyDifferentiator:
      topOutcome ||
      (pageFacts?.headings?.slice(0, 3).join(' · ') ||
        `Direct customer service with transparent information from ${name}.`),
    websiteUrl: pageFacts?.url || 'https://example.com',
    contactInfo: `Primary action: ${firstCta}`,
    faqs: [
      {
        question: `What does ${name} specialize in?`,
        answer:
          pageFacts?.description ||
          summaryFromBrief ||
          `${name} provides ${type.toLowerCase()} with direct online inquiries and transparent care.`,
      },
      {
        question: `How can customers book or get in touch with ${name}?`,
        answer: `Customers can ${firstCta.toLowerCase()} directly through ${pageFacts?.url || 'the official website'} without third-party middleman fees.`,
      },
      {
        question: `Why do local customers choose ${name}?`,
        answer:
          walkthrough?.outcomes?.[0]?.description ||
          `Clear service details, verified customer proof, and fast responses directly from ${name}.`,
      },
    ],
  };
}

export function buildLlmsTxt(
  project: ProjectBrief,
  aiSearch: AISearchLayerData,
  walkthrough: WalkthroughData
): string {
  const name = project.clientName.trim() || 'Client Business';
  const type = project.businessType.trim() || 'Business';
  const lines: string[] = [
    `# ${name}`,
    '',
    `> ${aiSearch.primaryOffer || `${name} — ${type}`}`,
    '',
    '## Business Profile (Verified for AI Assistants)',
    `- Business Name: ${name}`,
    `- Category: ${type}`,
    `- Service Area: ${aiSearch.serviceArea}`,
    `- Official Website: ${aiSearch.websiteUrl}`,
    `- Contact & Booking: ${aiSearch.contactInfo}`,
    `- Key Differentiator: ${aiSearch.keyDifferentiator}`,
    '',
    '## Core Customer Outcomes',
    ...walkthrough.outcomes.map((o) => `- **${o.title}**: ${o.description}`),
    '',
    '## Common Questions & Verified Answers',
    ...aiSearch.faqs.flatMap((qa) => [`### ${qa.question}`, qa.answer, '']),
  ];

  return lines.join('\n').trim();
}

export function buildJsonLdSnippet(
  project: ProjectBrief,
  aiSearch: AISearchLayerData
): string {
  const name = project.clientName.trim() || 'Client Business';
  const businessType = project.businessType.trim() || 'LocalBusiness';

  const schemaGraph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'LocalBusiness',
        name,
        description: aiSearch.primaryOffer,
        url: aiSearch.websiteUrl,
        areaServed: aiSearch.serviceArea,
        knowsAbout: businessType,
        slogan: aiSearch.keyDifferentiator,
      },
      {
        '@type': 'FAQPage',
        mainEntity: aiSearch.faqs.map((qa) => ({
          '@type': 'Question',
          name: qa.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: qa.answer,
          },
        })),
      },
    ],
  };

  return `<script type="application/ld+json">\n${JSON.stringify(schemaGraph, null, 2)}\n</script>`;
}

export const DEFAULT_FOOTPRINT: FootprintNode[] = [
  {
    id: 'website',
    label: 'Website',
    summary: 'Clear service pages and direct inquiry paths that convert visitors without middleman fees.',
  },
  {
    id: 'ai-agent',
    label: 'AI Agent',
    summary: 'Instant answers to common questions and booking capture, even when your team is closed.',
  },
  {
    id: 'automations',
    label: 'Automations',
    summary: 'Automatic confirmations, reminders, and follow-ups so no lead slips through the cracks.',
  },
  {
    id: 'social',
    label: 'Social',
    summary: 'Consistent local visibility and customer proof driving steady traffic back to your site.',
  },
];

export const DEFAULT_PRICING_TIERS: PricingTier[] = [
  {
    id: 'tier-foundation',
    name: 'Foundation',
    audience: 'For local businesses replacing an outdated site',
    setupPrice: '$2,400',
    monthlyPrice: '$190',
    recommended: false,
    features: [
      'Conversion-focused website refresh',
      'Mobile-ready direct booking & inquiry forms',
      'Managed hosting, security & updates',
      'Monthly performance summary',
    ],
  },
  {
    id: 'tier-growth',
    name: 'Growth Partner',
    audience: 'For teams ready to capture leads around the clock',
    setupPrice: '$4,200',
    monthlyPrice: '$490',
    recommended: true,
    features: [
      'Everything in Foundation',
      '24/7 customer inquiry assistant trained on your services',
      'Automated appointment reminders & follow-ups',
      'Quarterly 2027 roadmap implementation',
    ],
  },
  {
    id: 'tier-scale',
    name: 'Complete Digital Suite',
    audience: 'For multi-service brands scaling regional demand',
    setupPrice: '$6,800',
    monthlyPrice: '$890',
    recommended: false,
    features: [
      'Everything in Growth Partner',
      'Full CRM & calendar workflow automations',
      'Ongoing social content & review engine',
      'Dedicated priority strategy sessions',
    ],
  },
];

export function createWalkthroughSchema(
  maxScreenshotIndex: number,
  validFindingIds?: string[]
) {
  const HighlightSchema = z.object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    w: z.number().min(1).max(100),
    h: z.number().min(1).max(100),
  });

  const allowedSet = validFindingIds && validFindingIds.length > 0 ? new Set(validFindingIds) : null;

  const SceneSchema = z.object({
    screenshotIndex: z
      .number()
      .int()
      .min(0)
      .max(Math.max(0, maxScreenshotIndex)),
    narration: z.string().trim().min(1, 'Narration cannot be empty'),
    caption: z.string().trim().min(1, 'Caption cannot be empty'),
    highlight: HighlightSchema,
    findingRefs: z
      .array(z.string())
      .optional()
      .superRefine((refs, ctx) => {
        if (!refs || !allowedSet) return;
        const unknownRefs = refs.filter((id) => !allowedSet.has(id));
        if (unknownRefs.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown findingRefs ID(s): ${unknownRefs.join(', ')}. Allowed IDs: ${Array.from(allowedSet).join(', ')}`,
          });
        }
      }),
  });

  const OutcomeSchema = z.object({
    title: z.string().trim().min(1, 'Outcome title cannot be empty'),
    description: z.string().trim().min(1, 'Outcome description cannot be empty'),
    findingRef: z.string().optional(),
    evidence: z.string().optional(),
  });

  const RoadmapSchema = z.object({
    quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4']),
    items: z.array(z.string().trim().min(1)).min(1, 'Each quarter needs at least one item'),
  });

  return z.object({
    title: z.string().trim().min(1, 'Title cannot be empty'),
    scenes: z.array(SceneSchema).min(1, 'At least one walkthrough scene is required'),
    outcomes: z.array(OutcomeSchema).min(1, 'At least one outcome is required'),
    roadmap: z.array(RoadmapSchema).min(1, 'Roadmap must include Q1-Q4 entries'),
  });
}

export function calculateSceneDurationSec(narration: string): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  // 150 words per minute = 2.5 words per second, minimum 4.5s for visual comprehension
  return Math.max(4.5, Number(((words / 150) * 60).toFixed(1)));
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function getContrastTextColor(hexColor: string): '#FFFFFF' | '#0F172A' {
  const clean = hexColor.replace('#', '');
  if (clean.length !== 6) return '#FFFFFF';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#0F172A' : '#FFFFFF';
}
