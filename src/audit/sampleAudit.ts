import { buildAutomatedFindings } from './htmlFindings';
import { analyzePassiveSecurity } from './securityFindings';
import { AuditAssumptions, AuditResult, ManualFootprint, createEmptyManualFootprint } from './types';

export function buildSampleAudit(): {
  audit: AuditResult;
  manualFootprint: ManualFootprint;
  assumptions: AuditAssumptions;
} {
  const parsed = {
    title: 'Harborcrest Dental Studio',
    titleLength: 25,
    metaDescription: 'Family dental care in North Harbor.',
    metaDescriptionLength: 37,
    canonical: null,
    viewport: 'width=device-width, initial-scale=1',
    htmlLang: 'en',
    h1Count: 1,
    h2Count: 4,
    headings: [
      'Calm, Modern Family Dentistry Right on Your Schedule',
      'Choose Your Visit & Time in 60 Seconds',
      'Meet the Doctors & Real Patient Stories',
      'Automated Reminders & Patient Retention',
    ],
    ogSiteName: 'Harborcrest Dental Studio',
    ogTitle: 'Harborcrest Dental Studio',
    ogDescription: 'Family dental care in North Harbor.',
    ogImage: null,
    imagesTotal: 12,
    imagesMissingAlt: 5,
    jsonLdTypes: [],
    jsonLdInvalidCount: 0,
    links: {
      tel: [],
      mailto: ['mailto:care@harborcrest-dental.example'],
      whatsapp: [],
      messenger: [],
      viber: [],
      facebook: ['https://facebook.com/harborcrestdental'],
      instagram: [],
      tiktok: [],
      tripadvisor: [],
      bookingCom: [],
      agoda: [],
      airbnb: [],
      mapLinks: ['https://maps.app.goo.gl/exampleHarborcrest'],
    },
    formCount: 1,
    ctaTexts: ['Book Visit Online', 'Reserve Appointment'],
  };

  const robotsTxt = { exists: true, allowsIndexing: true };
  const sitemapXml = { exists: false, reason: 'No /sitemap.xml found (HTTP 404)' };
  const speed = {
    scores: {
      performance: 46,
      seo: 74,
      accessibility: 82,
      bestPractices: 79,
    },
    fcpMs: 2400,
    lcpMs: 5200,
    cls: 0.14,
    tbtMs: 380,
    speedIndexMs: 4900,
    totalByteWeight: Math.round(2.45 * 1024 * 1024),
    opportunities: [
      {
        id: 'render-blocking-resources',
        title: 'Eliminate render-blocking stylesheets',
        savingsText: '1.1 s',
      },
      {
        id: 'uses-optimized-images',
        title: 'Compress and resize hero clinic photos',
        savingsText: '980 KB',
      },
      {
        id: 'unused-javascript',
        title: 'Reduce unused booking widget JavaScript',
        savingsText: '420 KB',
      },
    ],
  };

  const baseFindings = buildAutomatedFindings({
    isHttps: true,
    fetchError: null,
    ttfbMs: 420,
    ttfbSampleCount: 3,
    parsed,
    robotsTxt,
    sitemapXml,
    speed,
    speedReason: null,
  });

  const security = analyzePassiveSecurity({
    finalUrl: 'https://harborcrest-dental.example/',
    isHttps: true,
    html: '<html><head><title>Harborcrest Dental Studio</title></head><body><form method="post" action="/book"><input type="text" name="patientName" /></form></body></html>',
    headers: {
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=()',
    },
    setCookies: [],
    tlsInfo: { protocol: 'TLSv1.3', certificateValid: true, validTo: '2027-06-01' },
    headersChecked: true,
  });

  const findings = [...baseFindings, ...security.findings];

  const audit: AuditResult = {
    schemaVersion: '1.0',
    requestedUrl: 'https://harborcrest-dental.example',
    finalUrl: 'https://harborcrest-dental.example/',
    auditedAt: new Date().toISOString(),
    httpStatus: 200,
    ttfbMs: 420,
    ttfbSamplesMs: [405, 420, 465],
    htmlBytes: 48200,
    isHttps: true,
    fetchError: null,
    contentSource: 'raw',
    auditNotes: [
      {
        code: 'sample',
        message: 'Sample audit data is loaded offline; run a live audit on any public URL to test a real site.',
      },
    ],
    aiReadiness: {
      robotsChecked: true,
      botAccess: [
        { bot: 'GPTBot', label: 'OpenAI GPTBot (Search & Training)', status: 'allowed' },
        { bot: 'ChatGPT-User', label: 'ChatGPT Live Browsing', status: 'allowed' },
        { bot: 'OAI-SearchBot', label: 'OpenAI Search Index', status: 'allowed' },
        { bot: 'ClaudeBot', label: 'Anthropic ClaudeBot', status: 'blocked' },
        { bot: 'anthropic-ai', label: 'Anthropic AI Crawler', status: 'allowed' },
        { bot: 'PerplexityBot', label: 'Perplexity Search Crawler', status: 'allowed' },
      ],
      llmsTxt: {
        exists: false,
        url: 'https://harborcrest-dental.example/llms.txt',
        bytes: null,
        preview: null,
        reason: 'No /llms.txt found (HTTP 404)',
      },
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
    },
    security,
    parsed,
    robotsTxt,
    sitemapXml,
    speed,
    speedReason: null,
    findings,
  };

  const manual = createEmptyManualFootprint();
  manual.nap = {
    businessName: 'Harborcrest Dental Studio',
    fullAddress: '142 Harbor Boulevard, North Harbor',
    phone: '0917 555 0180',
  };
  manual.gbp = {
    claimed: 'yes',
    primaryCategorySet: 'yes',
    hoursListed: 'yes',
    photoCount: 14,
    postsLast90Days: 1,
    reviewCount: 38,
    averageRating: 4.2,
    ownerReplies: 'some',
    qaAnswered: 'no',
    bookingOrMenuLinkSet: 'no',
  };
  manual.facebook = {
    exists: 'yes',
    url: 'https://facebook.com/harborcrestdental',
    lastPostDate: new Date(Date.now() - 48 * 86400_000).toISOString().slice(0, 10),
    followers: 1840,
    messengerRepliesWithinDay: 'no',
  };
  manual.instagram = {
    exists: 'no',
    url: '',
    lastPostDate: '',
    followers: null,
  };
  manual.listings[0] = {
    ...manual.listings[0],
    listed: 'yes',
    seenName: 'Harborcrest Dental Studio',
    seenAddress: '142 Harbor Blvd, North Harbor',
    seenPhone: '+639175550180',
  };
  manual.listings[6] = {
    ...manual.listings[6],
    platform: 'Local Healthcare Directory',
    listed: 'yes',
    seenName: 'Harborcrest Clinic',
    seenAddress: '142 Harbor Blvd',
    seenPhone: '09175559999',
  };
  manual.competitors = [
    {
      id: 'comp-1',
      name: 'North Harbor Dental Group',
      category: 'Dentist',
      reviewCount: 112,
      averageRating: 4.7,
      photoCount: 46,
      postsLast90Days: 6,
    },
    {
      id: 'comp-2',
      name: 'Bayside Smile Clinic',
      category: 'Cosmetic Dentist',
      reviewCount: 64,
      averageRating: 4.5,
      photoCount: 28,
      postsLast90Days: 3,
    },
  ];
  manual.openingHoursText = 'Mon-Sat 09:00-19:00';
  manual.priceRange = '$$';

  const assumptions: AuditAssumptions = {
    currency: 'PHP',
    monthlyVisitors: 900,
    inquiryRatePct: 2,
    avgBookingValuePhp: 3500,
    slowLoadLossPct: null,
    missingContactLossPct: null,
    lowReviewTrustLossPct: null,
  };

  return { audit, manualFootprint: manual, assumptions };
}
