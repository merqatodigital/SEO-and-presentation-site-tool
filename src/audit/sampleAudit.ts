import { buildAutomatedFindings } from './htmlFindings';
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

  const findings = buildAutomatedFindings({
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
  manual.openingHoursText = 'Mon-Sat 09:00-19:00';
  manual.priceRange = '$$';

  const assumptions: AuditAssumptions = {
    monthlyVisitors: 900,
    inquiryRatePct: 2,
    avgBookingValuePhp: 3500,
    slowLoadLossPct: null,
    missingContactLossPct: null,
    lowReviewTrustLossPct: null,
  };

  return { audit, manualFootprint: manual, assumptions };
}
