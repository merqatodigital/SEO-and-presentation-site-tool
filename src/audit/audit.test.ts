import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuditResultSchema,
  AUDIT_CATEGORIES,
  createDefaultAssumptions,
  createEmptyManualFootprint,
  AuditResult,
} from './types';
import {
  addressTokenOverlap,
  compareListingNap,
  evaluateNapConsistency,
  manualFootprintToFindings,
  normalizeBusinessName,
  normalizePhone,
} from './nap';
import {
  buildAutomatedFindings,
  cleanTitleToBrandName,
  deriveClientName,
  evaluateHostSwitch,
  inspectHtmlContent,
  parseHtmlWithCheerio,
} from './htmlFindings';
import {
  AuditJobSkippedError,
  MAX_AUDIT_PENDING,
  enqueueAudit,
  executeFullSiteAudit,
  resolveHtmlContentAndFindings,
} from '../../serverAudit';
import {
  buildOutreachSummary,
  computeIgnoredLeadsEstimate,
  computeScorecard,
  getLetterGrade,
  getRagBand,
} from './scorecard';
import { buildValidatedJsonLd, selectJsonLdBusinessType } from './jsonLd';
import { migrateImportedBundle } from './bundleMigration';
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_PRICING_TIERS,
  WalkthroughData,
  buildDefaultAISearchLayer,
  buildDefaultPricingTiers,
  convertPricingTiersCurrency,
  createWalkthroughSchema,
} from '../types/tour';
import {
  generateWalkthrough,
  getEffectiveAnalysisModel,
  isOllamaBaseUrl,
  runAiBrandMentionCheck,
  runSiteAnalysisAgent,
  validateNumbersGrounded,
} from '../lib/aiClient';
import {
  buildAiReadinessSummary,
  parseRobotsAiBots,
} from './aiReadiness';
import {
  buildGbpActionPlaybook,
  computeGbpCompetitorBenchmark,
} from './gbpPlaybook';
import {
  SlidingWindowRateLimiter,
  SsrfBlockedError,
  isBearerTokenValid,
  isPrivateOrBlockedIp,
  parseAllowedRelayHosts,
  resolveServerOllamaOrigin,
  sanitizePlaywrightNavigationError,
  validatePublicTargetUrl,
  validateRelayUrlBeforeDns,
} from '../../serverShared';
import {
  buildAgentMarkdownReport,
  buildAgentOutputBundle,
  buildGeneratedRepoAssets,
  buildGitHubIssueBody,
  buildRepoChangeChecklist,
  buildSecurityHeaderSnippets,
} from './githubReport';
import {
  analyzePassiveSecurity,
  buildSecurityBadgeSnippet,
  buildSecurityBadgeSvg,
} from './securityFindings';
import { parseCliArgs } from '../../scripts/agent-audit';
import { handleJsonRpcMessage, handleMcpToolCall } from '../../scripts/mcp-server';

function makeMinimalAudit(findings: AuditResult['findings']): AuditResult {
  return {
    schemaVersion: '1.0',
    requestedUrl: 'https://example-resort.ph',
    finalUrl: 'https://example-resort.ph/',
    auditedAt: new Date().toISOString(),
    httpStatus: 200,
    ttfbMs: 180,
    htmlBytes: 24000,
    isHttps: true,
    fetchError: null,
    parsed: {
      title: 'Example Island Resort | Book Direct',
      titleLength: 35,
      metaDescription:
        'Book direct beachfront villas and island tours with instant WhatsApp confirmation.',
      metaDescriptionLength: 82,
      canonical: 'https://example-resort.ph/',
      viewport: 'width=device-width, initial-scale=1',
      htmlLang: 'en',
      h1Count: 1,
      h2Count: 3,
      headings: ['Example Island Resort'],
      ogSiteName: 'Example Island Resort',
      ogTitle: 'Example Island Resort',
      ogDescription: 'Beachfront villas',
      ogImage: 'https://example-resort.ph/hero.jpg',
      imagesTotal: 8,
      imagesMissingAlt: 0,
      jsonLdTypes: ['Hotel'],
      jsonLdInvalidCount: 0,
      links: {
        tel: ['tel:+639171234567'],
        mailto: ['mailto:stay@example-resort.ph'],
        whatsapp: ['https://wa.me/639171234567'],
        messenger: [],
        viber: [],
        facebook: ['https://facebook.com/exampleresort'],
        instagram: [],
        tiktok: [],
        tripadvisor: [],
        bookingCom: [],
        agoda: [],
        airbnb: [],
        mapLinks: [],
      },
      formCount: 1,
      ctaTexts: ['Book Now'],
    },
    robotsTxt: { exists: true, allowsIndexing: true },
    sitemapXml: { exists: true },
    speed: {
      scores: { performance: 85, seo: 92, accessibility: 88, bestPractices: 90 },
      fcpMs: 1400,
      lcpMs: 2200,
      cls: 0.04,
      tbtMs: 110,
      speedIndexMs: 2100,
      totalByteWeight: 950000,
      opportunities: [],
    },
    speedReason: null,
    findings,
  };
}

test('category weights sum strictly to 100', () => {
  const sum = AUDIT_CATEGORIES.reduce((acc, c) => acc + c.weight, 0);
  assert.equal(sum, 100);
});

test('RAG and letter grade boundaries match specification', () => {
  assert.equal(getRagBand(80), 'green');
  assert.equal(getRagBand(79), 'amber');
  assert.equal(getRagBand(50), 'amber');
  assert.equal(getRagBand(49), 'red');
  assert.equal(getRagBand(null), 'unknown');

  assert.equal(getLetterGrade(90), 'A');
  assert.equal(getLetterGrade(89), 'B');
  assert.equal(getLetterGrade(80), 'B');
  assert.equal(getLetterGrade(79), 'C');
  assert.equal(getLetterGrade(65), 'C');
  assert.equal(getLetterGrade(64), 'D');
  assert.equal(getLetterGrade(50), 'D');
  assert.equal(getLetterGrade(49), 'F');
  assert.equal(getLetterGrade(null), 'N/A');
});

test('computeScorecard renormalizes unknown categories and computes completeness', () => {
  const manual = createEmptyManualFootprint(); // all GBP/Social/NAP are unknown
  const assumptions = createDefaultAssumptions();
  const audit = makeMinimalAudit([
    {
      id: 'seo-https',
      category: 'seo',
      label: 'HTTPS',
      status: 'pass',
      evidence: 'HTTPS active',
      fix: 'None',
      businessImpact: 'Security',
      weight: 5,
    },
    {
      id: 'contact-tel',
      category: 'contact',
      label: 'tel:',
      status: 'fail',
      evidence: 'None',
      fix: 'Add tel:',
      businessImpact: 'Calls',
      weight: 5,
    },
    {
      id: 'speed-lcp',
      category: 'speed',
      label: 'LCP',
      status: 'unknown',
      evidence: 'Timeout',
      fix: 'Optimize',
      businessImpact: 'Speed',
      weight: 5,
    },
  ]);

  const card = computeScorecard(audit, manual, assumptions);
  // Active categories: seo (weight 20, score 100) and contact (weight 20, score 0)
  // Speed & gbp & social are all unknown -> effectiveWeight renormalizes seo & contact to 50% each
  const seoCat = card.categories.find((c) => c.id === 'seo');
  const contactCat = card.categories.find((c) => c.id === 'contact');
  const speedCat = card.categories.find((c) => c.id === 'speed');

  assert.equal(seoCat?.score, 100);
  assert.equal(seoCat?.effectiveWeight, 50);
  assert.equal(contactCat?.score, 0);
  assert.equal(contactCat?.effectiveWeight, 50);
  assert.equal(speedCat?.score, null);
  assert.equal(speedCat?.effectiveWeight, 0);
  assert.equal(card.overallScore, 50);
  assert.equal(card.rag, 'amber');
  assert.ok(card.dataCompletenessPct > 0 && card.dataCompletenessPct < 100);
  assert.equal(card.fixFirst[0]?.id, 'contact-tel');
});

test('NAP normalization handles +63 / 0917 formats, legal suffixes, and address token overlap', () => {
  assert.equal(normalizePhone('09171234567'), '09171234567');
  assert.equal(normalizePhone('+639171234567'), '09171234567');
  assert.equal(normalizePhone('0917 123 4567'), '09171234567');
  assert.equal(normalizePhone('63-917-123-4567'), '09171234567');

  assert.equal(
    normalizeBusinessName('Palawan Cove Resort, Inc.'),
    normalizeBusinessName('Palawan Cove Resort')
  );

  const overlapHigh = addressTokenOverlap(
    '123 Rizal St, Brgy Poblacion, El Nido, Palawan',
    '123 Rizal Street Barangay Poblacion El Nido Palawan'
  );
  assert.ok(overlapHigh >= 0.6, `Expected overlap >= 0.6, got ${overlapHigh}`);

  const overlapLow = addressTokenOverlap(
    '123 Rizal St, El Nido, Palawan',
    '99 Ayala Ave, Makati, Metro Manila'
  );
  assert.ok(overlapLow < 0.6);

  const manual = createEmptyManualFootprint();
  manual.nap = {
    businessName: 'Palawan Cove Resort Inc.',
    fullAddress: '123 Rizal St, Brgy Poblacion, El Nido, Palawan',
    phone: '+63 917 123 4567',
  };
  manual.listings[0] = {
    ...manual.listings[0],
    listed: 'yes',
    seenName: 'Palawan Cove Resort',
    seenAddress: '123 Rizal Street, Barangay Poblacion, El Nido, Palawan',
    seenPhone: '09171234567',
  };
  manual.listings[1] = {
    ...manual.listings[1],
    listed: 'yes',
    seenName: 'Palawan Cove Hotel',
    seenAddress: 'Different Beach Rd, Coron',
    seenPhone: '09189990000',
  };

  const matchCheck = compareListingNap(manual.nap, manual.listings[0]);
  assert.equal(matchCheck.overallStatus, 'match');

  const mismatchCheck = compareListingNap(manual.nap, manual.listings[1]);
  assert.equal(mismatchCheck.overallStatus, 'mismatch');
  assert.deepEqual(mismatchCheck.mismatchFields, ['Name', 'Address', 'Phone']);

  const summary = evaluateNapConsistency(manual);
  assert.equal(summary.checkedCount, 2);
  assert.equal(summary.matchedCount, 1);
  assert.equal(summary.mismatchedCount, 1);
});

test('manualFootprintToFindings applies deterministic thresholds for GBP reviews, rating, photos', () => {
  const manual = createEmptyManualFootprint();
  manual.gbp.reviewCount = 52;
  manual.gbp.averageRating = 4.2;
  manual.gbp.photoCount = 6;

  const findings = manualFootprintToFindings(manual, new Date('2026-06-01T00:00:00Z'));
  const reviews = findings.find((f) => f.id === 'gbp-reviews-count');
  const rating = findings.find((f) => f.id === 'gbp-rating');
  const photos = findings.find((f) => f.id === 'gbp-photos');

  assert.equal(reviews?.status, 'pass');
  assert.equal(rating?.status, 'warn');
  assert.equal(photos?.status, 'fail');
});

test('parseHtmlWithCheerio and buildAutomatedFindings check LCP thresholds, tel/wa, JSON-LD', () => {
  const sampleHtml = `<!doctype html>
  <html lang="en">
    <head>
      <title>El Nido Eco Suites | Beachfront Villas</title>
      <meta name="description" content="Direct beachfront eco suites in El Nido with airport pickup, island hopping tours, and instant chat reservations." />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="canonical" href="https://elnido-eco.example/" />
      <meta property="og:title" content="El Nido Eco Suites" />
      <meta property="og:image" content="https://elnido-eco.example/og.jpg" />
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Hotel","name":"El Nido Eco Suites"}</script>
    </head>
    <body>
      <h1>Beachfront Suites in El Nido</h1>
      <a href="tel:+639171234567">Call us</a>
      <a href="https://wa.me/639171234567">WhatsApp</a>
      <a href="https://facebook.com/elnidoeco">Facebook</a>
      <button>Book Now</button>
      <img src="/room.jpg" alt="Oceanfront suite" />
    </body>
  </html>`;

  const parsed = parseHtmlWithCheerio(sampleHtml);
  assert.equal(parsed.h1Count, 1);
  assert.deepEqual(parsed.jsonLdTypes, ['Hotel']);
  assert.equal(parsed.links.tel.length, 1);
  assert.equal(parsed.links.whatsapp.length, 1);
  assert.deepEqual(parsed.ctaTexts, ['Call us', 'WhatsApp', 'Book Now']);

  const findings = buildAutomatedFindings({
    isHttps: true,
    fetchError: null,
    ttfbMs: 650,
    ttfbSampleCount: 3,
    parsed,
    robotsTxt: { exists: true, allowsIndexing: true },
    sitemapXml: { exists: true },
    speed: {
      scores: { performance: 65, seo: 95, accessibility: 90, bestPractices: 92 },
      fcpMs: 1800,
      lcpMs: 4200, // > 4.0s => fail
      cls: 0.05,
      tbtMs: 150,
      speedIndexMs: 2600,
      totalByteWeight: 1200000,
      opportunities: [],
    },
    speedReason: null,
  });

  const lcp = findings.find((f) => f.id === 'speed-lcp');
  const perf = findings.find((f) => f.id === 'speed-performance');
  const jsonLd = findings.find((f) => f.id === 'seo-jsonld-business-type');
  const ttfb = findings.find((f) => f.id === 'server-ttfb');
  const cta = findings.find((f) => f.id === 'contact-booking-cta');

  assert.equal(lcp?.status, 'fail');
  assert.equal(perf?.status, 'warn');
  assert.equal(jsonLd?.status, 'pass');
  assert.equal(ttfb?.status, 'pass');
  assert.equal(ttfb?.weight, 2);
  assert.equal(ttfb?.evidence, 'Median TTFB 650 ms (3 requests)');
  assert.equal(cta?.label, 'Clear booking / contact call-to-action');
  assert.ok(cta?.evidence.includes('Call us') && cta?.evidence.includes('WhatsApp'));
});

test('selectJsonLdBusinessType and buildValidatedJsonLd never emit aggregateRating and produce valid JSON', () => {
  assert.equal(selectJsonLdBusinessType('Boutique Beach Resort'), 'Hotel');
  assert.equal(selectJsonLdBusinessType('Seafood Restaurant'), 'Restaurant');
  assert.equal(selectJsonLdBusinessType('Dental Clinic'), 'MedicalClinic');
  assert.equal(selectJsonLdBusinessType('General Plumbing'), 'LocalBusiness');

  const manual = createEmptyManualFootprint();
  manual.nap = {
    businessName: 'Coral Bay Resort',
    fullAddress: 'Corong-Corong, El Nido, Palawan',
    phone: '+63 917 555 0101',
  };
  manual.gbp.averageRating = 4.9;
  manual.gbp.reviewCount = 120;
  manual.openingHoursText = 'Daily 07:00-22:00';
  manual.priceRange = 'PHP 4,500 - PHP 12,000';

  const result = buildValidatedJsonLd(
    {
      clientName: 'Coral Bay Resort',
      businessType: 'Boutique Beach Resort',
      brief: 'Direct beachfront bookings',
      brandColor: '#0F766E',
      logoDataUrl: null,
    },
    {
      enabled: true,
      serviceArea: 'El Nido, Palawan',
      primaryOffer: 'Beachfront villas and private island tours',
      keyDifferentiator: 'Direct rate guarantee',
      websiteUrl: 'https://coralbay.example',
      contactInfo: 'WhatsApp & direct phone',
      faqs: [{ question: 'Do you include breakfast?', answer: 'Yes, daily breakfast is included.' }],
    },
    null,
    manual
  );

  assert.equal(result.valid, true);
  assert.equal(result.selectedType, 'Hotel');
  assert.equal(result.rawJson.includes('aggregateRating'), false);
  const parsed = JSON.parse(result.rawJson);
  assert.equal(parsed['@graph'][0]['@type'], 'Hotel');
  assert.equal(parsed['@graph'][1]['@type'], 'FAQPage');
});

test('computeIgnoredLeadsEstimate hides when monthlyVisitors is unknown and computes 0.6x-1.4x range when set', () => {
  const manual = createEmptyManualFootprint();
  const assumptions = createDefaultAssumptions();
  const findings = [
    {
      id: 'speed-lcp',
      category: 'speed' as const,
      label: 'LCP',
      status: 'fail' as const, // +10%
      evidence: '4.8s',
      fix: 'Compress',
      businessImpact: 'Bounce',
      weight: 5,
    },
    {
      id: 'contact-tel',
      category: 'contact' as const,
      label: 'tel:',
      status: 'fail' as const,
      evidence: 'None',
      fix: 'Add tel:',
      businessImpact: 'Calls',
      weight: 5,
    },
    {
      id: 'contact-messaging',
      category: 'contact' as const,
      label: 'messaging',
      status: 'fail' as const, // both tel + messaging fail => +10%
      evidence: 'None',
      fix: 'Add chat',
      businessImpact: 'Chat',
      weight: 5,
    },
  ];

  const hidden = computeIgnoredLeadsEstimate(findings, manual, assumptions);
  assert.equal(hidden.visible, false);
  assert.equal(hidden.effectiveLossPct, 20);

  assumptions.monthlyVisitors = 1000;
  assumptions.inquiryRatePct = 2; // 20 expected inquiries * 20% loss = 4 central lost
  assumptions.avgBookingValuePhp = 5000;
  const shown = computeIgnoredLeadsEstimate(findings, manual, assumptions);
  assert.equal(shown.visible, true);
  assert.equal(shown.inquiriesLostLow, 2.4); // 4 * 0.6
  assert.equal(shown.inquiriesLostHigh, 5.6); // 4 * 1.4
  assert.equal(shown.revenueLostPhpLow, 12000);
  assert.equal(shown.revenueLostPhpHigh, 28000);
});

test('migrateImportedBundle loads v1 JSON without audit fields and walkthrough schema validates findingRefs', () => {
  const v1Bundle = {
    exportedAt: '2026-01-01T00:00:00.000Z',
    project: {
      clientName: 'Old Export Client',
      businessType: 'Cafe',
      brief: 'Coffee shop',
      brandColor: '#112233',
      logoDataUrl: null,
    },
    walkthrough: {
      title: 'Old Walkthrough',
      scenes: [
        {
          screenshotIndex: 0,
          narration: 'Welcome to our cafe.',
          caption: 'Welcome',
          highlight: { x: 10, y: 10, w: 30, h: 20 },
        },
      ],
      outcomes: [{ title: 'More Foot Traffic', description: 'Clear menu online.' }],
      roadmap: [{ quarter: 'Q1', items: ['Launch menu'] }],
    },
    footprint: [],
    pricingTiers: [],
  };

  const migrated = migrateImportedBundle(v1Bundle);
  assert.equal(migrated.project?.clientName, 'Old Export Client');
  assert.equal(migrated.audit, null);
  assert.ok(migrated.manualFootprint);
  assert.ok(migrated.assumptions);

  const schema = createWalkthroughSchema(2, ['speed-lcp', 'contact-tel']);
  const valid = schema.safeParse({
    ...v1Bundle.walkthrough,
    scenes: [
      {
        ...v1Bundle.walkthrough.scenes[0],
        findingRefs: ['speed-lcp'],
      },
    ],
  });
  assert.equal(valid.success, true);

  const invalid = schema.safeParse({
    ...v1Bundle.walkthrough,
    scenes: [
      {
        ...v1Bundle.walkthrough.scenes[0],
        findingRefs: ['invented-finding-id'],
      },
    ],
  });
  assert.equal(invalid.success, false);
});

test('PATCH: <50% measured category shows Insufficient data and is excluded from overall score', () => {
  const manual = createEmptyManualFootprint();
  const assumptions = createDefaultAssumptions();
  // Social category will have 1 pass (social-profile-links) + 3 unknown (fb, ig, nap) = 25% < 50%
  const audit = makeMinimalAudit([
    {
      id: 'social-profile-links',
      category: 'social',
      label: 'Social links',
      status: 'pass',
      evidence: 'Facebook=1',
      fix: 'None',
      businessImpact: 'Proof',
      weight: 2,
    },
    {
      id: 'seo-https',
      category: 'seo',
      label: 'HTTPS',
      status: 'pass',
      evidence: 'HTTPS active',
      fix: 'None',
      businessImpact: 'Security',
      weight: 5,
    },
    {
      id: 'contact-tel',
      category: 'contact',
      label: 'tel:',
      status: 'fail',
      evidence: 'None',
      fix: 'Add tel:',
      businessImpact: 'Calls',
      weight: 5,
    },
  ]);

  const card = computeScorecard(audit, manual, assumptions);
  const socialCat = card.categories.find((c) => c.id === 'social');
  assert.equal(socialCat?.knownCount, 1);
  assert.equal(socialCat?.totalCount, 4);
  assert.equal(socialCat?.insufficientData, true);
  assert.equal(socialCat?.score, null);
  assert.equal(socialCat?.rag, 'unknown');
  assert.equal(socialCat?.effectiveWeight, 0);
  // Only seo (100, base 20) and contact (0, base 20) remain active -> overall 50
  assert.equal(card.overallScore, 50);
  assert.equal(card.isProvisional, true);

  const outreach = buildOutreachSummary('Example Island Resort', 'https://example-resort.ph', card);
  assert.equal(outreach.includes('[Provisional]'), false);
  assert.equal(outreach.includes('Add Google Business Profile data for a final grade.'), false);
  assert.ok(outreach.includes('50/100 (preliminary, based on your public website)'));
});

test('PATCH: TTFB thresholds (<=800 pass, <=1800 warn, >1800 fail) and expanded CTA & client name rules', () => {
  const html = `<!doctype html>
  <html lang="en">
    <head>
      <title>Boracay Sands — Official Beachfront Resort</title>
      <meta property="og:site_name" content="Boracay Sands" />
    </head>
    <body>
      <a href="https://m.me/boracaysands">Chat Messenger</a>
      <a href="/rates">Check Rates</a>
      <button>Magpa-book</button>
    </body>
  </html>`;

  const parsed = parseHtmlWithCheerio(html);
  assert.equal(parsed.ogSiteName, 'Boracay Sands');
  assert.deepEqual(parsed.ctaTexts, ['Chat Messenger', 'Check Rates', 'Magpa-book']);

  const warnTtfb = buildAutomatedFindings({
    isHttps: true,
    fetchError: null,
    ttfbMs: 1250,
    ttfbSampleCount: 3,
    parsed,
    robotsTxt: { exists: true, allowsIndexing: true },
    sitemapXml: { exists: true },
    speed: null,
    speedReason: 'Skipped',
  }).find((f) => f.id === 'server-ttfb');
  assert.equal(warnTtfb?.status, 'warn');
  assert.equal(warnTtfb?.evidence, 'Median TTFB 1250 ms (3 requests)');

  const failTtfb = buildAutomatedFindings({
    isHttps: true,
    fetchError: null,
    ttfbMs: 2100,
    ttfbSampleCount: 3,
    parsed,
    robotsTxt: { exists: true, allowsIndexing: true },
    sitemapXml: { exists: true },
    speed: null,
    speedReason: 'Skipped',
  }).find((f) => f.id === 'server-ttfb');
  assert.equal(failTtfb?.status, 'fail');

  assert.equal(cleanTitleToBrandName('Palawan Cove — Luxury Tours | El Nido'), 'Palawan Cove');
  assert.equal(cleanTitleToBrandName('Manila Bistro | Authentic Seafood'), 'Manila Bistro');
  assert.equal(cleanTitleToBrandName('Coron Dive Shop - Official Site'), 'Coron Dive Shop');

  assert.equal(
    deriveClientName({
      explicitClientName: 'Boracay Sands — Official Beachfront Resort',
      ogSiteName: 'Boracay Sands',
      pageTitle: 'Boracay Sands — Official Beachfront Resort',
      fallbackUrl: 'https://boracaysands.example',
    }),
    'Boracay Sands'
  );
  assert.equal(
    deriveClientName({
      ogSiteName: null,
      pageTitle: 'Palawan Cove | Beach Villas - El Nido',
      fallbackUrl: 'https://palawancove.example',
    }),
    'Palawan Cove'
  );
});

test('SECURITY: IPv6 SSRF forms, URL credentials, and non-web ports are blocked', async () => {
  // Direct IPv6 & IPv4-mapped IPv6 address classifier checks
  assert.equal(isPrivateOrBlockedIp('::1'), true);
  assert.equal(isPrivateOrBlockedIp('[::1]'), true);
  assert.equal(isPrivateOrBlockedIp('::'), true);
  assert.equal(isPrivateOrBlockedIp('::ffff:7f00:1'), true);
  assert.equal(isPrivateOrBlockedIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateOrBlockedIp('fe80::1'), true);
  assert.equal(isPrivateOrBlockedIp('fc00::1'), true);
  assert.equal(isPrivateOrBlockedIp('ff02::1'), true);
  assert.equal(isPrivateOrBlockedIp('2606:4700:4700::1111'), false);

  const blockedUrls = [
    'http://[::1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://user:pass@example.com/',
    'https://example.com:22/',
    'https://example.com:6379/',
    'https://example.com:8080/',
  ];

  for (const url of blockedUrls) {
    await assert.rejects(
      () => validatePublicTargetUrl(url),
      (err: unknown) => err instanceof SsrfBlockedError && err.statusCode === 403,
      `Expected 403 SsrfBlockedError for ${url}`
    );
  }

  const allowedIpv6 = await validatePublicTargetUrl('https://[2606:4700:4700::1111]:443/');
  assert.equal(allowedIpv6.hostname, '[2606:4700:4700::1111]');
});

test('SECURITY: constant-time bearer token compare and rate limiter pruning', () => {
  assert.equal(isBearerTokenValid('Bearer top-secret-token', 'top-secret-token'), true);
  assert.equal(isBearerTokenValid('bearer top-secret-token', 'top-secret-token'), true);
  assert.equal(isBearerTokenValid('Bearer wrong-token', 'top-secret-token'), false);
  assert.equal(isBearerTokenValid('Bearer short', 'top-secret-token'), false);
  assert.equal(isBearerTokenValid('Basic top-secret-token', 'top-secret-token'), false);
  assert.equal(isBearerTokenValid(undefined, 'top-secret-token'), false);
  assert.equal(isBearerTokenValid(undefined, ''), true);

  const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxKeys: 3 });
  assert.equal(limiter.check('audit:1.1.1.1', 2, 1000), true);
  assert.equal(limiter.check('audit:1.1.1.1', 2, 2000), true);
  assert.equal(limiter.check('audit:1.1.1.1', 2, 3000), false);

  // Prune expired buckets after window elapses
  assert.equal(limiter.prune(70_000), 1);
  assert.equal(limiter.size(), 0);
  assert.equal(limiter.check('audit:1.1.1.1', 2, 70_000), true);

  // Cap map size cleanly when unique keys exceed maxKeys
  assert.equal(limiter.check('audit:2.2.2.2', 2, 70_100), true);
  assert.equal(limiter.check('audit:3.3.3.3', 2, 70_200), true);
  assert.equal(limiter.check('audit:4.4.4.4', 2, 70_300), true);
  assert.equal(limiter.size(), 3);
});

test('BATCH 2: Cloudflare challenge page (HTTP 200 and HTTP 403) sets contentSource blocked and marks checks unknown', async () => {
  const cfChallengeHtml = `<!doctype html>
  <html>
    <head><title>Just a moment...</title></head>
    <body>
      <div id="cf-chl-widget">Checking your browser before accessing the site. Verify you are human.</div>
    </body>
  </html>`;

  assert.equal(inspectHtmlContent(cfChallengeHtml, 200).classification, 'bot-wall');
  assert.equal(inspectHtmlContent('<html><body>Forbidden</body></html>', 403).classification, 'bot-wall');

  const res200 = await resolveHtmlContentAndFindings({
    requestedUrl: 'https://blocked-resort.example',
    finalUrl: 'https://blocked-resort.example/',
    httpStatus: 200,
    html: cfChallengeHtml,
    fetchError: null,
    isHttps: true,
    ttfbMs: 120,
    ttfbSampleCount: 3,
    robotsTxt: { exists: true, allowsIndexing: true },
    sitemapXml: { exists: true },
    speed: {
      scores: { performance: 99, seo: 99, accessibility: 99, bestPractices: 99 },
      fcpMs: 500,
      lcpMs: 800,
      cls: 0,
      tbtMs: 0,
      speedIndexMs: 700,
      totalByteWeight: 10000,
      opportunities: [],
    },
    speedReason: null,
  });

  assert.equal(res200.contentSource, 'blocked');
  assert.equal(res200.parsed, null);
  assert.equal(res200.auditNotes[0]?.code, 'bot-wall');

  const lcp = res200.findings.find((f) => f.id === 'speed-lcp');
  const title = res200.findings.find((f) => f.id === 'seo-title-length');
  const cta = res200.findings.find((f) => f.id === 'contact-booking-cta');
  assert.equal(lcp?.status, 'unknown');
  assert.equal(lcp?.evidence, 'This site blocks automated checks');
  assert.equal(title?.status, 'unknown');
  assert.equal(title?.evidence, 'This site blocks automated checks');
  assert.equal(cta?.status, 'unknown');

  const res403 = await resolveHtmlContentAndFindings({
    requestedUrl: 'https://blocked-resort.example',
    finalUrl: 'https://blocked-resort.example/',
    httpStatus: 403,
    html: '<html><body>Access Denied</body></html>',
    fetchError: 'Website returned HTTP 403.',
    isHttps: true,
    ttfbMs: 95,
    ttfbSampleCount: 3,
    robotsTxt: { exists: false, allowsIndexing: true },
    sitemapXml: { exists: false },
    speed: null,
    speedReason: 'Website returned HTTP 403.',
  });

  assert.equal(res403.contentSource, 'blocked');
  assert.equal(res403.auditNotes[0]?.code, 'bot-wall');
  assert.equal(res403.findings.find((f) => f.id === 'seo-robots')?.status, 'unknown');
});

test('BATCH 2: soft-404 on HTTP 200 marks content findings unknown and adds soft-404 note', async () => {
  const soft404Html = `<!doctype html>
  <html>
    <head><title>404 - Page Not Found</title></head>
    <body>
      <main><h1>Page Not Found</h1><p>Sorry, nothing here.</p></main>
    </body>
  </html>`;

  assert.equal(inspectHtmlContent(soft404Html, 200).classification, 'soft-404');

  const res = await resolveHtmlContentAndFindings({
    requestedUrl: 'https://missing-page.example',
    finalUrl: 'https://missing-page.example/',
    httpStatus: 200,
    html: soft404Html,
    fetchError: null,
    isHttps: true,
    ttfbMs: 220,
    ttfbSampleCount: 3,
    robotsTxt: { exists: true, allowsIndexing: true },
    sitemapXml: { exists: true },
    speed: null,
    speedReason: 'Skipped',
  });

  assert.equal(res.contentSource, 'raw');
  assert.equal(res.parsed, null);
  assert.equal(res.auditNotes.some((n) => n.code === 'soft-404'), true);
  assert.equal(res.findings.find((f) => f.id === 'seo-title-length')?.status, 'unknown');
  assert.equal(res.findings.find((f) => f.id === 'contact-tel')?.status, 'unknown');
  assert.equal(res.findings.find((f) => f.id === 'seo-https')?.status, 'pass');
});

test('BATCH 2: JS-rendered SPA shell uses mocked renderer and falls back cleanly when render fails', async () => {
  const spaShellHtml = `<!doctype html>
  <html lang="en">
    <head><title>Sunset Dive Resort</title></head>
    <body>
      <div id="root"></div>
      <noscript>Please enable JavaScript to view this site.</noscript>
    </body>
  </html>`;

  const renderedSpaHtml = `<!doctype html>
  <html lang="en">
    <head>
      <title>Sunset Dive Resort | Coron</title>
      <meta name="description" content="Direct dive packages and beachfront cottages in Coron, Palawan with instant chat booking." />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </head>
    <body>
      <h1>Sunset Dive Resort Coron</h1>
      <a href="tel:+639171112222">Call us</a>
      <button>Book Now</button>
    </body>
  </html>`;

  assert.equal(inspectHtmlContent(spaShellHtml, 200).classification, 'js-shell');

  const rendered = await resolveHtmlContentAndFindings({
    requestedUrl: 'https://sunset-dive.example',
    finalUrl: 'https://sunset-dive.example/',
    httpStatus: 200,
    html: spaShellHtml,
    fetchError: null,
    isHttps: true,
    ttfbMs: 310,
    ttfbSampleCount: 3,
    robotsTxt: { exists: true, allowsIndexing: true },
    sitemapXml: { exists: true },
    speed: null,
    speedReason: null,
    renderJsShell: async () => renderedSpaHtml,
  });

  assert.equal(rendered.contentSource, 'rendered');
  assert.equal(rendered.auditNotes.some((n) => n.code === 'rendered'), true);
  assert.equal(rendered.parsed?.h1Count, 1);
  assert.equal(rendered.findings.find((f) => f.id === 'contact-tel')?.status, 'pass');
  assert.equal(rendered.findings.find((f) => f.id === 'contact-booking-cta')?.status, 'pass');

  const failedRender = await resolveHtmlContentAndFindings({
    requestedUrl: 'https://sunset-dive.example',
    finalUrl: 'https://sunset-dive.example/',
    httpStatus: 200,
    html: spaShellHtml,
    fetchError: null,
    isHttps: true,
    ttfbMs: 310,
    ttfbSampleCount: 3,
    robotsTxt: { exists: true, allowsIndexing: true },
    sitemapXml: { exists: true },
    speed: null,
    speedReason: null,
    renderJsShell: async () => {
      throw new Error('Timed out waiting for JS');
    },
  });

  assert.equal(failedRender.contentSource, 'raw');
  assert.equal(failedRender.parsed, null);
  assert.equal(failedRender.auditNotes.some((n) => n.code === 'render-failed'), true);
  assert.equal(failedRender.findings.find((f) => f.id === 'contact-tel')?.status, 'unknown');
});

test('BATCH 2: normal HTML produces contentSource raw and no auditNotes', async () => {
  const normalHtml = `<!doctype html>
  <html lang="en">
    <head>
      <title>Harbor Kitchen | Fresh Seafood Dining</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </head>
    <body>
      <h1>Welcome to Harbor Kitchen</h1>
      <p>Fresh grilled seafood and sunset drinks every day from 11am to 10pm. Walk-ins welcome and reservations available online or via phone.</p>
      <p>Located along Bayfront Promenade with private dining rooms for family celebrations and corporate dinners.</p>
      <a href="/book">Reserve a Table</a>
    </body>
  </html>`;

  const res = await resolveHtmlContentAndFindings({
    requestedUrl: 'https://harborkitchen.example',
    finalUrl: 'https://harborkitchen.example/',
    httpStatus: 200,
    html: normalHtml,
    fetchError: null,
    isHttps: true,
    ttfbMs: 240,
    ttfbSampleCount: 3,
    robotsTxt: { exists: true, allowsIndexing: true },
    sitemapXml: { exists: true },
    speed: null,
    speedReason: null,
  });

  assert.equal(res.contentSource, 'raw');
  assert.deepEqual(res.auditNotes, []);
  assert.equal(res.redirectedFromHost, undefined);
  assert.equal(res.findings.find((f) => f.id === 'contact-booking-cta')?.status, 'pass');
});

test('BATCH 2: host switch flags different domains while ignoring www and http->https upgrades, plus outreach notes and old v1 AuditResult compatibility', () => {
  const sameHostHttps = evaluateHostSwitch('http://example.com', 'https://example.com/');
  assert.equal(sameHostHttps.redirectedFromHost, undefined);
  assert.equal(sameHostHttps.note, undefined);

  const sameHostWww = evaluateHostSwitch('https://example.com', 'https://www.example.com/');
  assert.equal(sameHostWww.redirectedFromHost, undefined);
  assert.equal(sameHostWww.note, undefined);

  const switchedHost = evaluateHostSwitch('https://reactjs.org/', 'https://react.dev/');
  assert.equal(switchedHost.redirectedFromHost, 'reactjs.org');
  assert.equal(switchedHost.note?.code, 'host-switch');
  assert.equal(switchedHost.note?.message, 'Requested reactjs.org but audited react.dev after redirect.');

  const card = computeScorecard(makeMinimalAudit([]), createEmptyManualFootprint(), createDefaultAssumptions());
  const outreach = buildOutreachSummary('React Docs', 'https://react.dev/', card, [
    switchedHost.note!,
  ]);
  assert.ok(outreach.includes('Note: Requested reactjs.org but audited react.dev after redirect.'));
  assert.equal(outreach.includes('host-switch'), false);

  // Old v1 AuditResult without Batch 2 optional fields parses cleanly
  const legacyAudit = makeMinimalAudit([]);
  const parsedLegacy = AuditResultSchema.safeParse(legacyAudit);
  assert.equal(parsedLegacy.success, true);
});

test('BATCH 3: isPrivateOrBlockedIp blocks NAT64/6to4/Teredo/Doc IPv6, unparseable IPv6, and reserved IPv4 ranges while allowing public IPs', async () => {
  const mustBlock = [
    '64:ff9b::7f00:1',
    '2002:a9fe:a9fe::',
    '2001::1',
    '2001:db8::1',
    '198.18.0.1',
    '198.19.255.254',
    '192.0.0.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '2001:::1',
    'not-an-ip-address',
  ];
  for (const ip of mustBlock) {
    assert.equal(isPrivateOrBlockedIp(ip), true, `Expected ${ip} to be blocked`);
  }

  const mustAllow = ['8.8.8.8', '2606:4700::1111', '2606:4700:4700::1111'];
  for (const ip of mustAllow) {
    assert.equal(isPrivateOrBlockedIp(ip), false, `Expected ${ip} to be allowed`);
  }

  for (const url of [
    'http://[64:ff9b::7f00:1]/',
    'http://[2002:a9fe:a9fe::]/',
    'http://198.18.0.1/',
  ]) {
    await assert.rejects(
      () => validatePublicTargetUrl(url),
      (err: unknown) => err instanceof SsrfBlockedError && err.statusCode === 403
    );
  }
});

test('BATCH 3: relay pre-DNS allowlist and Playwright net::ERR_* sanitization', () => {
  const allowed = parseAllowedRelayHosts(undefined);
  assert.throws(
    () => validateRelayUrlBeforeDns('https://evil.internal/v1/chat', allowed),
    (err: unknown) => err instanceof SsrfBlockedError && err.statusCode === 403
  );
  assert.throws(
    () => validateRelayUrlBeforeDns('http://openrouter.ai/api/v1/models', allowed),
    (err: unknown) => err instanceof SsrfBlockedError && err.statusCode === 403
  );
  const okUrl = validateRelayUrlBeforeDns('https://openrouter.ai/api/v1/models', allowed);
  assert.equal(okUrl.hostname, 'openrouter.ai');

  const sanitizedDns = sanitizePlaywrightNavigationError(
    'page.goto: net::ERR_NAME_NOT_RESOLVED at https://missing.example/'
  );
  assert.equal(sanitizedDns.includes('net::ERR_'), false);
  assert.ok(sanitizedDns.length > 10);

  const sanitizedDenied = sanitizePlaywrightNavigationError('net::ERR_ACCESS_DENIED');
  assert.equal(sanitizedDenied.includes('net::ERR_'), false);
});

test('BATCH 3: audit overall deadline returns partial results with timeout note, MAX_AUDIT_PENDING is 4, and disconnected job is skipped', async () => {
  assert.equal(MAX_AUDIT_PENDING, 4);

  const partial = await executeFullSiteAudit('https://slow-site.example/', {
    deadlineMs: 60,
    deps: {
      validateUrl: async (u) => new URL(u),
      fetchHtml: async (u) => {
        if (u.endsWith('/robots.txt') || u.endsWith('/sitemap.xml')) {
          return {
            finalUrl: u,
            statusCode: 200,
            ttfbMs: 10,
            bytes: 20,
            text: 'User-agent: *\nAllow: /',
            contentType: 'text/plain',
          };
        }
        return {
          finalUrl: 'https://slow-site.example/',
          statusCode: 200,
          ttfbMs: 120,
          bytes: 500,
          text: '<!doctype html><html lang="en"><head><title>Slow Example Resort Official</title></head><body><h1>Welcome</h1><a href="tel:+639171234567">Call us</a><p>Plenty of normal page text for testing partial deadline behavior accurately across steps.</p></body></html>',
          contentType: 'text/html',
        };
      },
      runSpeed: async (_u, signal) =>
        await new Promise((resolve) => {
          const timer = setTimeout(
            () => resolve({ speed: null, reason: 'Completed late' }),
            5000
          );
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve({ speed: null, reason: 'Audit took too long; partial results' });
          });
        }),
    },
  });

  assert.equal(partial.httpStatus, 200);
  assert.equal(partial.findings.find((f) => f.id === 'contact-tel')?.status, 'pass');
  assert.equal(partial.findings.find((f) => f.id === 'speed-lcp')?.status, 'unknown');
  assert.equal(
    partial.auditNotes?.some((n) => n.message === 'Audit took too long; partial results'),
    true
  );

  await assert.rejects(
    () =>
      enqueueAudit('http://127.0.0.1/', {
        shouldSkip: () => true,
      }),
    (err: unknown) => err instanceof AuditJobSkippedError
  );
});

test('BATCH 4: seo-robots, contact weights, speed-images-alt category, and CTA_PATTERN ignore/length rules', () => {
  const html = `<!doctype html>
  <html lang="en">
    <head><title>Island Sanctuary & Eco Tours</title></head>
    <body>
      <a href="/sanctuary">Nature Reserve</a>
      <a href="/marine-park">Marine Reserve</a>
      <a href="/info">Availability of fresh seasonal fruit daily</a>
      <a href="/this-is-too-long">Book your unforgettable luxury island resort getaway package with transfers today</a>
      <a href="/book">Reserve now</a>
      <button>Check availability</button>
      <a href="https://wa.me/639171234567">Chat with our front desk reservations specialist now</a>
    </body>
  </html>`;

  const parsed = parseHtmlWithCheerio(html);
  assert.equal(parsed.ctaTexts.includes('Nature Reserve'), false);
  assert.equal(parsed.ctaTexts.includes('Marine Reserve'), false);
  assert.equal(parsed.ctaTexts.some((t) => /availability of/i.test(t)), false);
  assert.equal(parsed.ctaTexts.some((t) => t.startsWith('Book your unforgettable')), false);
  assert.equal(parsed.ctaTexts.includes('Reserve now'), true);
  assert.equal(parsed.ctaTexts.includes('Check availability'), true);
  assert.equal(
    parsed.ctaTexts.includes('Chat with our front desk reservations specialist now'),
    true
  );

  const noRobotsFindings = buildAutomatedFindings({
    isHttps: true,
    fetchError: null,
    ttfbMs: 320,
    ttfbSampleCount: 3,
    parsed,
    robotsTxt: { exists: false, allowsIndexing: true },
    sitemapXml: { exists: true },
    speed: null,
    speedReason: 'Skipped',
  });

  const robotsMissing = noRobotsFindings.find((f) => f.id === 'seo-robots');
  assert.equal(robotsMissing?.status, 'pass');
  assert.equal(robotsMissing?.evidence, 'No robots.txt (crawlers are allowed by default)');
  assert.equal(robotsMissing?.weight, 1);

  const imagesAlt = noRobotsFindings.find((f) => f.id === 'speed-images-alt');
  assert.equal(imagesAlt?.category, 'seo');

  assert.equal(noRobotsFindings.find((f) => f.id === 'contact-tel')?.weight, 3);
  assert.equal(noRobotsFindings.find((f) => f.id === 'contact-messaging')?.weight, 5);
  assert.equal(noRobotsFindings.find((f) => f.id === 'contact-booking-cta')?.weight, 5);
  assert.equal(noRobotsFindings.find((f) => f.id === 'contact-form-or-booking')?.weight, 3);

  const disallowRobots = buildAutomatedFindings({
    isHttps: true,
    fetchError: null,
    ttfbMs: 320,
    ttfbSampleCount: 3,
    parsed,
    robotsTxt: { exists: true, allowsIndexing: false },
    sitemapXml: { exists: true },
    speed: null,
    speedReason: 'Skipped',
  }).find((f) => f.id === 'seo-robots');
  assert.equal(disallowRobots?.status, 'fail');
  assert.equal(disallowRobots?.weight, 5);
});

test('BATCH 4: validateNumbersGrounded and generateWalkthrough retry + needsReview fallback', async () => {
  const groundedOutput: WalkthroughData = {
    title: 'Faster Bookings for El Nido Resort',
    scenes: [
      {
        screenshotIndex: 0,
        caption: 'Cut slow 4.8s load delays on mobile',
        narration:
          'Visitors see your main offer right away instead of waiting 4.8 s on 1,250 ms servers, ready for Q1 through Q4 growth in 2027.',
        highlight: { x: 10, y: 10, w: 40, h: 20 },
        findingRefs: ['speed-lcp'],
      },
    ],
    outcomes: [
      {
        title: 'Faster First Impression',
        description: 'Shave off the 4.8s mobile wait and keep 24-hour inquiries moving through 2027.',
        findingRef: 'speed-lcp',
      },
    ],
    roadmap: [
      { quarter: 'Q1', items: ['Speed up hero image'] },
      { quarter: 'Q2', items: ['Add direct booking link'] },
      { quarter: 'Q3', items: ['Collect reviews'] },
      { quarter: 'Q4', items: ['Scale direct revenue'] },
    ],
  };

  const allowedText = [
    'LCP 4.8 s',
    'Median TTFB 1250 ms (3 requests)',
    'We run a 24-hour front desk in Palawan.',
  ].join('\n');

  const ok = validateNumbersGrounded(groundedOutput, allowedText);
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.violations, []);

  const ungroundedOutput: WalkthroughData = {
    ...groundedOutput,
    scenes: [
      {
        ...groundedOutput.scenes[0],
        caption: 'Boost bookings by 47% right away',
        narration: 'Reduce mobile wait times from 3.2 s and capture 3x more leads into 2027.',
      },
    ],
  };

  const bad = validateNumbersGrounded(ungroundedOutput, allowedText);
  assert.equal(bad.valid, false);
  assert.deepEqual(bad.offendingSceneIndices, [0]);
  assert.equal(bad.violations.some((v) => v.token === '47%'), true);
  assert.equal(bad.violations.some((v) => v.token === '3.2 s'), true);

  // Test generateWalkthrough: retry receives violations, and if still ungrounded, keeps result with needsReview
  let callCount = 0;
  let retryPromptSawViolation = false;
  const result = await generateWalkthrough({
    settings: { ...DEFAULT_AI_SETTINGS, apiKey: 'test', model: 'test-vision' },
    project: {
      clientName: 'El Nido Resort',
      businessType: 'Resort',
      brief: 'We run a 24-hour front desk in Palawan.',
      brandColor: '#0F766E',
      logoDataUrl: null,
    },
    screenshots: [
      { id: 's1', name: 'home.png', dataUrl: 'data:image/png;base64,AA==', width: 1280, height: 760 },
    ],
    findings: [
      {
        id: 'speed-lcp',
        category: 'speed',
        label: 'Main content load time (LCP)',
        status: 'fail',
        evidence: 'LCP 4.8 s',
        fix: 'Optimize hero',
        businessImpact: 'Visitors leave',
        weight: 5,
      },
    ],
    completeChat: async (messages) => {
      callCount++;
      if (callCount === 2) {
        const lastUserText = String(messages[messages.length - 1]?.content ?? '');
        retryPromptSawViolation = lastUserText.includes('47%');
      }
      return JSON.stringify(ungroundedOutput);
    },
  });

  assert.equal(callCount, 2);
  assert.equal(retryPromptSawViolation, true);
  assert.equal(result.scenes[0]?.needsReview, true);
});

test('CURRENCY: Philippine Peso (PHP) is default with USD and EUR options', () => {
  const defaultAssumptions = createDefaultAssumptions();
  assert.equal(defaultAssumptions.currency, 'PHP');

  assert.ok(DEFAULT_PRICING_TIERS[0].setupPrice.startsWith('₱'));
  const usdTiers = convertPricingTiersCurrency(DEFAULT_PRICING_TIERS, 'USD');
  assert.equal(usdTiers[0].setupPrice, '$2,400');
  const eurTiers = convertPricingTiersCurrency(DEFAULT_PRICING_TIERS, 'EUR');
  assert.equal(eurTiers[0].setupPrice, '€2,200');
  assert.deepEqual(eurTiers, buildDefaultPricingTiers('EUR'));

  const estimateUsd = computeIgnoredLeadsEstimate([], createEmptyManualFootprint(), {
    ...defaultAssumptions,
    currency: 'USD',
    monthlyVisitors: 500,
    avgBookingValuePhp: 200,
  });
  assert.equal(estimateUsd.currency, 'USD');
});

test('AI READINESS: parseRobotsAiBots, rich JSON-LD entity extraction, and summary score', () => {
  const robots = [
    'User-agent: *',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Disallow: /',
    '',
    'User-agent: GPTBot',
    'Allow: /',
  ].join('\n');

  const botAccess = parseRobotsAiBots(robots);
  const claude = botAccess.find((b) => b.bot === 'ClaudeBot');
  const gpt = botAccess.find((b) => b.bot === 'GPTBot');
  const perplexity = botAccess.find((b) => b.bot === 'PerplexityBot');

  assert.equal(claude?.status, 'blocked');
  assert.equal(gpt?.status, 'allowed');
  assert.equal(perplexity?.status, 'allowed');

  const unknownBots = parseRobotsAiBots(null);
  assert.equal(unknownBots.every((b) => b.status === 'unknown'), true);

  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <title>Bayview Resort</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Hotel",
                "name": "Bayview Resort",
                "telephone": "+63 917 555 0199",
                "priceRange": "$$$",
                "address": { "@type": "PostalAddress", "streetAddress": "El Nido" },
                "openingHoursSpecification": [{ "@type": "OpeningHoursSpecification", "description": "24/7" }],
                "sameAs": ["https://facebook.com/bayview"],
                "geo": { "@type": "GeoCoordinates", "latitude": 11.18, "longitude": 119.39 }
              },
              { "@type": "FAQPage", "mainEntity": [] }
            ]
          }
        </script>
      </head>
      <body><h1>Bayview Resort</h1></body>
    </html>
  `;
  const parsed = parseHtmlWithCheerio(html);
  assert.equal(parsed.jsonLdDetails?.hasAddress, true);
  assert.equal(parsed.jsonLdDetails?.hasTelephone, true);
  assert.equal(parsed.jsonLdDetails?.hasOpeningHours, true);
  assert.equal(parsed.jsonLdDetails?.hasPriceRange, true);
  assert.equal(parsed.jsonLdDetails?.hasSameAs, true);
  assert.equal(parsed.jsonLdDetails?.hasFaqPage, true);
  assert.equal(parsed.jsonLdDetails?.hasGeo, true);

  const audit = makeMinimalAudit([]);
  audit.parsed = parsed;
  audit.aiReadiness = {
    robotsChecked: true,
    botAccess,
    llmsTxt: { exists: false, reason: 'HTTP 404' },
    entityCompleteness: {
      hasBusinessType: true,
      hasAddress: true,
      hasTelephone: true,
      hasOpeningHours: true,
      hasPriceRange: true,
      hasSameAs: true,
      hasFaqPage: true,
      hasGeo: true,
    },
  };

  const summary = buildAiReadinessSummary(audit);
  assert.equal(summary.blockedBotsCount, 1);
  assert.equal(summary.allowedBotsCount, 5);
  assert.equal(summary.entityFieldsPresent, 8);
  assert.equal(summary.llmsStatus, 'missing');
  assert.ok(summary.score !== null && summary.score >= 70 && summary.score <= 85);
});

test('GBP COMPETITOR BENCHMARK & PLAYBOOK: computes review/photo gap and tailored action plan', () => {
  const manual = createEmptyManualFootprint();
  manual.gbp.claimed = 'no';
  manual.gbp.reviewCount = 24;
  manual.gbp.averageRating = 4.3;
  manual.gbp.photoCount = 8;
  manual.gbp.postsLast90Days = 0;
  manual.competitors = [
    {
      id: 'c1',
      name: 'Top Smile Clinic',
      category: 'Dentistry',
      reviewCount: 120,
      averageRating: 4.8,
      photoCount: 40,
      postsLast90Days: 4,
    },
    {
      id: 'c2',
      name: 'Metro Dental',
      category: 'Dentistry',
      reviewCount: 80,
      averageRating: 4.6,
      photoCount: 20,
      postsLast90Days: 2,
    },
  ];

  const benchmark = computeGbpCompetitorBenchmark(manual, 'Harborcrest Dental');
  assert.equal(benchmark.topCompetitorName, 'Top Smile Clinic');
  assert.equal(benchmark.topCompetitorReviews, 120);
  assert.equal(benchmark.reviewGapToLeader, 96);
  assert.equal(benchmark.avgCompetitorReviews, 100);
  assert.equal(benchmark.avgCompetitorPhotos, 30);

  const playbook = buildGbpActionPlaybook(
    manual,
    {
      clientName: 'Harborcrest Dental',
      businessType: 'Family & Cosmetic Dentistry',
      brief: 'More new patients',
      brandColor: '#0F766E',
      logoDataUrl: null,
      websiteUrl: 'https://harborcrest.ph',
    },
    'Harborcrest Dental'
  );
  assert.equal(playbook.prioritizedActions.some((a) => a.priority === 'Urgent'), true);
  assert.equal(playbook.photoShotList.some((s) => /clinic|dentist|reception/i.test(s)), true);
  assert.equal(playbook.reviewTemplates.length >= 2, true);
  assert.equal(playbook.qaSeeds.length >= 3, true);
});

test('OLLAMA BRIDGE & MODEL RESOLUTION: validates safe server origin and local baseUrl detection', () => {
  assert.equal(resolveServerOllamaOrigin(undefined)?.origin, 'http://127.0.0.1:11434');
  assert.equal(resolveServerOllamaOrigin('disabled'), null);
  assert.equal(resolveServerOllamaOrigin('none'), null);
  assert.equal(resolveServerOllamaOrigin('ftp://localhost:11434'), null);
  assert.equal(resolveServerOllamaOrigin('http://user:pass@127.0.0.1:11434'), null);
  assert.equal(resolveServerOllamaOrigin('http://localhost:11434/v1')?.origin, 'http://localhost:11434');

  assert.equal(isOllamaBaseUrl('http://127.0.0.1:11434/v1'), true);
  assert.equal(isOllamaBaseUrl('http://localhost:11434'), true);
  assert.equal(isOllamaBaseUrl('https://openrouter.ai/api/v1'), false);

  assert.equal(
    getEffectiveAnalysisModel({
      ...DEFAULT_AI_SETTINGS,
      model: 'vision-model',
      analysisModel: 'qwen2.5:14b',
    }),
    'qwen2.5:14b'
  );
  assert.equal(
    getEffectiveAnalysisModel({
      ...DEFAULT_AI_SETTINGS,
      model: 'vision-model',
      analysisModel: '',
    }),
    'vision-model'
  );
});

test('AI MENTION CHECK & SITE ANALYSIS AGENT: validates Zod schema and enforces numeric grounding', async () => {
  const project = {
    clientName: 'Palawan Cove Resort',
    businessType: 'Boutique Beach Resort',
    brief: 'Direct bookings in El Nido with 24-hour reception.',
    brandColor: '#0F766E',
    logoDataUrl: null,
    websiteUrl: 'https://palawancove.ph',
  };
  const aiSearchLayer = buildDefaultAISearchLayer(project, null, null);
  const manual = createEmptyManualFootprint();
  const audit = makeMinimalAudit([
    {
      id: 'speed-lcp',
      category: 'speed',
      label: 'Main content load time (LCP)',
      status: 'fail',
      evidence: 'LCP 4.8 s',
      fix: 'Compress hero media',
      businessImpact: 'Mobile visitors drop off before seeing rooms',
      weight: 5,
    },
  ]);
  const scorecard = computeScorecard(audit, manual, createDefaultAssumptions());

  const mentionResult = await runAiBrandMentionCheck({
    settings: {
      ...DEFAULT_AI_SETTINGS,
      baseUrl: 'http://127.0.0.1:11434/v1',
      analysisModel: 'llama3.2:latest',
    },
    project,
    audit,
    aiSearchLayer,
    completeChat: async () =>
      JSON.stringify({
        results: [
          {
            query: 'Best Boutique Beach Resort in El Nido',
            clientMentioned: false,
            citedDomain: false,
            competitorsMentioned: ['Booking.com', 'Agoda'],
            summary: 'AI assistants primarily list OTA directories rather than Palawan Cove Resort directly.',
          },
          {
            query: 'Top Boutique Beach Resort direct booking',
            clientMentioned: true,
            citedDomain: false,
            competitorsMentioned: ['TripAdvisor'],
            summary: 'Mentioned by name without verified domain link.',
          },
          {
            query: 'Compare beach resorts',
            clientMentioned: false,
            citedDomain: false,
            competitorsMentioned: ['Agoda'],
            summary: 'Not named in general comparison.',
          },
        ],
      }),
  });
  assert.equal(mentionResult.overallVisibility, 'partial');
  assert.equal(mentionResult.searchCapable, false);
  assert.equal(mentionResult.results.length, 3);

  // Site analysis agent: verify retry when model fabricates a number ("47%"), and verify needsReview if persisted
  let calls = 0;
  let sawUngroundedFeedback = false;
  const report = await runSiteAnalysisAgent({
    settings: {
      ...DEFAULT_AI_SETTINGS,
      baseUrl: 'http://127.0.0.1:11434/v1',
      analysisModel: 'qwen2.5:7b',
    },
    project,
    audit,
    scorecard,
    manualFootprint: manual,
    aiSearchLayer,
    aiMentionCheck: mentionResult,
    completeChat: async (messages) => {
      calls++;
      if (calls === 2) {
        const last = String(messages[messages.length - 1]?.content ?? '');
        sawUngroundedFeedback = last.includes('47%');
        return JSON.stringify({
          executiveSummary: 'Palawan Cove Resort faces slow mobile loading at LCP 4.8 s.',
          biggestRevenueLeaks: ['Mobile LCP of 4.8 s delays first impression for arriving guests.'],
          aiVisibilityVerdict: 'AI visibility requires rich Schema markup and direct citations.',
          gbpActionSummary: 'Complete GBP verification and add local competitor tracking.',
          quickWins30Days: ['Optimize hero image to lower LCP from 4.8 s.', 'Publish Schema JSON-LD.'],
          strategic90Days: ['Launch steady review velocity campaign.'],
          clientPitchAngle: 'Turn mobile browsers into commission-free direct bookings.',
        });
      }
      return JSON.stringify({
        executiveSummary: 'Palawan Cove Resort loses 47% of guests due to LCP 4.8 s.',
        biggestRevenueLeaks: ['Slow LCP 4.8 s hurts conversion.'],
        aiVisibilityVerdict: 'Missing structured data.',
        gbpActionSummary: 'Needs more reviews.',
        quickWins30Days: ['Fix hero image.'],
        strategic90Days: ['Build direct booking funnel.'],
        clientPitchAngle: 'Capture direct bookings without OTA fees.',
      });
    },
  });

  assert.equal(calls, 2);
  assert.equal(sawUngroundedFeedback, true);
  assert.equal(report.needsReview, undefined);
  assert.equal(report.providerLabel, 'Local Ollama');
});

test('BUNDLE MIGRATION: preserves backward compatibility with legacy v1 bundles lacking new fields', () => {
  const legacyBundle = {
    schemaVersion: '1.0',
    exportedAt: '2026-01-01T00:00:00.000Z',
    project: {
      clientName: 'Legacy Hotel',
      businessType: 'Hotel',
      brief: 'Direct bookings',
      brandColor: '#0F766E',
      logoDataUrl: null,
    },
    walkthrough: {
      title: 'Legacy Tour',
      scenes: [
        {
          screenshotIndex: 0,
          narration: 'Grow bookings into 2027.',
          caption: 'Hero',
          highlight: { x: 10, y: 10, w: 30, h: 20 },
        },
      ],
      outcomes: [{ title: 'More bookings', description: 'Direct conversions' }],
      roadmap: [{ quarter: 'Q1', items: ['Launch'] }],
    },
  };
  const migrated = migrateImportedBundle(legacyBundle);
  assert.equal(migrated.project?.clientName, 'Legacy Hotel');
  assert.equal(migrated.aiMentionCheck, null);
  assert.equal(migrated.siteAnalysisReport, null);
});

test('GITHUB REPORT & AGENT BUNDLE: maps failing findings to repo files and exports valid UI-importable bundle', () => {
  const manual = createEmptyManualFootprint();
  const audit = makeMinimalAudit([
    {
      id: 'seo-robots',
      category: 'seo',
      label: 'Search crawler rules (robots.txt)',
      status: 'fail',
      evidence: 'Blanket Disallow: / blocks crawlers',
      fix: 'Allow public pages and AI search crawlers in robots.txt',
      businessImpact: 'Invisible to Google and AI assistants',
      weight: 5,
    },
    {
      id: 'contact-booking-cta',
      category: 'contact',
      label: 'Clear booking / contact call-to-action',
      status: 'fail',
      evidence: 'No booking button found',
      fix: 'Add Book Now button in header',
      businessImpact: 'Lost direct bookings',
      weight: 5,
    },
  ]);
  audit.aiReadiness = {
    robotsChecked: true,
    botAccess: parseRobotsAiBots('User-agent: *\nDisallow: /'),
    llmsTxt: { exists: false, reason: 'HTTP 404' },
    entityCompleteness: {
      hasBusinessType: false,
      hasAddress: false,
      hasTelephone: false,
      hasOpeningHours: false,
      hasPriceRange: false,
      hasSameAs: false,
      hasFaqPage: false,
      hasGeo: false,
    },
  };

  const scorecard = computeScorecard(audit, manual, createDefaultAssumptions());
  const aiSummary = buildAiReadinessSummary(audit);
  const repoChanges = buildRepoChangeChecklist(audit, aiSummary);

  assert.equal(repoChanges.some((c) => c.findingId === 'seo-robots' && c.priority === 'P0' && c.targetRepoPaths.includes('public/robots.txt')), true);
  assert.equal(repoChanges.some((c) => c.findingId === 'ai-llms-txt' && c.targetRepoPaths.includes('public/llms.txt')), true);
  assert.equal(repoChanges.some((c) => c.findingId === 'contact-booking-cta' && c.priority === 'P0'), true);

  const bundle = buildAgentOutputBundle({
    url: 'https://example-resort.ph',
    clientName: 'Example Resort',
    businessType: 'Boutique Resort',
    audit,
    scorecard,
    manual,
  });
  const migrated = migrateImportedBundle(bundle);
  assert.equal(migrated.project?.clientName, 'Example Resort');
  assert.equal(migrated.audit?.requestedUrl, 'https://example-resort.ph');
  assert.ok(migrated.aiSearchLayer?.faqs.length);

  const assets = buildGeneratedRepoAssets(bundle.project, bundle.aiSearchLayer!, audit, manual);
  assert.match(assets.robotsTxt, /OAI-SearchBot/);
  assert.match(assets.llmsTxt, /Example Resort/);
  assert.match(assets.schemaJsonLdTag, /application\/ld\+json/);

  const reportMd = buildAgentMarkdownReport({
    url: 'https://example-resort.ph',
    repoName: 'agency/example-resort-web',
    project: bundle.project,
    audit,
    scorecard,
    aiSummary,
    repoChanges,
  });
  assert.match(reportMd, /agency\/example-resort-web/);
  assert.match(reportMd, /public\/robots\.txt/);

  const issueMd = buildGitHubIssueBody({
    url: 'https://example-resort.ph',
    project: bundle.project,
    scorecard,
    aiSummary,
    repoChanges,
  });
  assert.match(issueMd, /- \[ \] \*\*\[P0\]/);
});

test('AGENT CLI & MCP SERVER: parses CLI args and responds to JSON-RPC initialize, tools/list, and tools/call', async () => {
  const cli = parseCliArgs([
    '--url',
    'https://resort.ph',
    '--out',
    './audits/resort',
    '--server',
    'http://127.0.0.1:3000',
    '--currency',
    'USD',
    '--ai',
  ]);
  assert.equal('help' in cli, false);
  if (!('help' in cli)) {
    assert.equal(cli.url, 'https://resort.ph');
    assert.equal(cli.outDir, './audits/resort');
    assert.equal(cli.serverUrl, 'http://127.0.0.1:3000');
    assert.equal(cli.currency, 'USD');
    assert.equal(cli.runAi, true);
  }

  const initReply = await handleJsonRpcMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
  });
  assert.equal((initReply?.result as { serverInfo?: { name?: string } })?.serverInfo?.name, 'tourforge-lite');

  const listReply = await handleJsonRpcMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });
  const tools = (listReply?.result as { tools?: Array<{ name: string }> })?.tools ?? [];
  assert.equal(tools.some((t) => t.name === 'tourforge_audit_url'), true);
  assert.equal(tools.some((t) => t.name === 'tourforge_generate_repo_fixes'), true);
  assert.equal(tools.some((t) => t.name === 'tourforge_export_bundle'), true);

  const fixesResult = await handleMcpToolCall('tourforge_generate_repo_fixes', {
    url: 'https://example-resort.ph',
    clientName: 'Mabuhay Villas',
    auditResult: makeMinimalAudit([]),
  });
  const parsedFixes = JSON.parse(fixesResult.content[0].text) as {
    files: Record<string, string>;
    githubIssueMarkdown: string;
  };
  assert.match(parsedFixes.files['public/robots.txt'], /PerplexityBot/);
  assert.match(parsedFixes.files['public/llms.txt'], /Mabuhay Villas/);
  assert.match(parsedFixes.githubIssueMarkdown, /Mabuhay Villas/);
});

test('PASSIVE SECURITY: evaluates strong, missing, and weak HTTP security headers and TLS state', () => {
  const cleanHtml = '<!doctype html><html lang="en"><head><title>Safe Resort</title></head><body><h1>Safe Resort</h1></body></html>';

  const hardened = analyzePassiveSecurity({
    finalUrl: 'https://safe-resort.example/',
    isHttps: true,
    html: cleanHtml,
    tlsInfo: { protocol: 'TLSv1.3', certificateValid: true },
    headers: {
      'content-security-policy':
        "default-src 'self'; script-src 'self'; frame-ancestors 'none'; object-src 'none'",
      'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    },
    setCookies: ['__Host-sid=abc123; Secure; HttpOnly; SameSite=Lax'],
  });

  assert.equal(hardened.headersChecked, true);
  assert.equal(hardened.tls.protocol, 'TLSv1.3');
  assert.equal(hardened.tls.hstsEnabled, true);
  assert.equal(hardened.highSeverityCount, 0);
  assert.equal(hardened.badgeEligible, true);
  assert.equal(hardened.findings.every((f) => f.status === 'pass'), true);

  const missingHeaders = analyzePassiveSecurity({
    finalUrl: 'http://insecure-resort.example/',
    isHttps: false,
    html: cleanHtml,
    headers: {
      server: 'nginx/1.18.0',
    },
  });
  assert.equal(missingHeaders.badgeEligible, false);
  assert.ok(missingHeaders.highSeverityCount >= 2);
  assert.equal(missingHeaders.findings.find((f) => f.id === 'sec-csp')?.status, 'fail');
  assert.equal(missingHeaders.findings.find((f) => f.id === 'sec-hsts')?.status, 'fail');
  assert.equal(missingHeaders.findings.find((f) => f.id === 'sec-xcto')?.status, 'warn');
  assert.equal(missingHeaders.findings.find((f) => f.id === 'sec-xfo')?.status, 'warn');
  assert.equal(missingHeaders.findings.find((f) => f.id === 'sec-referrer')?.status, 'warn');
  assert.equal(missingHeaders.findings.find((f) => f.id === 'sec-permissions')?.status, 'warn');

  const weakPolicy = analyzePassiveSecurity({
    finalUrl: 'https://weak-policy.example/',
    isHttps: true,
    html: cleanHtml,
    headers: {
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' *",
      'strict-transport-security': 'max-age=3600',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
      'referrer-policy': 'unsafe-url',
      'permissions-policy': 'geolocation=()',
    },
  });
  assert.equal(weakPolicy.findings.find((f) => f.id === 'sec-csp')?.status, 'warn');
  assert.equal(weakPolicy.findings.find((f) => f.id === 'sec-hsts')?.status, 'warn');
  assert.equal(weakPolicy.findings.find((f) => f.id === 'sec-xfo')?.status, 'pass');
  assert.equal(weakPolicy.findings.find((f) => f.id === 'sec-referrer')?.status, 'warn');
});

test('PASSIVE SECURITY: classifies active vs passive mixed content and ignores XML namespaces', () => {
  const xmlNsOnlyHtml = `<!doctype html>
    <html>
      <head><title>Clean SVG Page</title></head>
      <body>
        <svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" /></svg>
        <div itemtype="http://schema.org/Hotel">Hotel</div>
      </body>
    </html>`;
  const cleanRes = analyzePassiveSecurity({
    finalUrl: 'https://clean-svg.example/',
    isHttps: true,
    html: xmlNsOnlyHtml,
    headers: { 'x-content-type-options': 'nosniff' },
  });
  assert.equal(cleanRes.mixedContent.count, 0);
  assert.equal(cleanRes.findings.find((f) => f.id === 'sec-mixed-content')?.status, 'pass');

  const passiveMixed = analyzePassiveSecurity({
    finalUrl: 'https://passive-mix.example/',
    isHttps: true,
    html: '<html><body><img src="http://cdn.example/photo.jpg" alt="photo" /></body></html>',
    headers: { 'x-content-type-options': 'nosniff' },
  });
  assert.equal(passiveMixed.mixedContent.activeUrls.length, 0);
  assert.equal(passiveMixed.mixedContent.passiveUrls.length, 1);
  assert.equal(passiveMixed.findings.find((f) => f.id === 'sec-mixed-content')?.status, 'warn');
  assert.equal(passiveMixed.findings.find((f) => f.id === 'sec-mixed-content')?.severity, 'medium');

  const activeMixed = analyzePassiveSecurity({
    finalUrl: 'https://active-mix.example/',
    isHttps: true,
    html: '<html><head><script src="http://cdn.example/app.js"></script></head><body><form action="http://submit.example/book"></form></body></html>',
    headers: { 'x-content-type-options': 'nosniff' },
  });
  assert.equal(activeMixed.mixedContent.activeUrls.length, 2);
  const activeFinding = activeMixed.findings.find((f) => f.id === 'sec-mixed-content');
  assert.equal(activeFinding?.status, 'fail');
  assert.equal(activeFinding?.severity, 'high');
});

test('PASSIVE SECURITY: audits Set-Cookie flags (Secure, HttpOnly, SameSite) and SameSite=None without Secure', () => {
  const badCookies = analyzePassiveSecurity({
    finalUrl: 'https://cookies.example/',
    isHttps: true,
    html: '<html><body><p>Hello</p></body></html>',
    headers: { 'x-content-type-options': 'nosniff' },
    setCookies: [
      'session_id=xyz; Path=/',
      'prefs=dark; Secure; HttpOnly; SameSite=None',
      'tracker=1; HttpOnly; SameSite=None',
    ],
  });

  assert.equal(badCookies.cookies.total, 3);
  assert.deepEqual(badCookies.cookies.missingSecure, ['session_id', 'tracker']);
  assert.deepEqual(badCookies.cookies.missingHttpOnly, ['session_id']);
  assert.deepEqual(badCookies.cookies.missingSameSite, ['session_id']);
  assert.deepEqual(badCookies.cookies.weakSameSite, ['tracker']);

  const cookieFinding = badCookies.findings.find((f) => f.id === 'sec-cookies');
  assert.equal(cookieFinding?.status, 'fail');
  assert.equal(cookieFinding?.severity, 'high');

  const warnCookie = analyzePassiveSecurity({
    finalUrl: 'https://cookies-warn.example/',
    isHttps: true,
    html: '<html><body><p>Hello</p></body></html>',
    headers: { 'x-content-type-options': 'nosniff' },
    setCookies: ['csrf=abc; Secure; SameSite=Strict'],
  });
  assert.equal(warnCookie.findings.find((f) => f.id === 'sec-cookies')?.status, 'warn');
  assert.equal(warnCookie.findings.find((f) => f.id === 'sec-cookies')?.severity, 'medium');
});

test('PASSIVE SECURITY: detects & redacts exposed secrets, exposure hints, source maps, scripts, and form issues', () => {
  const syntheticAws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
  const syntheticGh = ['ghp_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'].join('');
  const syntheticStripe = ['sk_live_', '99887766554433221100AABBCC'].join('');
  const syntheticDb = ['postgres://', 'admin:SuperSecretPass99', '@db.internal:5432/prod'].join('');
  const syntheticPem = ['-----BEGIN RSA ', 'PRIVATE KEY-----'].join('');

  const leakyHtml = `<!doctype html>
  <html>
    <head>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/1.12.4/jquery.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js" integrity="sha384-abc123" crossorigin="anonymous"></script>
      <link rel="stylesheet" href="/assets/app.css.map" />
    </head>
    <body>
      <a href="/.git/config">Repo Config</a>
      <a href="/.env.production">Env File</a>
      <form method="post" action="/login">
        <input type="password" name="user_password" />
        <button type="submit">Sign In</button>
      </form>
      <script>
        const aws = "${syntheticAws}";
        const gh = "${syntheticGh}";
        const stripe = "${syntheticStripe}";
        const db = "${syntheticDb}";
        const pem = "${syntheticPem}";
        //# sourceMappingURL=bundle.js.map
      </script>
    </body>
  </html>`;

  const res = analyzePassiveSecurity({
    finalUrl: 'https://leaky.example/',
    isHttps: true,
    html: leakyHtml,
    robotsTxtContent: 'User-agent: *\nDisallow: /.env\nDisallow: /backup.sql\n',
    headers: {
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=()',
      'x-powered-by': 'Express 4.18',
    },
  });

  // Secrets must be detected AND redacted so raw secrets are never returned
  assert.equal(res.secrets.count, 5);
  const secretsFinding = res.findings.find((f) => f.id === 'sec-secrets');
  assert.equal(secretsFinding?.status, 'fail');
  assert.equal(secretsFinding?.severity, 'high');
  assert.equal(secretsFinding?.evidence.includes(syntheticGh), false);
  assert.equal(secretsFinding?.evidence.includes(syntheticStripe), false);
  assert.equal(secretsFinding?.evidence.includes('SuperSecretPass99'), false);
  assert.equal(res.badgeEligible, false);

  // Exposure hints (.git/config, .env, robots.txt hint, X-Powered-By)
  assert.ok(res.exposureHints.count >= 4);
  assert.equal(res.findings.find((f) => f.id === 'sec-exposure-hints')?.status, 'fail');

  // Source maps
  assert.equal(res.sourceMaps.count, 2);
  assert.equal(res.findings.find((f) => f.id === 'sec-source-maps')?.status, 'warn');

  // Third-party script inventory & legacy detection
  assert.equal(res.thirdPartyScripts.length, 2);
  const jq = res.thirdPartyScripts.find((s) => s.library === 'jquery');
  assert.equal(jq?.version, '1.12.4');
  assert.equal(jq?.hasSri, false);
  const alpine = res.thirdPartyScripts.find((s) => s.library === 'alpinejs');
  assert.equal(alpine?.version, '3.14.1');
  assert.equal(alpine?.hasSri, true);
  assert.equal(res.findings.find((f) => f.id === 'sec-third-party-scripts')?.status, 'warn');

  // Form autocomplete & POST CSRF hint
  assert.equal(res.forms.totalForms, 1);
  assert.equal(res.forms.postFormsWithoutCsrfHint, 1);
  assert.equal(res.forms.sensitiveInputsWithoutAutocompleteOff, 1);
  assert.equal(res.findings.find((f) => f.id === 'sec-forms')?.status, 'warn');
});

test('PASSIVE SECURITY: blocked site marks sec-* checks unknown, and badge helpers escape HTML safely', () => {
  const blocked = analyzePassiveSecurity({
    finalUrl: 'https://waf.example/',
    isHttps: true,
    html: '<html><title>Just a moment...</title></html>',
    headers: { 'x-content-type-options': 'nosniff' },
    contentBlocked: true,
  });

  assert.equal(blocked.badgeEligible, false);
  assert.equal(blocked.findings.every((f) => f.status === 'unknown'), true);
  assert.equal(blocked.findings[0]?.evidence, 'This site blocks automated checks');

  const svg = buildSecurityBadgeSvg('Coral <Resort> & "Spa"', 95);
  assert.match(svg, /Security Passed/);
  assert.match(svg, /95\/100/);
  assert.equal(svg.includes('<Resort>'), false);

  const snippet = buildSecurityBadgeSnippet('Coral Resort', 'https://coral.example/?a=1&b=2', 95);
  assert.match(snippet, /^<a href="https:\/\/coral\.example\/\?a=1&amp;b=2"/);
  assert.match(snippet, /<svg /);
});

test('PASSIVE SECURITY SCORECARD: computes SecurityScore weight (10%), <50% insufficient-data exclusion, and <70% provisional rule', () => {
  const cleanHtml = `<!doctype html><html lang="en"><head><title>Secure Villa</title></head><body><h1>Villa</h1><form method="post"><input type="hidden" name="csrf_token" value="1" /><input type="password" name="pw" autocomplete="current-password" /></form></body></html>`;
  const secAudit = analyzePassiveSecurity({
    finalUrl: 'https://secure-villa.example/',
    isHttps: true,
    html: cleanHtml,
    headers: {
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=()',
    },
  });

  const audit = makeMinimalAudit([
    {
      id: 'seo-https',
      category: 'seo',
      label: 'HTTPS',
      status: 'pass',
      evidence: 'HTTPS active',
      fix: 'None',
      businessImpact: 'Security',
      weight: 5,
    },
    ...secAudit.findings,
  ]);
  audit.security = secAudit;

  const parsed = AuditResultSchema.safeParse(audit);
  assert.equal(parsed.success, true);

  const card = computeScorecard(audit, createEmptyManualFootprint(), createDefaultAssumptions());
  assert.equal(card.securityScore?.id, 'security');
  assert.equal(card.securityScore?.baseWeight, 10);
  assert.equal(card.securityScore?.score, 100);
  assert.equal(card.securityScore?.insufficientData, false);
  assert.equal(card.overallScore, 100);
  // GBP/Social still missing -> completeness < 70 -> Provisional stays true
  assert.equal(card.isProvisional, true);

  // If >= 50% of security findings are unknown, securityScore must be excluded as insufficientData
  const mostlyUnknownSec = analyzePassiveSecurity({
    finalUrl: 'https://unknown-sec.example/',
    isHttps: true,
    html: cleanHtml,
    headers: {},
    headersChecked: false, // 7/12 unknown (>50%)
  });
  const auditInsufficient = makeMinimalAudit([
    {
      id: 'seo-https',
      category: 'seo',
      label: 'HTTPS',
      status: 'pass',
      evidence: 'HTTPS active',
      fix: 'None',
      businessImpact: 'Security',
      weight: 5,
    },
    ...mostlyUnknownSec.findings,
  ]);
  const cardInsufficient = computeScorecard(
    auditInsufficient,
    createEmptyManualFootprint(),
    createDefaultAssumptions()
  );
  assert.equal(cardInsufficient.securityScore?.insufficientData, true);
  assert.equal(cardInsufficient.securityScore?.score, null);
  assert.equal(cardInsufficient.securityScore?.effectiveWeight, 0);
});

test('PASSIVE SECURITY GITHUB & MCP: maps high-severity findings to vercel/next/netlify/nginx snippets and audit pipeline', async () => {
  const secAudit = analyzePassiveSecurity({
    finalUrl: 'https://header-gap.example/',
    isHttps: true,
    html: '<!doctype html><html lang="en"><head><title>Header Gap Resort</title></head><body><h1>Resort</h1><a href="tel:+639171234567">Call</a><p>Direct bookings open daily with local concierge support and private boat pickup in Palawan.</p></body></html>',
    headers: {
      server: 'nginx/1.22.0',
    },
  });

  const audit = makeMinimalAudit([...secAudit.findings]);
  audit.security = secAudit;
  const scorecard = computeScorecard(audit, createEmptyManualFootprint(), createDefaultAssumptions());
  const aiSummary = buildAiReadinessSummary(audit);
  const actions = buildRepoChangeChecklist(audit, aiSummary);

  const cspAction = actions.find((a) => a.findingId === 'sec-csp');
  assert.equal(cspAction?.priority, 'P0');
  assert.equal(cspAction?.severity, 'high');
  assert.ok(cspAction?.targetRepoPaths.includes('vercel.json'));
  assert.ok(cspAction?.targetRepoPaths.includes('next.config.js'));
  assert.ok(cspAction?.snippets?.['vercel.json']);
  assert.ok(cspAction?.snippets?.['next.config.js']);
  assert.ok(cspAction?.snippets?.['_headers']);
  assert.ok(cspAction?.snippets?.['nginx.conf']);

  const snippets = buildSecurityHeaderSnippets(audit);
  assert.match(snippets['vercel.json'], /Content-Security-Policy/);
  assert.match(snippets['next.config.js'], /Strict-Transport-Security/);
  assert.match(snippets['_headers'], /X-Content-Type-Options: nosniff/);
  assert.match(snippets['nginx.conf'], /add_header Strict-Transport-Security/);

  const reportMd = buildAgentMarkdownReport({
    url: 'https://header-gap.example/',
    project: {
      clientName: 'Header Gap Resort',
      businessType: 'Resort',
      brief: 'Direct bookings',
      brandColor: '#0F766E',
      logoDataUrl: null,
    },
    audit,
    scorecard,
    aiSummary,
    repoChanges: actions,
  });
  assert.match(reportMd, /## Passive Security & Headers Audit/);
  assert.match(reportMd, /Content-Security-Policy/);

  // executeFullSiteAudit integration populates audit.security passively
  const fullAudit = await executeFullSiteAudit('https://clean-pass.example/', {
    deps: {
      validateUrl: async (u) => new URL(u),
      fetchHtml: async (u) => {
        if (u.endsWith('/robots.txt')) {
          return {
            finalUrl: u,
            statusCode: 200,
            ttfbMs: 12,
            bytes: 24,
            text: 'User-agent: *\nAllow: /',
            contentType: 'text/plain',
          };
        }
        if (u.endsWith('/sitemap.xml') || u.endsWith('/llms.txt')) {
          return {
            finalUrl: u,
            statusCode: 200,
            ttfbMs: 12,
            bytes: 20,
            text: '<urlset></urlset>',
            contentType: 'application/xml',
          };
        }
        return {
          finalUrl: 'https://clean-pass.example/',
          statusCode: 200,
          ttfbMs: 110,
          bytes: 400,
          text: '<!doctype html><html lang="en"><head><title>Clean Pass Resort</title></head><body><h1>Welcome</h1><p>Direct beachfront hospitality in Palawan with daily breakfast and airport transfers included for all stays.</p></body></html>',
          contentType: 'text/html',
          headers: {
            'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
            'strict-transport-security': 'max-age=31536000; includeSubDomains',
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'strict-origin-when-cross-origin',
            'permissions-policy': 'camera=()',
          },
          setCookies: [],
        };
      },
      runSpeed: async () => ({ speed: null, reason: 'Skipped in unit test' }),
      probeTls: async () => ({ protocol: 'TLSv1.3', certificateValid: true, validTo: null }),
    },
  });

  assert.ok(fullAudit.security);
  assert.equal(fullAudit.security?.badgeEligible, true);
  assert.equal(fullAudit.security?.tls.protocol, 'TLSv1.3');
  assert.equal(fullAudit.findings.some((f) => f.id === 'sec-csp' && f.status === 'pass'), true);

  // MCP tool tourforge_generate_repo_fixes surfaces security snippets & badge when eligible
  const mcpFixes = await handleMcpToolCall('tourforge_generate_repo_fixes', {
    url: 'https://clean-pass.example/',
    clientName: 'Clean Pass Resort',
    auditResult: fullAudit,
  });
  const mcpData = JSON.parse(mcpFixes.content[0].text) as {
    files: Record<string, string>;
  };
  assert.match(mcpData.files['vercel.json'], /Content-Security-Policy/);
  assert.match(mcpData.files['next.config.js'], /Strict-Transport-Security/);
  assert.match(mcpData.files['_headers'], /X-Content-Type-Options: nosniff/);
  assert.match(mcpData.files['nginx.conf'], /add_header Strict-Transport-Security/);
  assert.match(mcpData.files['security-badge.html'], /Security Passed/);
});







