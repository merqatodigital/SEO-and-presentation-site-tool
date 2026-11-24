import { z } from 'zod';
import { buildAiReadinessSummary } from '../audit/aiReadiness';
import { computeGbpCompetitorBenchmark } from '../audit/gbpPlaybook';
import {
  AiMentionCheckResult,
  AiMentionCheckResultSchema,
  AuditFinding,
  AuditResult,
  ManualFootprint,
  Scorecard,
  SiteAnalysisReport,
  SiteAnalysisReportSchema,
} from '../audit/types';
import {
  AISearchLayerData,
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

export interface OllamaDetectionResult {
  reachable: boolean;
  baseUrl: string;
  models: ModelOption[];
  error?: string;
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

interface RawOllamaTagEntry {
  name?: string;
  model?: string;
  size?: number;
  details?: {
    family?: string;
    families?: string[] | null;
    parameter_size?: string;
    quantization_level?: string;
  };
}

export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';

export function isOllamaBaseUrl(baseUrl: string): boolean {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):11434(?:\/|$)/i.test(baseUrl.trim());
}

export function getEffectiveAnalysisModel(settings: AISettings): string {
  return settings.analysisModel?.trim() || settings.model.trim();
}

export function getProviderLabel(settings: AISettings): string {
  if (isOllamaBaseUrl(settings.baseUrl)) return 'Local Ollama';
  if (/integrate\.api\.nvidia\.com/i.test(settings.baseUrl)) return 'NVIDIA NIM';
  if (/openrouter\.ai/i.test(settings.baseUrl)) {
    const model = getEffectiveAnalysisModel(settings);
    return /:free$/i.test(model) || settings.providerPreset === 'openrouter-free'
      ? 'OpenRouter Free'
      : 'OpenRouter';
  }
  return 'Custom OpenAI-Compatible';
}

function inferOllamaSupportsVision(id: string, families?: string[] | null): boolean {
  const familyStr = Array.isArray(families) ? families.join(' ').toLowerCase() : '';
  return (
    /(?:vision|llava|minicpm-v|qwen2\.5vl|qwen2-vl|qwen3-vl|llama3\.2-vision|gemma3|bakllava|moondream|pixtral|-vl\b|mllama)/i.test(
      id
    ) || /(?:clip|mllama|vision|vl)/i.test(familyStr)
  );
}

function formatBytesToGb(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function parseOllamaTagsToModels(rawModels: RawOllamaTagEntry[]): ModelOption[] {
  return rawModels
    .map((entry): ModelOption | null => {
      const id = (entry.model || entry.name || '').trim();
      if (!id) return null;
      const paramSize = entry.details?.parameter_size?.trim();
      const sizeStr = paramSize || formatBytesToGb(entry.size);
      const supportsVision = inferOllamaSupportsVision(id, entry.details?.families);
      return {
        id,
        name: id,
        tier: 'free',
        supportsVision,
        pricingLabel: sizeStr ? `Local · ${sizeStr}` : 'Local · Free',
      };
    })
    .filter((m): m is ModelOption => Boolean(m))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function detectLocalOllama(captureToken = ''): Promise<OllamaDetectionResult> {
  const tryParseTags = async (res: Response): Promise<ModelOption[]> => {
    const text = await res.text();
    const parsed = JSON.parse(text) as { models?: RawOllamaTagEntry[] };
    return Array.isArray(parsed.models) ? parseOllamaTagsToModels(parsed.models) : [];
  };

  // 1. Try direct localhost Ollama HTTP endpoint (fast 1.8s probe)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    const directRes = await fetch('http://127.0.0.1:11434/api/tags', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (directRes.ok) {
      const models = await tryParseTags(directRes);
      return {
        reachable: true,
        baseUrl: OLLAMA_DEFAULT_BASE_URL,
        models,
      };
    }
  } catch {
    // Fallback to server-side local Ollama bridge
  } finally {
    clearTimeout(timer);
  }

  // 2. Try server-side local Ollama bridge (/api/ollama/tags)
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (captureToken.trim()) {
      headers.Authorization = `Bearer ${captureToken.trim()}`;
    }
    const bridgeRes = await fetch('/api/ollama/tags', {
      method: 'GET',
      headers,
    });
    if (bridgeRes.ok) {
      const models = await tryParseTags(bridgeRes);
      return {
        reachable: true,
        baseUrl: OLLAMA_DEFAULT_BASE_URL,
        models,
      };
    }
    const errText = await bridgeRes.text().catch(() => '');
    return {
      reachable: false,
      baseUrl: OLLAMA_DEFAULT_BASE_URL,
      models: [],
      error: errText || `Local Ollama not detected (HTTP ${bridgeRes.status}).`,
    };
  } catch {
    return {
      reachable: false,
      baseUrl: OLLAMA_DEFAULT_BASE_URL,
      models: [],
      error: 'Local Ollama service was not detected on port 11434.',
    };
  }
}

async function fetchWithCorsFallback(
  url: string,
  method: 'GET' | 'POST',
  apiKey: string,
  body?: unknown,
  captureToken = ''
): Promise<Response> {
  const isOllama = isOllamaBaseUrl(url);
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }
  if (!isOllama && apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  try {
    return await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch (directErr) {
    const bridgeHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (captureToken.trim()) {
      bridgeHeaders.Authorization = `Bearer ${captureToken.trim()}`;
    }

    if (isOllama) {
      if (method === 'GET') {
        return await fetch('/api/ollama/tags', {
          method: 'GET',
          headers: bridgeHeaders,
        });
      }
      return await fetch('/api/ollama/chat', {
        method: 'POST',
        headers: bridgeHeaders,
        body: JSON.stringify(body ?? {}),
      });
    }

    // Relay external HTTPS endpoints (e.g. NVIDIA NIM) if browser CORS blocks direct fetch
    if (/^https:\/\//i.test(url)) {
      return await fetch('/api/relay', {
        method: 'POST',
        headers: bridgeHeaders,
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

  if (isOllamaBaseUrl(cleanBase)) {
    const detected = await detectLocalOllama(captureToken);
    if (!detected.reachable) {
      throw new Error(
        detected.error ||
          'Local Ollama is not running on port 11434. Start Ollama locally to list installed models.'
      );
    }
    if (detected.models.length === 0) {
      throw new Error(
        'Ollama is running, but no models are installed yet. Run e.g. "ollama pull qwen2.5:7b" or "ollama pull llama3.2-vision".'
      );
    }
    return detected.models;
  }

  const url = `${cleanBase}/models`;
  const response = await fetchWithCorsFallback(url, 'GET', apiKey, undefined, captureToken);
  const text = await response.text();

  let parsed: { data?: RawModelEntry[]; models?: RawOllamaTagEntry[]; error?: { message?: string } } | null =
    null;
  try {
    parsed = JSON.parse(text) as {
      data?: RawModelEntry[];
      models?: RawOllamaTagEntry[];
      error?: { message?: string };
    };
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const errMsg = parsed?.error?.message || text || response.statusText;
    throw new Error(`Could not fetch models (${response.status}): ${errMsg}`);
  }

  if (Array.isArray(parsed?.models) && parsed.models.length > 0 && !Array.isArray(parsed?.data)) {
    return parseOllamaTagsToModels(parsed.models);
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
  maxTokens = 2400,
  modelOverride?: string,
  temperature = 0.35
): Promise<string> {
  const cleanBase = normalizeBaseUrl(settings.baseUrl);
  const url = `${cleanBase}/chat/completions`;
  const targetModel = (modelOverride ?? settings.model).trim();

  const response = await fetchWithCorsFallback(
    url,
    'POST',
    settings.apiKey,
    {
      model: targetModel,
      temperature,
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
        `Model "${targetModel}" does not support image inputs (${serverMessage}). Open Settings and choose a Vision model for Walkthrough generation.`
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

export async function testAIConnection(
  settings: AISettings,
  modelOverride?: string
): Promise<{ ok: boolean; message: string }> {
  if (!settings.baseUrl.trim()) {
    return { ok: false, message: 'Enter a Base URL before testing.' };
  }
  const isLocalOllama = isOllamaBaseUrl(settings.baseUrl);
  if (!isLocalOllama && !settings.apiKey.trim()) {
    return { ok: false, message: 'Enter an API key before testing.' };
  }
  const targetModel = (modelOverride ?? settings.model).trim();
  if (!targetModel) {
    return { ok: false, message: 'Select or enter a model name before testing.' };
  }

  try {
    const reply = await callChatCompletions(
      settings,
      [{ role: 'user', content: 'Reply with exactly: OK' }],
      16,
      targetModel
    );
    return {
      ok: true,
      message: `Connected cleanly to ${targetModel} (received: "${reply.trim().slice(0, 40)}").`,
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

// ---------------------------------------------------------------------------
// Live AI Brand Mention Check (ChatGPT / OpenRouter / NIM / Ollama)
// ---------------------------------------------------------------------------

const MentionResponseSchema = z.object({
  results: z
    .array(
      z.object({
        query: z.string().min(1),
        clientMentioned: z.boolean(),
        citedDomain: z.boolean(),
        competitorsMentioned: z.array(z.string()).default([]),
        summary: z.string().min(1),
      })
    )
    .min(1),
});

export interface RunAiBrandMentionCheckOptions {
  settings: AISettings;
  project: ProjectBrief;
  audit: AuditResult | null;
  aiSearchLayer: AISearchLayerData;
  completeChat?: (messages: Array<{ role: string; content: string }>) => Promise<string>;
}

export function buildBuyerDiscoveryQueries(
  project: ProjectBrief,
  aiSearchLayer: AISearchLayerData
): string[] {
  const businessType = project.businessType.trim() || 'local business';
  const rawArea = aiSearchLayer.serviceArea.trim();
  const location =
    rawArea && rawArea.toLowerCase() !== 'local & surrounding service area'
      ? rawArea
      : 'local area';

  return [
    `Best ${businessType} in ${location} — who should I book with and why?`,
    `Top-rated ${businessType} near ${location} for direct booking without extra middleman fees`,
    `Compare trusted ${businessType} options in ${location} (services, contact, booking)`,
  ];
}

export async function runAiBrandMentionCheck({
  settings,
  project,
  audit,
  aiSearchLayer,
  completeChat,
}: RunAiBrandMentionCheckOptions): Promise<AiMentionCheckResult> {
  const modelId = getEffectiveAnalysisModel(settings);
  if (!modelId) {
    throw new Error('Choose an AI model in Settings before running the Brand Mention Check.');
  }

  const clientName = project.clientName.trim() || 'Client Business';
  const targetUrl = audit?.finalUrl || project.websiteUrl || aiSearchLayer.websiteUrl || '';
  let targetDomain = '';
  if (targetUrl) {
    try {
      targetDomain = new URL(/^https?:\/\//i.test(targetUrl) ? targetUrl : `https://${targetUrl}`).hostname;
    } catch {
      targetDomain = targetUrl;
    }
  }

  const queries = buildBuyerDiscoveryQueries(project, aiSearchLayer);
  const searchCapable = /:online\b|\bsonar\b/i.test(modelId);
  const searchCaveat = searchCapable
    ? `Live web search is enabled via ${modelId}; citations reflect current web index results.`
    : `Model "${modelId}" uses training memory without live web browsing. Switch to an OpenRouter ":online" or Perplexity Sonar model in Settings for real-time web citations.`;

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You evaluate whether an AI assistant currently recognizes and recommends a specific local business when answering buyer discovery queries. Do NOT pretend to recommend the client if you would not naturally recall or see them; be completely honest. Return ONLY valid JSON matching the schema.',
    },
    {
      role: 'user',
      content: [
        `Target business to check for: "${clientName}"${targetDomain ? ` (domain: ${targetDomain})` : ''}`,
        `Category: ${project.businessType.trim() || 'Local business'}`,
        `Area: ${aiSearchLayer.serviceArea.trim() || 'Local area'}`,
        '',
        'Evaluate these 3 buyer queries as a customer asking an AI assistant today:',
        ...queries.map((q, idx) => `${idx + 1}. ${q}`),
        '',
        'For each query, report honestly:',
        '- clientMentioned (boolean: would you confidently name this business without being prompted by the user?)',
        '- citedDomain (boolean: would you include or verify their official domain?)',
        '- competitorsMentioned (string[]: up to 4 competitor or OTA platform names you would typically mention for that query)',
        '- summary (string: 1-2 plain sentences summarizing what a buyer sees and why the client was or was not recommended)',
        '',
        'Return ONLY raw JSON (no markdown fences):',
        '{ "results": [{ "query": string, "clientMentioned": boolean, "citedDomain": boolean, "competitorsMentioned": string[], "summary": string }] }',
      ].join('\n'),
    },
  ];

  const raw = completeChat
    ? await completeChat(messages.map((m) => ({ role: m.role, content: String(m.content) })))
    : await callChatCompletions(settings, messages, 1400, modelId, 0.25);

  const parsedJson = JSON.parse(stripJsonFences(raw)) as unknown;
  const validated = MentionResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new Error(`Invalid AI Mention Check JSON:\n${formatZodIssues(validated.error)}`);
  }

  const results = validated.data.results.slice(0, 3);
  const mentionedCount = results.filter((r) => r.clientMentioned).length;
  const overallVisibility: AiMentionCheckResult['overallVisibility'] =
    mentionedCount >= 2 ? 'visible' : mentionedCount === 1 ? 'partial' : 'not-mentioned';

  const normalized = AiMentionCheckResultSchema.parse({
    checkedAt: new Date().toISOString(),
    modelId,
    searchCapable,
    searchCaveat,
    overallVisibility,
    results,
  });

  return normalized;
}

// ---------------------------------------------------------------------------
// AI Site Analysis Agent (Executive Report Grounded in Measured Audit Facts)
// ---------------------------------------------------------------------------

const SiteReportPayloadSchema = SiteAnalysisReportSchema.omit({
  generatedAt: true,
  modelId: true,
  providerLabel: true,
  needsReview: true,
});

export function validateReportNumbersGrounded(
  report: z.infer<typeof SiteReportPayloadSchema>,
  allowedText: string
): { valid: boolean; violations: string[] } {
  const normalizedAllowed = normalizeForNumberMatch(allowedText || '');
  const violations: string[] = [];

  const isTokenGrounded = (rawToken: string): boolean => {
    const compact = rawToken.toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
    if (!compact) return true;
    if (compact === '2027' || compact === '30' || compact === '90' || compact === '100') {
      return true;
    }
    const matcher = new RegExp(`(?:^|[^0-9.])${escapeRegExp(compact)}(?![0-9.%])`, 'i');
    return matcher.test(normalizedAllowed);
  };

  const scan = (text: string) => {
    const withoutQuarters = text.replace(QUARTER_LABEL_REGEX, ' ');
    const matches = withoutQuarters.match(NUMERIC_TOKEN_REGEX);
    if (!matches) return;
    for (const token of matches) {
      if (!isTokenGrounded(token)) {
        violations.push(token.trim());
      }
    }
  };

  scan(report.executiveSummary);
  report.biggestRevenueLeaks.forEach(scan);
  scan(report.aiVisibilityVerdict);
  scan(report.gbpActionSummary);
  report.quickWins30Days.forEach(scan);
  report.strategic90Days.forEach(scan);
  scan(report.clientPitchAngle);

  return {
    valid: violations.length === 0,
    violations: Array.from(new Set(violations)),
  };
}

export interface RunSiteAnalysisAgentOptions {
  settings: AISettings;
  project: ProjectBrief;
  audit: AuditResult | null;
  scorecard: Scorecard;
  manualFootprint: ManualFootprint;
  aiSearchLayer: AISearchLayerData;
  aiMentionCheck?: AiMentionCheckResult | null;
  pageFacts?: PageFacts | null;
  onStage?: (stage: string) => void;
  completeChat?: (messages: Array<{ role: string; content: string }>) => Promise<string>;
}

export async function runSiteAnalysisAgent({
  settings,
  project,
  audit,
  scorecard,
  manualFootprint,
  aiSearchLayer,
  aiMentionCheck,
  pageFacts,
  onStage,
  completeChat,
}: RunSiteAnalysisAgentOptions): Promise<SiteAnalysisReport> {
  const modelId = getEffectiveAnalysisModel(settings);
  if (!modelId) {
    throw new Error('Select an AI Analysis model (OpenRouter Free/Paid, NIM, or Local Ollama) in Settings first.');
  }

  const clientName =
    manualFootprint.nap.businessName.trim() ||
    project.clientName.trim() ||
    audit?.parsed?.ogSiteName ||
    'Client Business';

  const aiReadinessSummary = buildAiReadinessSummary(audit);
  const gbpBenchmark = computeGbpCompetitorBenchmark(manualFootprint, clientName);

  const nonPassFindings = scorecard.allFindings
    .filter((f) => f.status === 'fail' || f.status === 'warn')
    .slice(0, 12);

  const groundTruthPayload = {
    clientName,
    businessType: project.businessType.trim() || 'Local Business',
    websiteUrl: audit?.finalUrl || project.websiteUrl || aiSearchLayer.websiteUrl || '',
    brief: project.brief.trim(),
    scorecard: {
      overallScore: scorecard.overallScore,
      grade: scorecard.grade,
      dataCompletenessPct: scorecard.dataCompletenessPct,
      isProvisional: scorecard.isProvisional,
      categories: scorecard.categories.map((c) => ({
        label: c.label,
        score: c.score,
        insufficientData: c.insufficientData,
        knownCount: c.knownCount,
        totalCount: c.totalCount,
      })),
    },
    topFindings: nonPassFindings.map((f) => ({
      id: f.id,
      label: f.label,
      status: f.status,
      evidence: f.evidence,
      fix: f.fix,
      businessImpact: f.businessImpact,
    })),
    aiReadiness: {
      score: aiReadinessSummary.score,
      allowedBotsCount: aiReadinessSummary.allowedBotsCount,
      blockedBotsCount: aiReadinessSummary.blockedBotsCount,
      totalBotsCount: aiReadinessSummary.totalBotsCount,
      llmsStatus: aiReadinessSummary.llmsStatus,
      entityFieldsPresent: aiReadinessSummary.entityFieldsPresent,
      entityFieldsTotal: aiReadinessSummary.entityFieldsTotal,
      items: aiReadinessSummary.items.map((i) => ({
        label: i.label,
        status: i.status,
        detail: i.detail,
      })),
    },
    aiMentionCheck: aiMentionCheck
      ? {
          overallVisibility: aiMentionCheck.overallVisibility,
          results: aiMentionCheck.results.map((r) => ({
            query: r.query,
            clientMentioned: r.clientMentioned,
            citedDomain: r.citedDomain,
          })),
        }
      : null,
    gbpAndCompetitors: {
      clientReviews: manualFootprint.gbp.reviewCount,
      clientRating: manualFootprint.gbp.averageRating,
      clientPhotos: manualFootprint.gbp.photoCount,
      clientPosts90d: manualFootprint.gbp.postsLast90Days,
      competitorSummary: gbpBenchmark.summaryLine,
      topCompetitorName: gbpBenchmark.topCompetitorName,
      topCompetitorReviews: gbpBenchmark.topCompetitorReviews,
      reviewGapToLeader: gbpBenchmark.reviewGapToLeader,
      avgCompetitorPhotos: gbpBenchmark.avgCompetitorPhotos,
    },
    ignoredLeads: scorecard.ignoredLeads.visible
      ? {
          inquiriesLostRange: `${scorecard.ignoredLeads.inquiriesLostLow}-${scorecard.ignoredLeads.inquiriesLostHigh}`,
          effectiveLossPct: scorecard.ignoredLeads.effectiveLossPct,
        }
      : null,
  };

  const allowedNumberText = [
    JSON.stringify(groundTruthPayload),
    ...scorecard.allFindings.map((f) => `${f.label}: ${f.evidence}`),
    pageFacts?.title || '',
    pageFacts?.description || '',
    ...(pageFacts?.headings || []),
    ...(pageFacts?.ctas || []),
  ]
    .filter(Boolean)
    .join('\n');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are a senior digital agency strategist preparing an internal audit briefing and client pitch summary.',
        'Ground every statement strictly in the measured JSON evidence provided.',
        'NEVER invent numbers, percentages, review counts, traffic estimates, or rankings not explicitly present in the provided JSON (you may reference 30-day and 90-day phases or 2027).',
        'Write crisp, specific, business-outcome prose — zero fluff. Return ONLY valid JSON matching the schema.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Measured Client Audit & Visibility Evidence:',
        JSON.stringify(groundTruthPayload, null, 2),
        '',
        'Produce an agency analysis report as ONLY raw JSON (no markdown fences) with these exact fields:',
        '{',
        '  "executiveSummary": string (3-4 crisp sentences summarizing overall digital health and opportunity),',
        '  "biggestRevenueLeaks": string[] (2-4 concrete leaks grounded directly in findings/evidence),',
        '  "aiVisibilityVerdict": string (2-3 sentences covering AI bots, /llms.txt, schema completeness, and brand mention visibility),',
        '  "gbpActionSummary": string (2-3 sentences covering Google Business Profile state & competitor review/photo gap),',
        '  "quickWins30Days": string[] (3-4 immediate fixes achievable in 30 days),',
        '  "strategic90Days": string[] (3-4 compounding upgrades for the 90-day horizon),',
        '  "clientPitchAngle": string (1-2 sentence opening hook tailored to win this business owner)',
        '}',
      ].join('\n'),
    },
  ];

  const runCompletion = (msgs: ChatMessage[]) =>
    completeChat
      ? completeChat(msgs.map((m) => ({ role: m.role, content: String(m.content) })))
      : callChatCompletions(settings, msgs, 2200, modelId, 0.25);

  onStage?.(`Running analysis agent (${modelId})...`);
  const firstRaw = await runCompletion(messages);

  const parseReport = (raw: string) => {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stripJsonFences(raw));
    } catch (err) {
      return {
        errorText: `Invalid JSON: ${err instanceof Error ? err.message : 'parse failed'}`,
      };
    }
    const res = SiteReportPayloadSchema.safeParse(parsedJson);
    if (!res.success) {
      return { errorText: `Schema validation failed:\n${formatZodIssues(res.error)}` };
    }
    return { data: res.data };
  };

  const firstAttempt = parseReport(firstRaw);
  let retryReason = firstAttempt.errorText;
  if (firstAttempt.data) {
    const grounding = validateReportNumbersGrounded(firstAttempt.data, allowedNumberText);
    if (grounding.valid) {
      return SiteAnalysisReportSchema.parse({
        ...firstAttempt.data,
        generatedAt: new Date().toISOString(),
        modelId,
        providerLabel: getProviderLabel(settings),
      });
    }
    retryReason = `Ungrounded numbers detected: ${grounding.violations.join(', ')}. Use ONLY numbers explicitly present in the evidence JSON (plus 30/90/2027).`;
  }

  onStage?.('Grounding report numbers — verifying once...');
  const retryMessages: ChatMessage[] = [
    ...messages,
    { role: 'assistant', content: firstRaw },
    {
      role: 'user',
      content: `${retryReason || 'Invalid format.'}\n\nFix and return ONLY valid raw JSON matching the exact schema.`,
    },
  ];

  const secondRaw = await runCompletion(retryMessages);
  const secondAttempt = parseReport(secondRaw);
  if (secondAttempt.data) {
    const secondGrounding = validateReportNumbersGrounded(secondAttempt.data, allowedNumberText);
    return SiteAnalysisReportSchema.parse({
      ...secondAttempt.data,
      generatedAt: new Date().toISOString(),
      modelId,
      providerLabel: getProviderLabel(settings),
      needsReview: !secondGrounding.valid ? true : undefined,
    });
  }

  throw new Error(`Analysis agent failed validation after retry.\n${secondAttempt.errorText ?? ''}`);
}

export function siteAnalysisReportToMarkdown(
  report: SiteAnalysisReport,
  clientName: string,
  websiteUrl?: string
): string {
  return [
    `# Site Analysis Report — ${clientName || 'Client'}`,
    websiteUrl ? `- **Website:** ${websiteUrl}` : null,
    `- **Generated:** ${new Date(report.generatedAt).toLocaleString()}`,
    `- **Agent:** ${report.providerLabel} (${report.modelId})`,
    report.needsReview ? `- **Note:** Verify highlighted figures against the measured scorecard.` : null,
    '',
    '## Executive Summary',
    report.executiveSummary,
    '',
    '## Client Pitch Angle',
    `> ${report.clientPitchAngle}`,
    '',
    '## Biggest Revenue Leaks',
    ...report.biggestRevenueLeaks.map((item) => `- ${item}`),
    '',
    '## AI Search Visibility Verdict (ChatGPT / Claude / Perplexity)',
    report.aiVisibilityVerdict,
    '',
    '## Google Business Profile & Competitor Gap',
    report.gbpActionSummary,
    '',
    '## 30-Day Quick Wins',
    ...report.quickWins30Days.map((item) => `- [ ] ${item}`),
    '',
    '## 90-Day Strategic Plan',
    ...report.strategic90Days.map((item) => `- ${item}`),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
