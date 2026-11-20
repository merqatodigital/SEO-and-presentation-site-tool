import { z } from 'zod';
import { AuditFinding } from '../audit/types';
import {
  AISettings,
  PageFacts,
  ProjectBrief,
  ScreenshotAsset,
  WalkthroughData,
  createWalkthroughSchema,
} from '../types/tour';

export const TOUR_SYSTEM_PROMPT =
  'You are writing a short guided walkthrough of a website for a NON-TECHNICAL business owner deciding whether to hire a digital agency. You get screenshots and a brief. Return ONLY valid JSON matching the schema. Every narration line states a BUSINESS OUTCOME first (more direct bookings, fewer missed inquiries, replies at 2am, no commission, trust from photos), then briefly what they see. Never use jargon like click, element, UI, DOM, breakpoint. Max 30 words per scene. Highlight coordinates are percentages of the screenshot. Never invent features or prices not visible or in the brief. Only reference buttons, headings and features listed in the page facts or visible in the screenshots. Never invent anything else. Warm, plain, confident tone. End with a line about growing digitally into 2027.';

export const TOUR_FINDINGS_SYSTEM_RULES =
  ' When a FINDINGS block is provided: tie each scene outcome headline to a relevant finding and set findingRefs to an array containing ONLY IDs from the provided FINDINGS list; numbers may ONLY be quoted from FINDINGS evidence; never invent statistics, rankings, percentages, prices, or competitor claims.';

type ChatMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ChatMessageContent;
}

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function extractMessageText(data: OpenAICompatibleResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    return fencedMatch[1].trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `- ${path}: ${issue.message}`;
    })
    .join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeForNumberMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1')
    .replace(/(\d)\s+(%|(?:ms|s|mb|kb|gb)\b)/gi, '$1$2');
}

const QUARTER_LABEL_REGEX = /\bQ[1-4]\b/g;
const NUMERIC_TOKEN_REGEX =
  /(?<![A-Za-z0-9.])\d[\d,]*(?:\.\d+)?(?:\s*(?:%|ms\b|s\b|mb\b|kb\b|gb\b))?/gi;

export interface NumberGroundingViolation {
  location: string;
  sceneIndex?: number;
  outcomeIndex?: number;
  findingRef?: string;
  token: string;
}

export interface NumberGroundingResult {
  valid: boolean;
  violations: NumberGroundingViolation[];
  offendingSceneIndices: number[];
}

export function validateNumbersGrounded(
  output: WalkthroughData,
  allowedText: string
): NumberGroundingResult {
  const normalizedAllowed = normalizeForNumberMatch(allowedText || '');
  const violations: NumberGroundingViolation[] = [];
  const sceneIndexSet = new Set<number>();

  const isTokenGrounded = (rawToken: string): boolean => {
    const compact = rawToken.toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
    if (!compact) return true;
    if (compact === '2027') return true;
    const matcher = new RegExp(`(?:^|[^0-9.])${escapeRegExp(compact)}(?![0-9.%])`, 'i');
    return matcher.test(normalizedAllowed);
  };

  const scanText = (
    text: string,
    meta: { location: string; sceneIndex?: number; outcomeIndex?: number; findingRef?: string }
  ) => {
    const withoutQuarters = text.replace(QUARTER_LABEL_REGEX, ' ');
    const matches = withoutQuarters.match(NUMERIC_TOKEN_REGEX);
    if (!matches) return;
    for (const token of matches) {
      if (!isTokenGrounded(token)) {
        violations.push({
          location: meta.location,
          sceneIndex: meta.sceneIndex,
          outcomeIndex: meta.outcomeIndex,
          findingRef: meta.findingRef,
          token: token.trim(),
        });
        if (meta.sceneIndex !== undefined) {
          sceneIndexSet.add(meta.sceneIndex);
        }
      }
    }
  };

  output.scenes.forEach((scene, idx) => {
    scanText(scene.caption, { location: `scenes[${idx}].caption`, sceneIndex: idx });
    scanText(scene.narration, { location: `scenes[${idx}].narration`, sceneIndex: idx });
  });

  output.outcomes.forEach((outcome, idx) => {
    scanText(outcome.description, {
      location: `outcomes[${idx}].description`,
      outcomeIndex: idx,
      findingRef: outcome.findingRef,
    });
  });

  // Map outcome-only violations to matching scene(s) referencing that findingRef (or fallback scene index)
  for (const v of violations) {
    if (v.sceneIndex === undefined && v.outcomeIndex !== undefined) {
      let matchedAnyScene = false;
      if (v.findingRef) {
        output.scenes.forEach((scene, sIdx) => {
          if (scene.findingRefs?.includes(v.findingRef!)) {
            sceneIndexSet.add(sIdx);
            matchedAnyScene = true;
          }
        });
      }
      if (!matchedAnyScene && output.scenes.length > 0) {
        sceneIndexSet.add(Math.min(v.outcomeIndex, output.scenes.length - 1));
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    offendingSceneIndices: Array.from(sceneIndexSet).sort((a, b) => a - b),
  };
}

export interface ModelOption {
  id: string;
  name: string;
  tier: 'free' | 'paid' | 'catalog';
  supportsVision: boolean | null;
  pricingLabel: string;
}

interface RawModelEntry {
  id?: string;
  name?: string;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
  };
}

async function fetchWithCorsFallback(
  url: string,
  method: 'GET' | 'POST',
  apiKey: string,
  body?: unknown,
  captureToken = ''
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }
  if (apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  try {
    return await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch (directErr) {
    // Relay external HTTPS endpoints (e.g. NVIDIA NIM) if browser CORS blocks direct fetch
    if (/^https:\/\//i.test(url)) {
      const relayHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (captureToken.trim()) {
        relayHeaders.Authorization = `Bearer ${captureToken.trim()}`;
      }
      return await fetch('/api/relay', {
        method: 'POST',
        headers: relayHeaders,
        body: JSON.stringify({
          url,
          method,
          apiKey: apiKey.trim(),
          body,
        }),
      });
    }
    throw directErr;
  }
}

export async function fetchAvailableModels(
  baseUrl: string,
  apiKey = '',
  captureToken = ''
): Promise<ModelOption[]> {
  const cleanBase = normalizeBaseUrl(baseUrl);
  if (!cleanBase) {
    throw new Error('Enter a Base URL before refreshing models.');
  }

  const url = `${cleanBase}/models`;
  const response = await fetchWithCorsFallback(url, 'GET', apiKey, undefined, captureToken);
  const text = await response.text();

  let parsed: { data?: RawModelEntry[]; error?: { message?: string } } | null = null;
  try {
    parsed = JSON.parse(text) as { data?: RawModelEntry[]; error?: { message?: string } };
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const errMsg = parsed?.error?.message || text || response.statusText;
    throw new Error(`Could not fetch models (${response.status}): ${errMsg}`);
  }

  const rawList = Array.isArray(parsed?.data) ? parsed.data : [];
  if (rawList.length === 0) {
    throw new Error('The provider returned an empty models list.');
  }

  const isNvidia = /integrate\.api\.nvidia\.com/i.test(cleanBase);

  return rawList
    .filter((entry): entry is RawModelEntry & { id: string } => typeof entry.id === 'string' && entry.id.length > 0)
    .map((entry) => {
      const id = entry.id;
      const name = (entry.name && entry.name.trim()) || id;

      let tier: ModelOption['tier'] = 'catalog';
      let pricingLabel = isNvidia ? 'NIM Catalog' : 'Provider';

      if (entry.pricing && (entry.pricing.prompt !== undefined || entry.pricing.completion !== undefined)) {
        const promptNum = Number(entry.pricing.prompt ?? 0);
        const completionNum = Number(entry.pricing.completion ?? 0);
        if (promptNum === 0 && completionNum === 0) {
          tier = 'free';
          pricingLabel = 'Free';
        } else {
          tier = 'paid';
          const perMillion = promptNum * 1_000_000;
          pricingLabel = perMillion > 0 ? `$${perMillion.toFixed(2)}/1M` : 'Paid';
        }
      } else if (/:free$/i.test(id)) {
        tier = 'free';
        pricingLabel = 'Free';
      } else if (isNvidia) {
        tier = 'catalog';
        pricingLabel = 'Free credits / Paid';
      }

      let supportsVision: boolean | null = null;
      if (Array.isArray(entry.architecture?.input_modalities)) {
        supportsVision = entry.architecture.input_modalities.includes('image');
      } else if (typeof entry.architecture?.modality === 'string') {
        supportsVision = entry.architecture.modality.includes('image');
      } else if (/vision|vl|vlm|omni|nemotron.*vl|cosmos|pixtral|qwen.*vl|llama-3\.2.*11b|llama-3\.2.*90b|llama-4/i.test(id)) {
        supportsVision = true;
      }

      return {
        id,
        name,
        tier,
        supportsVision,
        pricingLabel,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function callChatCompletions(
  settings: AISettings,
  messages: ChatMessage[],
  maxTokens = 2400
): Promise<string> {
  const url = `${normalizeBaseUrl(settings.baseUrl)}/chat/completions`;

  const response = await fetchWithCorsFallback(
    url,
    'POST',
    settings.apiKey,
    {
      model: settings.model.trim(),
      temperature: 0.35,
      max_tokens: maxTokens,
      messages,
    },
    settings.captureToken
  );

  const text = await response.text();
  let parsed: OpenAICompatibleResponse | null = null;
  try {
    parsed = JSON.parse(text) as OpenAICompatibleResponse;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const serverMessage = parsed?.error?.message || text || response.statusText;
    if (/image input|does not support image|image_url|multimodal/i.test(serverMessage)) {
      throw new Error(
        `Model "${settings.model.trim()}" does not support image inputs (${serverMessage}). Open Settings, keep "Vision capable only" checked, and choose a Vision model.`
      );
    }
    throw new Error(`Provider returned ${response.status}: ${serverMessage}`);
  }

  if (!parsed) {
    throw new Error('The AI provider returned a non-JSON HTTP response.');
  }

  const content = extractMessageText(parsed);
  if (!content.trim()) {
    throw new Error('The AI provider returned an empty completion.');
  }

  return content;
}

export async function testAIConnection(settings: AISettings): Promise<{ ok: boolean; message: string }> {
  if (!settings.baseUrl.trim()) {
    return { ok: false, message: 'Enter a Base URL before testing.' };
  }
  if (!settings.apiKey.trim()) {
    return { ok: false, message: 'Enter an API key before testing.' };
  }
  if (!settings.model.trim()) {
    return { ok: false, message: 'Enter a model name before testing.' };
  }

  try {
    const reply = await callChatCompletions(
      settings,
      [{ role: 'user', content: 'Reply with exactly: OK' }],
      16
    );
    return {
      ok: true,
      message: `Connected cleanly to ${settings.model.trim()} (received: "${reply.trim().slice(0, 40)}").`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Connection failed.',
    };
  }
}

export interface GenerateTourOptions {
  settings: AISettings;
  project: ProjectBrief;
  screenshots: ScreenshotAsset[];
  pageFacts?: PageFacts | null;
  findings?: AuditFinding[];
  onStage?: (stage: string) => void;
  completeChat?: (messages: Array<{ role: string; content: unknown }>) => Promise<string>;
}

export async function generateWalkthrough({
  settings,
  project,
  screenshots,
  pageFacts,
  findings = [],
  onStage,
  completeChat,
}: GenerateTourOptions): Promise<WalkthroughData> {
  const nonPassFindings = findings
    .filter((f) => f.status === 'fail' || f.status === 'warn')
    .slice(0, 6);
  const validFindingIds = nonPassFindings.map((f) => f.id);
  const schema = createWalkthroughSchema(screenshots.length - 1, validFindingIds);

  const schemaPrompt =
    validFindingIds.length > 0
      ? `{
  "title": string,
  "scenes": [{
    "screenshotIndex": number (integer from 0 to ${screenshots.length - 1}),
    "narration": string (max 30 words, business outcome first then what they see; final scene ends with a line about growing digitally into 2027),
    "caption": string (short outcome-first headline tied to a finding),
    "highlight": { "x": 0-100, "y": 0-100, "w": 1-100, "h": 1-100 },
    "findingRefs": string[] (optional array containing ONLY IDs from FINDINGS: ${validFindingIds.join(', ')})
  }],
  "outcomes": [{ "title": string, "description": string, "findingRef": string (optional ID from FINDINGS) }],
  "roadmap": [
    { "quarter": "Q1", "items": string[] },
    { "quarter": "Q2", "items": string[] },
    { "quarter": "Q3", "items": string[] },
    { "quarter": "Q4", "items": string[] }
  ]
}`
      : `{
  "title": string,
  "scenes": [{
    "screenshotIndex": number (integer from 0 to ${screenshots.length - 1}),
    "narration": string (max 30 words, business outcome first then what they see; final scene ends with a line about growing digitally into 2027),
    "caption": string (short outcome-first headline),
    "highlight": { "x": 0-100, "y": 0-100, "w": 1-100, "h": 1-100 }
  }],
  "outcomes": [{ "title": string, "description": string }],
  "roadmap": [
    { "quarter": "Q1", "items": string[] },
    { "quarter": "Q2", "items": string[] },
    { "quarter": "Q3", "items": string[] },
    { "quarter": "Q4", "items": string[] }
  ]
}`;

  const pageFactsSection = pageFacts
    ? [
        '',
        'Captured Page Facts (from the live website):',
        JSON.stringify(
          {
            title: pageFacts.title,
            description: pageFacts.description,
            headings: pageFacts.headings,
            ctas: pageFacts.ctas,
          },
          null,
          2
        ),
      ].join('\n')
    : '';

  const findingsSection =
    nonPassFindings.length > 0
      ? [
          '',
          'FINDINGS (measured audit evidence — quote numbers ONLY from these lines):',
          JSON.stringify(
            nonPassFindings.map((f) => ({
              id: f.id,
              label: f.label,
              status: f.status,
              evidence: f.evidence,
              businessImpact: f.businessImpact,
            })),
            null,
            2
          ),
        ].join('\n')
      : '';

  const allowedNumberText = [
    project.brief,
    ...(nonPassFindings.length > 0 ? nonPassFindings.map((f) => f.evidence) : findings.map((f) => f.evidence)),
    pageFacts?.title || '',
    pageFacts?.description || '',
    ...(pageFacts?.headings || []),
    ...(pageFacts?.ctas || []),
  ]
    .filter(Boolean)
    .join('\n');

  const userContent: ChatMessageContent = [
    {
      type: 'text',
      text: [
        `Client Name: ${project.clientName.trim()}`,
        `Business Type: ${project.businessType.trim()}`,
        `Short Brief: ${project.brief.trim()}`,
        `Screenshots Attached: ${screenshots.length} (indexed 0 through ${screenshots.length - 1}, in the exact order attached below).`,
        pageFactsSection,
        findingsSection,
        '',
        'Create at least one scene per screenshot (between 3 and 6 scenes total) and a 2027 Q1-Q4 roadmap.',
        'Return ONLY raw JSON (no markdown fences, no commentary) matching this exact schema:',
        schemaPrompt,
      ].join('\n'),
    },
  ];

  screenshots.forEach((shot, index) => {
    userContent.push({
      type: 'text',
      text: `Screenshot ${index} (${shot.name}):`,
    });
    userContent.push({
      type: 'image_url',
      image_url: { url: shot.dataUrl },
    });
  });

  const systemPrompt =
    nonPassFindings.length > 0
      ? `${TOUR_SYSTEM_PROMPT}${TOUR_FINDINGS_SYSTEM_RULES}`
      : TOUR_SYSTEM_PROMPT;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  const runCompletion = (msgs: ChatMessage[]): Promise<string> =>
    completeChat ? completeChat(msgs) : callChatCompletions(settings, msgs);

  onStage?.('Sending screenshots and brief to your AI model...');
  const firstRaw = await runCompletion(messages);

  const attachReadOnlyEvidence = (data: WalkthroughData): WalkthroughData => {
    if (nonPassFindings.length === 0) return data;
    const byId = new Map(nonPassFindings.map((f) => [f.id, f]));
    return {
      ...data,
      outcomes: data.outcomes.map((outcome, idx) => {
        const matched =
          (outcome.findingRef && byId.get(outcome.findingRef)) ||
          nonPassFindings[idx % nonPassFindings.length];
        if (!matched) return outcome;
        return {
          ...outcome,
          findingRef: matched.id,
          evidence: `${matched.label}: ${matched.evidence}`,
        };
      }),
    };
  };

  const parseSchemaOnly = (raw: string): { data?: WalkthroughData; errorText?: string } => {
    const cleaned = stripJsonFences(raw);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(cleaned);
    } catch (jsonErr) {
      return {
        errorText: `Invalid JSON syntax: ${jsonErr instanceof Error ? jsonErr.message : 'Unable to parse JSON.'}`,
      };
    }

    const result = schema.safeParse(parsedJson);
    if (!result.success) {
      return {
        errorText: `Schema validation failed:\n${formatZodIssues(result.error)}`,
      };
    }

    return { data: attachReadOnlyEvidence(result.data) };
  };

  const firstAttempt = parseSchemaOnly(firstRaw);
  let retryErrorText = firstAttempt.errorText;
  if (firstAttempt.data) {
    const grounding = validateNumbersGrounded(firstAttempt.data, allowedNumberText);
    if (grounding.valid) {
      return firstAttempt.data;
    }
    retryErrorText = [
      'Ungrounded numbers detected. Quote numbers ONLY from FINDINGS evidence, the brief, pageFacts, the year 2027, or Q1-Q4:',
      ...grounding.violations.map((v) => `- ${v.location}: "${v.token}"`),
    ].join('\n');
  }

  // Retry exactly once, sending back validation / number-grounding errors
  onStage?.('Response needed grounding or formatting fixes — retrying once...');
  const retryMessages: ChatMessage[] = [
    ...messages,
    { role: 'assistant', content: firstRaw },
    {
      role: 'user',
      content: [
        'Your previous response did not pass validation:',
        retryErrorText || 'Unknown validation error.',
        '',
        `Remember: screenshotIndex must be an integer between 0 and ${screenshots.length - 1}, highlight x/y/w/h must be numbers between 0 and 100 (w and h >= 1), roadmap quarters must be "Q1", "Q2", "Q3", or "Q4"${
          validFindingIds.length > 0
            ? `, and scene findingRefs may ONLY contain IDs from: ${validFindingIds.join(', ')}`
            : ''
        }. Every number, percentage, or measurement must come directly from the provided FINDINGS evidence, brief, pageFacts, or be 2027 / Q1-Q4. Return ONLY valid JSON matching the schema with no markdown code fences.`,
      ].join('\n'),
    },
  ];

  const secondRaw = await runCompletion(retryMessages);
  const secondAttempt = parseSchemaOnly(secondRaw);
  if (secondAttempt.data) {
    const retryGrounding = validateNumbersGrounded(secondAttempt.data, allowedNumberText);
    if (retryGrounding.valid) {
      return secondAttempt.data;
    }
    const offendingSet = new Set(retryGrounding.offendingSceneIndices);
    return {
      ...secondAttempt.data,
      scenes: secondAttempt.data.scenes.map((scene, idx) =>
        offendingSet.has(idx) ? { ...scene, needsReview: true } : scene
      ),
    };
  }

  throw new Error(
    `Could not validate model output after retry.\n${secondAttempt.errorText ?? ''}`
  );
}
