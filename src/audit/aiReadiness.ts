import { BUSINESS_SCHEMA_TYPES } from './htmlFindings';
import {
  AiBotAccessStatus,
  AiBotPermission,
  AiReadinessResult,
  AuditResult,
  ParsedHtmlFacts,
  RagBand,
} from './types';

export const AI_CRAWLER_BOTS: Array<{ bot: string; label: string }> = [
  { bot: 'GPTBot', label: 'OpenAI GPTBot (Search & Training)' },
  { bot: 'ChatGPT-User', label: 'ChatGPT Live Browsing' },
  { bot: 'OAI-SearchBot', label: 'OpenAI Search Index' },
  { bot: 'ClaudeBot', label: 'Anthropic ClaudeBot' },
  { bot: 'anthropic-ai', label: 'Anthropic AI Crawler' },
  { bot: 'PerplexityBot', label: 'Perplexity Search Crawler' },
];

export function parseRobotsAiBots(robotsContent: string | null): AiBotPermission[] {
  if (robotsContent === null) {
    return AI_CRAWLER_BOTS.map((entry) => ({
      ...entry,
      status: 'unknown',
    }));
  }

  // Group directives by lowercase User-agent blocks
  const blocks: Array<{ agents: string[]; rules: Array<{ type: 'allow' | 'disallow'; path: string }> }> = [];
  let currentBlock: { agents: string[]; rules: Array<{ type: 'allow' | 'disallow'; path: string }> } | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of robotsContent.split(/\r?\n/)) {
    const clean = rawLine.split('#')[0].trim();
    if (!clean) {
      lastLineWasAgent = false;
      continue;
    }
    const colonIdx = clean.indexOf(':');
    if (colonIdx === -1) continue;
    const directive = clean.slice(0, colonIdx).trim().toLowerCase();
    const value = clean.slice(colonIdx + 1).trim();

    if (directive === 'user-agent') {
      const agent = value.toLowerCase();
      if (!currentBlock || !lastLineWasAgent) {
        currentBlock = { agents: [agent], rules: [] };
        blocks.push(currentBlock);
      } else {
        currentBlock.agents.push(agent);
      }
      lastLineWasAgent = true;
    } else if ((directive === 'disallow' || directive === 'allow') && currentBlock) {
      lastLineWasAgent = false;
      currentBlock.rules.push({ type: directive, path: value });
    } else {
      lastLineWasAgent = false;
    }
  }

  const evalRules = (rules: Array<{ type: 'allow' | 'disallow'; path: string }>): AiBotAccessStatus => {
    let blockedRoot = false;
    let allowedRoot = false;
    for (const rule of rules) {
      if (rule.type === 'disallow' && rule.path === '/') {
        blockedRoot = true;
      }
      if (rule.type === 'allow' && rule.path === '/') {
        allowedRoot = true;
      }
    }
    if (blockedRoot && !allowedRoot) return 'blocked';
    return 'allowed';
  };

  const wildcardRules = blocks.filter((b) => b.agents.includes('*')).flatMap((b) => b.rules);

  return AI_CRAWLER_BOTS.map((entry) => {
    const botKey = entry.bot.toLowerCase();
    const specificRules = blocks
      .filter((b) => b.agents.includes(botKey))
      .flatMap((b) => b.rules);

    if (specificRules.length > 0) {
      return { ...entry, status: evalRules(specificRules) };
    }
    if (wildcardRules.length > 0) {
      return { ...entry, status: evalRules(wildcardRules) };
    }
    return { ...entry, status: 'allowed' };
  });
}

export function buildEntityCompletenessFromParsed(
  parsed: ParsedHtmlFacts | null
): AiReadinessResult['entityCompleteness'] {
  if (!parsed) {
    return {
      hasBusinessType: false,
      hasAddress: false,
      hasTelephone: false,
      hasOpeningHours: false,
      hasPriceRange: false,
      hasSameAs: false,
      hasFaqPage: false,
      hasGeo: false,
    };
  }
  const hasBusinessType = parsed.jsonLdTypes.some((t) => BUSINESS_SCHEMA_TYPES.has(t));
  const d = parsed.jsonLdDetails;
  return {
    hasBusinessType,
    hasAddress: d?.hasAddress ?? false,
    hasTelephone: d?.hasTelephone ?? false,
    hasOpeningHours: d?.hasOpeningHours ?? false,
    hasPriceRange: d?.hasPriceRange ?? false,
    hasSameAs: d?.hasSameAs ?? false,
    hasFaqPage: d?.hasFaqPage ?? parsed.jsonLdTypes.includes('FAQPage'),
    hasGeo: d?.hasGeo ?? false,
  };
}

export interface AiReadinessChecklistItem {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'unknown';
  detail: string;
  fix: string;
}

export interface AiReadinessSummary {
  score: number | null;
  rag: RagBand;
  allowedBotsCount: number;
  blockedBotsCount: number;
  totalBotsCount: number;
  entityFieldsPresent: number;
  entityFieldsTotal: number;
  llmsStatus: 'found' | 'missing' | 'unknown';
  items: AiReadinessChecklistItem[];
}

export function buildAiReadinessSummary(audit: AuditResult | null): AiReadinessSummary {
  if (!audit) {
    return {
      score: null,
      rag: 'unknown',
      allowedBotsCount: 0,
      blockedBotsCount: 0,
      totalBotsCount: AI_CRAWLER_BOTS.length,
      entityFieldsPresent: 0,
      entityFieldsTotal: 8,
      llmsStatus: 'unknown',
      items: [],
    };
  }

  const ai = audit.aiReadiness;
  const botAccess = ai?.botAccess ?? [];
  const allowedBotsCount = botAccess.filter((b) => b.status === 'allowed').length;
  const blockedBotsCount = botAccess.filter((b) => b.status === 'blocked').length;
  const unknownBotsCount = botAccess.filter((b) => b.status === 'unknown').length;
  const totalBotsCount = botAccess.length || AI_CRAWLER_BOTS.length;

  const entity = ai?.entityCompleteness ?? buildEntityCompletenessFromParsed(audit.parsed);
  const entityFlags = [
    entity.hasBusinessType,
    entity.hasAddress,
    entity.hasTelephone,
    entity.hasOpeningHours,
    entity.hasPriceRange,
    entity.hasSameAs,
    entity.hasFaqPage,
    entity.hasGeo,
  ];
  const entityFieldsPresent = entityFlags.filter(Boolean).length;
  const entityFieldsTotal = entityFlags.length;

  const llmsExists = ai?.llmsTxt.exists ?? null;
  const llmsStatus: 'found' | 'missing' | 'unknown' =
    llmsExists === true ? 'found' : llmsExists === false ? 'missing' : 'unknown';

  const items: AiReadinessChecklistItem[] = [];

  // 1. AI Crawler bots
  const crawlerStatus: AiReadinessChecklistItem['status'] =
    unknownBotsCount === totalBotsCount || botAccess.length === 0
      ? 'unknown'
      : blockedBotsCount === 0
      ? 'pass'
      : blockedBotsCount < totalBotsCount
      ? 'warn'
      : 'fail';
  items.push({
    id: 'ai-crawlers',
    label: 'AI search crawlers allowed (GPTBot, ClaudeBot, PerplexityBot)',
    status: crawlerStatus,
    detail:
      crawlerStatus === 'unknown'
        ? 'robots.txt could not be checked yet'
        : blockedBotsCount === 0
        ? `All ${allowedBotsCount}/${totalBotsCount} checked AI crawlers allowed`
        : `${blockedBotsCount} of ${totalBotsCount} AI bots blocked in robots.txt`,
    fix: 'Allow OAI-SearchBot, ChatGPT-User, ClaudeBot, and PerplexityBot in /robots.txt using the AI-allow snippet below.',
  });

  // 2. /llms.txt
  items.push({
    id: 'ai-llms-txt',
    label: 'Machine-readable /llms.txt summary published',
    status: llmsStatus === 'found' ? 'pass' : llmsStatus === 'missing' ? 'warn' : 'unknown',
    detail:
      llmsStatus === 'found'
        ? `/llms.txt detected (${ai?.llmsTxt.bytes ?? 0} bytes)`
        : llmsStatus === 'missing'
        ? ai?.llmsTxt.reason || 'No /llms.txt file found at domain root'
        : 'Not checked yet',
    fix: 'Publish the generated /llms.txt file at your site root so AI agents can read clean verified business facts.',
  });

  // 3. Rich Business Entity JSON-LD
  const entityStatus: AiReadinessChecklistItem['status'] = !audit.parsed
    ? 'unknown'
    : entity.hasBusinessType && entity.hasAddress && entity.hasTelephone
    ? entityFieldsPresent >= 5
      ? 'pass'
      : 'warn'
    : entityFieldsPresent > 0
    ? 'warn'
    : 'fail';
  items.push({
    id: 'ai-entity-schema',
    label: 'Rich Business Entity JSON-LD (@type, NAP, hours, priceRange, sameAs)',
    status: entityStatus,
    detail: !audit.parsed
      ? 'Page HTML not parsed'
      : `${entityFieldsPresent}/${entityFieldsTotal} rich entity properties detected`,
    fix: 'Embed the complete Schema.org JSON-LD block (including @type, address, telephone, hours, priceRange, and sameAs links).',
  });

  // 4. FAQPage / direct answers
  items.push({
    id: 'ai-faq-schema',
    label: 'FAQPage Q&A structured answers for conversational search',
    status: !audit.parsed ? 'unknown' : entity.hasFaqPage ? 'pass' : 'fail',
    detail: !audit.parsed
      ? 'Page HTML not parsed'
      : entity.hasFaqPage
      ? 'FAQPage schema detected'
      : 'No FAQPage structured Q&A schema found',
    fix: 'Add 3–5 verified customer Q&As inside FAQPage JSON-LD answering location, pricing, and direct booking.',
  });

  // Compute deterministic score across non-unknown checks
  const weights: Record<string, number> = {
    'ai-crawlers': 35,
    'ai-llms-txt': 15,
    'ai-entity-schema': 30,
    'ai-faq-schema': 20,
  };
  let weightedSum = 0;
  let totalWeight = 0;
  for (const item of items) {
    if (item.status === 'unknown') continue;
    const w = weights[item.id] ?? 20;
    const pts = item.status === 'pass' ? 1 : item.status === 'warn' ? 0.5 : 0;
    weightedSum += pts * w;
    totalWeight += w;
  }

  const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : null;
  const rag: RagBand =
    score === null ? 'unknown' : score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red';

  return {
    score,
    rag,
    allowedBotsCount,
    blockedBotsCount,
    totalBotsCount,
    entityFieldsPresent,
    entityFieldsTotal,
    llmsStatus,
    items,
  };
}

export function buildRecommendedRobotsTxt(websiteUrl?: string): string {
  let sitemapLine = 'Sitemap: https://example.com/sitemap.xml';
  if (websiteUrl && websiteUrl.trim()) {
    try {
      const normalized = /^https?:\/\//i.test(websiteUrl.trim())
        ? websiteUrl.trim()
        : `https://${websiteUrl.trim()}`;
      const origin = new URL(normalized).origin;
      sitemapLine = `Sitemap: ${origin}/sitemap.xml`;
    } catch {
      // Fallback to default sitemap line
    }
  }

  return [
    '# Standard search engines',
    'User-agent: *',
    'Allow: /',
    '',
    '# AI Search & Assistant Browsing (keep visible for ChatGPT, Claude & Perplexity answers)',
    'User-agent: OAI-SearchBot',
    'Allow: /',
    '',
    'User-agent: ChatGPT-User',
    'Allow: /',
    '',
    'User-agent: GPTBot',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    '',
    'User-agent: anthropic-ai',
    'Allow: /',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    '',
    sitemapLine,
  ].join('\n');
}
