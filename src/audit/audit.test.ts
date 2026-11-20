import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
  parseHtmlWithCheerio,
} from './htmlFindings';
import {
  buildOutreachSummary,
  computeIgnoredLeadsEstimate,
  computeScorecard,
  getLetterGrade,
  getRagBand,
} from './scorecard';
import { buildValidatedJsonLd, selectJsonLdBusinessType } from './jsonLd';
import { migrateImportedBundle } from './bundleMigration';
import { createWalkthroughSchema } from '../types/tour';

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

  assert.equal(getLetterGrade(85), 'A');
  assert.equal(getLetterGrade(70), 'B');
  assert.equal(getLetterGrade(55), 'C');
  assert.equal(getLetterGrade(40), 'D');
  assert.equal(getLetterGrade(39), 'F');
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
  assert.ok(outreach.includes('[Provisional]'));
  assert.ok(outreach.includes('Add Google Business Profile data for a final grade.'));
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

