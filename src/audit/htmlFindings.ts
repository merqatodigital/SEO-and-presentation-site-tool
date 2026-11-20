import * as cheerio from 'cheerio';
import {
  AuditFinding,
  ParsedHtmlFacts,
  ParsedLinks,
  SpeedMetrics,
} from './types';

export const BUSINESS_SCHEMA_TYPES = new Set([
  'LocalBusiness',
  'Hotel',
  'LodgingBusiness',
  'Resort',
  'Restaurant',
  'CafeOrCoffeeShop',
  'MedicalClinic',
  'TravelAgency',
  'TouristAttraction',
  'Store',
]);

const CTA_PATTERN =
  /\b(?:book\s+a\s+call|book|booking|reserve|reservation|availability|check\s+rates|inquire|enquire|contact\s+us|get\s+in\s+touch|request\s+a\s+quote|get\s+a\s+quote|call\s+us|message\s+us|start\s+a\s+project|magpa-?book|mag-?reserve)\b/i;

const CHAT_HREF_CTA_PATTERN =
  /(?:^|\/\/)(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|(?:www\.)?(?:m\.me|messenger\.com))\b|^viber:\/\//i;

export function cleanTitleToBrandName(rawTitle: string): string {
  const title = rawTitle.replace(/\s+/g, ' ').trim();
  if (!title) return '';
  const separators = [' — ', ' | ', ' - '];
  let cutIndex = -1;
  for (const sep of separators) {
    const idx = title.indexOf(sep);
    if (idx > 0 && (cutIndex === -1 || idx < cutIndex)) {
      cutIndex = idx;
    }
  }
  return (cutIndex > 0 ? title.slice(0, cutIndex) : title).trim();
}

export function extractDomainLabel(rawUrl?: string | null): string {
  if (!rawUrl || !rawUrl.trim()) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`);
    return u.hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

export function deriveClientName(options: {
  explicitClientName?: string | null;
  ogSiteName?: string | null;
  pageTitle?: string | null;
  fallbackUrl?: string | null;
  defaultLabel?: string;
}): string {
  const explicit = (options.explicitClientName || '').trim();
  const ogSiteName = (options.ogSiteName || '').trim();
  const pageTitle = (options.pageTitle || '').trim();
  const strippedTitle = pageTitle ? cleanTitleToBrandName(pageTitle) : '';

  // Never keep a raw full page title if it equals the unsplit pageTitle containing separators
  const explicitIsRawTitle =
    Boolean(explicit && pageTitle && explicit === pageTitle && strippedTitle && strippedTitle !== pageTitle);

  if (explicit && !explicitIsRawTitle) {
    // Also guard against a separator-heavy explicit name when it was copied from a page title
    if (pageTitle && explicit === pageTitle && ogSiteName) {
      return ogSiteName;
    }
    return explicit;
  }

  if (ogSiteName) return ogSiteName;
  if (strippedTitle) return strippedTitle;

  const domain = extractDomainLabel(options.fallbackUrl);
  if (domain) return domain;

  return options.defaultLabel ?? 'Client Website';
}

function collectJsonLdTypes(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdTypes(item, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  const rawType = obj['@type'];
  if (typeof rawType === 'string' && rawType.trim()) {
    out.add(rawType.trim());
  } else if (Array.isArray(rawType)) {
    for (const t of rawType) {
      if (typeof t === 'string' && t.trim()) out.add(t.trim());
    }
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') {
      collectJsonLdTypes(val, out);
    }
  }
}

export function parseHtmlWithCheerio(html: string): ParsedHtmlFacts {
  const $ = cheerio.load(html);

  const title = $('head > title').first().text().replace(/\s+/g, ' ').trim();
  const metaDescription = (
    $('meta[name="description"]').attr('content') ||
    $('meta[name="Description"]').attr('content') ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();

  const canonical = $('link[rel="canonical"]').attr('href')?.trim() || null;
  const viewport = $('meta[name="viewport"]').attr('content')?.trim() || null;
  const htmlLang = $('html').attr('lang')?.trim() || null;

  const h1Count = $('h1').length;
  const h2Count = $('h2').length;

  const headings: string[] = [];
  const seenHeadings = new Set<string>();
  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length >= 2 && text.length <= 140 && !seenHeadings.has(text)) {
      seenHeadings.add(text);
      if (headings.length < 16) headings.push(text);
    }
  });

  const ogSiteName = $('meta[property="og:site_name"]').attr('content')?.trim() || null;
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || null;
  const ogDescription = $('meta[property="og:description"]').attr('content')?.trim() || null;
  const ogImage = $('meta[property="og:image"]').attr('content')?.trim() || null;

  const imgs = $('img');
  let imagesMissingAlt = 0;
  imgs.each((_, el) => {
    const alt = $(el).attr('alt');
    if (alt === undefined || alt.trim() === '') {
      imagesMissingAlt++;
    }
  });

  const jsonLdTypesSet = new Set<string>();
  let jsonLdInvalidCount = 0;
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html() || $(el).text() || '';
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      collectJsonLdTypes(parsed, jsonLdTypesSet);
    } catch {
      jsonLdInvalidCount++;
    }
  });

  const links: ParsedLinks = {
    tel: [],
    mailto: [],
    whatsapp: [],
    messenger: [],
    viber: [],
    facebook: [],
    instagram: [],
    tiktok: [],
    tripadvisor: [],
    bookingCom: [],
    agoda: [],
    airbnb: [],
    mapLinks: [],
  };

  const pushUnique = (arr: string[], value: string) => {
    if (value && !arr.includes(value) && arr.length < 25) {
      arr.push(value);
    }
  };

  const ctaTexts: string[] = [];
  const seenCtas = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    const lower = href.toLowerCase();

    if (lower.startsWith('tel:')) pushUnique(links.tel, href);
    else if (lower.startsWith('mailto:')) pushUnique(links.mailto, href);
    else if (lower.startsWith('viber://')) pushUnique(links.viber, href);

    if (/(?:^|\/\/)(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\b/i.test(href)) {
      pushUnique(links.whatsapp, href);
    }
    if (/(?:^|\/\/)(?:www\.)?(?:m\.me|messenger\.com)\b/i.test(href)) {
      pushUnique(links.messenger, href);
    }
    if (/(?:^|\/\/)(?:www\.|m\.|mbasic\.)?facebook\.com\b/i.test(href)) {
      pushUnique(links.facebook, href);
    }
    if (/(?:^|\/\/)(?:www\.)?instagram\.com\b/i.test(href)) {
      pushUnique(links.instagram, href);
    }
    if (/(?:^|\/\/)(?:www\.)?tiktok\.com\b/i.test(href)) {
      pushUnique(links.tiktok, href);
    }
    if (/tripadvisor\./i.test(href)) {
      pushUnique(links.tripadvisor, href);
    }
    if (/(?:^|\/\/)(?:www\.)?booking\.com\b/i.test(href)) {
      pushUnique(links.bookingCom, href);
    }
    if (/(?:^|\/\/)(?:www\.)?agoda\.com\b/i.test(href)) {
      pushUnique(links.agoda, href);
    }
    if (/airbnb\./i.test(href)) {
      pushUnique(links.airbnb, href);
    }

    if (/maps\.app\.goo\.gl|goo\.gl\/maps|^https?:\/\/maps\.|^https?:\/\/[^/]+\/maps(?:\/|\?|$)/i.test(href)) {
      pushUnique(links.mapLinks, href);
    }

    const visibleText = $(el).text().replace(/\s+/g, ' ').trim();
    const isChatDirectCta = CHAT_HREF_CTA_PATTERN.test(href) && visibleText.length > 0;
    if (
      visibleText &&
      visibleText.length <= 80 &&
      (CTA_PATTERN.test(visibleText) || isChatDirectCta) &&
      !seenCtas.has(visibleText)
    ) {
      seenCtas.add(visibleText);
      ctaTexts.push(visibleText);
    }
  });

  $('button, [role="button"], input[type="submit"], input[type="button"]').each((_, el) => {
    const raw =
      el.tagName?.toLowerCase() === 'input'
        ? $(el).attr('value') || ''
        : $(el).text() || '';
    const visibleText = raw.replace(/\s+/g, ' ').trim();
    if (
      visibleText &&
      visibleText.length <= 80 &&
      CTA_PATTERN.test(visibleText) &&
      !seenCtas.has(visibleText)
    ) {
      seenCtas.add(visibleText);
      ctaTexts.push(visibleText);
    }
  });

  const formCount = $('form').length;

  return {
    title,
    titleLength: title.length,
    metaDescription,
    metaDescriptionLength: metaDescription.length,
    canonical,
    viewport,
    htmlLang,
    h1Count,
    h2Count,
    headings,
    ogSiteName,
    ogTitle,
    ogDescription,
    ogImage,
    imagesTotal: imgs.length,
    imagesMissingAlt,
    jsonLdTypes: Array.from(jsonLdTypesSet),
    jsonLdInvalidCount,
    links,
    formCount,
    ctaTexts: ctaTexts.slice(0, 16),
  };
}

export interface BuildAutomatedFindingsInput {
  isHttps: boolean | null;
  fetchError: string | null;
  ttfbMs?: number | null;
  ttfbSampleCount?: number;
  parsed: ParsedHtmlFacts | null;
  robotsTxt: { exists: boolean | null; allowsIndexing: boolean | null; reason?: string };
  sitemapXml: { exists: boolean | null; reason?: string };
  speed: SpeedMetrics | null;
  speedReason: string | null;
}

export function buildAutomatedFindings(input: BuildAutomatedFindingsInput): AuditFinding[] {
  const {
    isHttps,
    fetchError,
    ttfbMs,
    ttfbSampleCount,
    parsed,
    robotsTxt,
    sitemapXml,
    speed,
    speedReason,
  } = input;
  const findings: AuditFinding[] = [];
  const unreachableMsg = fetchError || 'Page HTML could not be retrieved';
  const speedFallback = speedReason || 'Speed test did not complete';

  // --- SPEED & MOBILE ---
  const hasTtfb = typeof ttfbMs === 'number' && Number.isFinite(ttfbMs);
  const roundedTtfb = hasTtfb ? Math.round(ttfbMs) : null;
  const sampleCount = ttfbSampleCount && ttfbSampleCount > 0 ? ttfbSampleCount : 3;
  findings.push({
    id: 'server-ttfb',
    category: 'speed',
    label: 'Server response time (TTFB)',
    status:
      roundedTtfb === null
        ? 'unknown'
        : roundedTtfb <= 800
        ? 'pass'
        : roundedTtfb <= 1800
        ? 'warn'
        : 'fail',
    evidence:
      roundedTtfb !== null
        ? `Median TTFB ${roundedTtfb} ms (${sampleCount} requests)`
        : unreachableMsg,
    fix: 'Enable full-page server caching, optimize slow backend queries, or use a nearby CDN.',
    businessImpact:
      'Slow initial server responses delay every screen before photos or booking buttons can even load.',
    weight: 2,
  });
  const perfScore = speed?.scores.performance ?? null;
  findings.push({
    id: 'speed-performance',
    category: 'speed',
    label: 'Mobile performance score',
    status:
      perfScore === null
        ? 'unknown'
        : perfScore >= 80
        ? 'pass'
        : perfScore >= 50
        ? 'warn'
        : 'fail',
    evidence: perfScore === null ? speedFallback : `Performance ${perfScore}/100`,
    fix: 'Compress hero images, defer non-critical scripts, and enable server caching.',
    businessImpact:
      'Slow mobile pages make impatient visitors tap the back button before reading your offer.',
    weight: 4,
  });

  const lcpSec = speed?.lcpMs !== null && speed?.lcpMs !== undefined ? speed.lcpMs / 1000 : null;
  findings.push({
    id: 'speed-lcp',
    category: 'speed',
    label: 'Main content load time (LCP)',
    status:
      lcpSec === null
        ? 'unknown'
        : lcpSec <= 2.5
        ? 'pass'
        : lcpSec <= 4.0
        ? 'warn'
        : 'fail',
    evidence: lcpSec === null ? speedFallback : `LCP ${lcpSec.toFixed(1)} s`,
    fix: 'Optimize above-the-fold images and serve preloaded fonts so the main headline appears within 2.5 seconds.',
    businessImpact:
      'When the main screen takes over 4 seconds to appear, prospects abandon the site before seeing your call to action.',
    weight: 5,
  });

  const cls = speed?.cls ?? null;
  findings.push({
    id: 'speed-cls',
    category: 'speed',
    label: 'Visual stability (CLS)',
    status:
      cls === null ? 'unknown' : cls <= 0.1 ? 'pass' : cls <= 0.25 ? 'warn' : 'fail',
    evidence: cls === null ? speedFallback : `CLS ${cls.toFixed(2)}`,
    fix: 'Set explicit width and height attributes on all images, embeds, and banners.',
    businessImpact:
      'Jumping buttons and shifting layouts frustrate mobile visitors trying to tap your booking link.',
    weight: 2,
  });

  const tbtMs = speed?.tbtMs ?? null;
  findings.push({
    id: 'speed-tbt',
    category: 'speed',
    label: 'Page responsiveness (TBT)',
    status:
      tbtMs === null ? 'unknown' : tbtMs <= 200 ? 'pass' : tbtMs <= 600 ? 'warn' : 'fail',
    evidence: tbtMs === null ? speedFallback : `TBT ${Math.round(tbtMs)} ms`,
    fix: 'Trim heavy third-party widgets and chat scripts that lock up the browser on initial load.',
    businessImpact:
      'Unresponsive buttons make visitors think the booking form or menu is broken.',
    weight: 2,
  });

  const totalBytes = speed?.totalByteWeight ?? null;
  const totalMb = totalBytes !== null ? totalBytes / (1024 * 1024) : null;
  findings.push({
    id: 'speed-page-weight',
    category: 'speed',
    label: 'Total mobile page weight',
    status:
      totalMb === null
        ? 'unknown'
        : totalMb <= 1.5
        ? 'pass'
        : totalMb <= 3.0
        ? 'warn'
        : 'fail',
    evidence: totalMb === null ? speedFallback : `Page weight ${totalMb.toFixed(2)} MB`,
    fix: 'Convert uncompressed photos to WebP/AVIF and remove unused videos or scripts under 1.5 MB total.',
    businessImpact:
      'Heavy multi-megabyte pages stall on mobile data connections common among travelers.',
    weight: 3,
  });

  findings.push({
    id: 'mobile-viewport',
    category: 'speed',
    label: 'Mobile viewport tag present',
    status: !parsed
      ? 'unknown'
      : parsed.viewport && /width\s*=\s*device-width/i.test(parsed.viewport)
      ? 'pass'
      : parsed.viewport
      ? 'warn'
      : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : parsed.viewport
      ? `Viewport: ${parsed.viewport}`
      : 'No <meta name="viewport"> tag',
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the document head.',
    businessImpact:
      'Without a mobile viewport tag, smartphone users must pinch and zoom tiny desktop text.',
    weight: 4,
  });

  findings.push({
    id: 'speed-images-alt',
    category: 'speed',
    label: 'Image alt descriptions',
    status: !parsed
      ? 'unknown'
      : parsed.imagesTotal === 0 || parsed.imagesMissingAlt === 0
      ? 'pass'
      : parsed.imagesMissingAlt <= Math.max(2, Math.floor(parsed.imagesTotal * 0.2))
      ? 'warn'
      : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : `${parsed.imagesMissingAlt} of ${parsed.imagesTotal} images missing alt text`,
    fix: 'Write concise descriptive alt attributes for every photo showcasing rooms, dishes, or services.',
    businessImpact:
      'Missing image descriptions hurt accessibility and prevent your photos from appearing in image search.',
    weight: 2,
  });

  // --- ON-PAGE SEO & STRUCTURED DATA ---
  findings.push({
    id: 'seo-title-length',
    category: 'seo',
    label: 'Page title length (30–60 chars)',
    status: !parsed
      ? 'unknown'
      : parsed.titleLength >= 30 && parsed.titleLength <= 60
      ? 'pass'
      : parsed.titleLength > 0 && parsed.titleLength <= 75
      ? 'warn'
      : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : parsed.titleLength === 0
      ? 'Title tag missing (0 chars)'
      : `${parsed.titleLength} chars ("${parsed.title.slice(0, 48)}${parsed.title.length > 48 ? '...' : ''}")`,
    fix: 'Write a clear 30–60 character page title naming your business, primary offer, and location.',
    businessImpact:
      'The page title is the first line prospects see in search results before deciding to click.',
    weight: 4,
  });

  findings.push({
    id: 'seo-meta-description',
    category: 'seo',
    label: 'Meta description length (70–160 chars)',
    status: !parsed
      ? 'unknown'
      : parsed.metaDescriptionLength >= 70 && parsed.metaDescriptionLength <= 160
      ? 'pass'
      : parsed.metaDescriptionLength > 0 && parsed.metaDescriptionLength <= 200
      ? 'warn'
      : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : parsed.metaDescriptionLength === 0
      ? 'Meta description missing (0 chars)'
      : `${parsed.metaDescriptionLength} chars`,
    fix: 'Add a 70–160 character meta description summarizing why customers should book directly with you.',
    businessImpact:
      'Without a tailored summary, search engines display random page snippets that fail to sell your value.',
    weight: 3,
  });

  findings.push({
    id: 'seo-h1-single',
    category: 'seo',
    label: 'Single main headline (H1)',
    status: !parsed
      ? 'unknown'
      : parsed.h1Count === 1
      ? 'pass'
      : parsed.h1Count > 1
      ? 'warn'
      : 'fail',
    evidence: !parsed ? unreachableMsg : `${parsed.h1Count} H1 tags, ${parsed.h2Count} H2 tags`,
    fix: 'Use one clear H1 headline at the top of the page stating what you offer and where you serve.',
    businessImpact:
      'Search engines and hurried visitors rely on one clear main headline to understand what you do immediately.',
    weight: 3,
  });

  findings.push({
    id: 'seo-canonical',
    category: 'seo',
    label: 'Canonical URL tag',
    status: !parsed ? 'unknown' : parsed.canonical ? 'pass' : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : parsed.canonical
      ? `Canonical: ${parsed.canonical}`
      : 'No <link rel="canonical"> tag',
    fix: 'Add a self-referencing canonical link tag pointing to your preferred primary URL.',
    businessImpact:
      'Missing canonical tags can split authority across duplicate www, trailing-slash, or tracking URLs.',
    weight: 2,
  });

  findings.push({
    id: 'seo-https',
    category: 'seo',
    label: 'HTTPS secure connection',
    status: isHttps === null ? 'unknown' : isHttps ? 'pass' : 'fail',
    evidence: isHttps === null ? unreachableMsg : isHttps ? 'HTTPS active' : 'Not served over HTTPS',
    fix: 'Install an SSL certificate and redirect all HTTP traffic permanently to HTTPS.',
    businessImpact:
      'Browsers warn visitors "Not Secure" on non-HTTPS sites, scaring away customers before they submit inquiries.',
    weight: 5,
  });

  findings.push({
    id: 'seo-robots',
    category: 'seo',
    label: 'robots.txt crawlable',
    status:
      robotsTxt.exists === null
        ? 'unknown'
        : robotsTxt.allowsIndexing === false
        ? 'fail'
        : robotsTxt.exists
        ? 'pass'
        : 'warn',
    evidence:
      robotsTxt.exists === null
        ? robotsTxt.reason || 'robots.txt could not be checked'
        : robotsTxt.allowsIndexing === false
        ? 'robots.txt contains blanket Disallow: /'
        : robotsTxt.exists
        ? 'robots.txt present and allows indexing'
        : 'No robots.txt file (HTTP 404)',
    fix:
      robotsTxt.allowsIndexing === false
        ? 'Remove the blanket "Disallow: /" rule in robots.txt so search engines can index your site.'
        : 'Publish a clean /robots.txt referencing your sitemap.xml URL.',
    businessImpact:
      robotsTxt.allowsIndexing === false
        ? 'A blanket Disallow rule hides your entire website from search results.'
        : 'A clear robots.txt guides automated crawlers cleanly to your booking pages.',
    weight: 4,
  });

  findings.push({
    id: 'seo-sitemap',
    category: 'seo',
    label: 'sitemap.xml present',
    status: sitemapXml.exists === null ? 'unknown' : sitemapXml.exists ? 'pass' : 'fail',
    evidence:
      sitemapXml.exists === null
        ? sitemapXml.reason || 'sitemap.xml could not be checked'
        : sitemapXml.exists
        ? 'sitemap.xml detected'
        : 'No /sitemap.xml found',
    fix: 'Generate and publish an XML sitemap at /sitemap.xml listing every core service and booking page.',
    businessImpact:
      'Without a sitemap, new offers, rooms, or seasonal packages take much longer to be discovered.',
    weight: 2,
  });

  findings.push({
    id: 'seo-jsonld-present',
    category: 'seo',
    label: 'Structured data (JSON-LD) present',
    status: !parsed
      ? 'unknown'
      : parsed.jsonLdTypes.length > 0 && parsed.jsonLdInvalidCount === 0
      ? 'pass'
      : parsed.jsonLdTypes.length > 0 && parsed.jsonLdInvalidCount > 0
      ? 'warn'
      : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : parsed.jsonLdTypes.length === 0 && parsed.jsonLdInvalidCount === 0
      ? 'No JSON-LD blocks detected'
      : parsed.jsonLdInvalidCount > 0
      ? `${parsed.jsonLdInvalidCount} invalid JSON-LD block(s); valid types: ${parsed.jsonLdTypes.join(', ') || 'none'}`
      : `Valid JSON-LD types: ${parsed.jsonLdTypes.join(', ')}`,
    fix: 'Embed valid Schema JSON-LD on your homepage describing your business, hours, address, and FAQs.',
    businessImpact:
      'Search engines and AI assistants rely on structured JSON-LD to quote verified hours, location, and services.',
    weight: 4,
  });

  const matchingBusinessTypes =
    parsed?.jsonLdTypes.filter((t) => BUSINESS_SCHEMA_TYPES.has(t)) || [];
  findings.push({
    id: 'seo-jsonld-business-type',
    category: 'seo',
    label: 'Business schema @type configured',
    status: !parsed
      ? 'unknown'
      : matchingBusinessTypes.length > 0
      ? 'pass'
      : parsed.jsonLdTypes.length > 0
      ? 'warn'
      : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : matchingBusinessTypes.length > 0
      ? `Business @type: ${matchingBusinessTypes.join(', ')}`
      : parsed.jsonLdTypes.length > 0
      ? `Found only generic @type (${parsed.jsonLdTypes.join(', ')})`
      : 'No business @type found',
    fix: 'Set JSON-LD @type to your specific business schema (e.g. LocalBusiness, Hotel, Restaurant, MedicalClinic).',
    businessImpact:
      'Generic WebSite schema alone does not identify your physical location or booking category.',
    weight: 3,
  });

  findings.push({
    id: 'seo-og-tags',
    category: 'seo',
    label: 'Open Graph social preview (og:title & og:image)',
    status: !parsed
      ? 'unknown'
      : parsed.ogTitle && parsed.ogImage
      ? 'pass'
      : parsed.ogTitle || parsed.ogImage
      ? 'warn'
      : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : `og:title=${parsed.ogTitle ? 'yes' : 'no'}, og:image=${parsed.ogImage ? 'yes' : 'no'}`,
    fix: 'Add og:title, og:description, and a high-resolution og:image so shared links show rich previews.',
    businessImpact:
      'Plain links without preview photos get far fewer clicks when shared in Messenger, WhatsApp, or Facebook.',
    weight: 2,
  });

  findings.push({
    id: 'seo-html-lang',
    category: 'seo',
    label: 'HTML language attribute set',
    status: !parsed ? 'unknown' : parsed.htmlLang ? 'pass' : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : parsed.htmlLang
      ? `lang="${parsed.htmlLang}"`
      : 'Missing lang attribute on <html>',
    fix: 'Add lang="en" (or primary site language) to the root <html> element.',
    businessImpact:
      'Screen readers and translation tools need the page language declared to assist international guests.',
    weight: 1,
  });

  // --- CONTACT & CONVERSION ---
  const telCount = parsed?.links.tel.length ?? 0;
  findings.push({
    id: 'contact-tel',
    category: 'contact',
    label: 'Click-to-call (tel:) link',
    status: !parsed ? 'unknown' : telCount > 0 ? 'pass' : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : telCount > 0
      ? `${telCount} tel: link(s) (${parsed.links.tel[0]})`
      : 'No clickable tel: link found',
    fix: 'Wrap your main phone number in a clickable <a href="tel:..."> link in the header and footer.',
    businessImpact:
      'Mobile callers leave when they have to copy-paste or manually dial plain-text phone numbers.',
    weight: 5,
  });

  const waCount = parsed?.links.whatsapp.length ?? 0;
  const msgCount = parsed?.links.messenger.length ?? 0;
  const viberCount = parsed?.links.viber.length ?? 0;
  const totalChatLinks = waCount + msgCount + viberCount;
  findings.push({
    id: 'contact-messaging',
    category: 'contact',
    label: 'Direct messaging link (WhatsApp / Messenger / Viber)',
    status: !parsed ? 'unknown' : totalChatLinks > 0 ? 'pass' : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : totalChatLinks > 0
      ? `WhatsApp=${waCount}, Messenger=${msgCount}, Viber=${viberCount}`
      : 'No WhatsApp, Messenger, or Viber link detected',
    fix: 'Add a prominent WhatsApp, Messenger, or Viber chat button for instant pre-booking questions.',
    businessImpact:
      'Local buyers strongly prefer quick chat over email forms and drop off if no chat app link is visible.',
    weight: 5,
  });

  const ctaCount = parsed?.ctaTexts.length ?? 0;
  findings.push({
    id: 'contact-booking-cta',
    category: 'contact',
    label: 'Clear booking / contact call-to-action',
    status: !parsed ? 'unknown' : ctaCount > 0 ? 'pass' : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : ctaCount > 0
      ? `Matched: ${parsed.ctaTexts.join(', ')}`
      : 'No matching booking or contact call-to-action text found',
    fix: 'Place a high-contrast "Book Now" or "Contact Us" button or chat link above the fold.',
    businessImpact:
      'Visitors hesitate or bounce when the primary next step to reserve or contact you is buried.',
    weight: 5,
  });

  const hasBookingOtaLink =
    (parsed?.links.bookingCom.length ?? 0) +
      (parsed?.links.agoda.length ?? 0) +
      (parsed?.links.airbnb.length ?? 0) >
    0;
  const hasFormOrBooking =
    (parsed?.formCount ?? 0) > 0 || ctaCount > 0 || hasBookingOtaLink;
  findings.push({
    id: 'contact-form-or-booking',
    category: 'contact',
    label: 'Lead capture form or booking path present',
    status: !parsed ? 'unknown' : hasFormOrBooking ? 'pass' : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : `${parsed.formCount} <form> element(s), ${ctaCount} booking CTA(s)`,
    fix: 'Embed a simple 3-field inquiry or direct booking widget so after-hours visitors can convert.',
    businessImpact:
      'Without an online form or booking path, overnight and weekend traffic turns into lost inquiries.',
    weight: 5,
  });

  // --- SOCIAL PROFILE LINKS ON SITE ---
  const fbSite = parsed?.links.facebook.length ?? 0;
  const igSite = parsed?.links.instagram.length ?? 0;
  const ttSite = parsed?.links.tiktok.length ?? 0;
  const totalSocialOnSite = fbSite + igSite + ttSite;
  findings.push({
    id: 'social-profile-links',
    category: 'social',
    label: 'Social profile links on website',
    status: !parsed ? 'unknown' : totalSocialOnSite > 0 ? 'pass' : 'fail',
    evidence: !parsed
      ? unreachableMsg
      : totalSocialOnSite > 0
      ? `Facebook=${fbSite}, Instagram=${igSite}, TikTok=${ttSite}`
      : 'No Facebook, Instagram, or TikTok links found',
    fix: 'Link verified Facebook, Instagram, or TikTok profiles cleanly in the site footer.',
    businessImpact:
      'Linking active social profiles lets cautious visitors verify recent activity and real customer photos.',
    weight: 2,
  });

  return findings;
}
