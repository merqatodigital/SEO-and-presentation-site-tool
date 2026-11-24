import { ProjectBrief } from '../types/tour';
import { CompetitorBenchmarkRow, ManualFootprint } from './types';

export interface GbpCompetitorBenchmarkSummary {
  competitors: CompetitorBenchmarkRow[];
  clientReviews: number | null;
  clientRating: number | null;
  clientPhotos: number | null;
  clientPosts90d: number | null;
  avgCompetitorReviews: number | null;
  topCompetitorReviews: number | null;
  topCompetitorName: string | null;
  reviewGapToLeader: number | null;
  avgCompetitorRating: number | null;
  avgCompetitorPhotos: number | null;
  photoGapToLeader: number | null;
  avgCompetitorPosts90d: number | null;
  summaryLine: string;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function computeGbpCompetitorBenchmark(
  manual: ManualFootprint,
  clientName: string
): GbpCompetitorBenchmarkSummary {
  const competitors = (manual.competitors ?? []).filter(
    (c) =>
      c.name.trim() !== '' ||
      c.reviewCount !== null ||
      c.averageRating !== null ||
      c.photoCount !== null ||
      c.postsLast90Days !== null
  );

  const clientReviews = manual.gbp.reviewCount;
  const clientRating = manual.gbp.averageRating;
  const clientPhotos = manual.gbp.photoCount;
  const clientPosts90d = manual.gbp.postsLast90Days;

  const compReviews = competitors
    .map((c) => c.reviewCount)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const compRatings = competitors
    .map((c) => c.averageRating)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const compPhotos = competitors
    .map((c) => c.photoCount)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const compPosts = competitors
    .map((c) => c.postsLast90Days)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  let topCompetitorReviews: number | null = null;
  let topCompetitorName: string | null = null;
  for (const comp of competitors) {
    if (comp.reviewCount !== null && (topCompetitorReviews === null || comp.reviewCount > topCompetitorReviews)) {
      topCompetitorReviews = comp.reviewCount;
      topCompetitorName = comp.name.trim() || 'Top local competitor';
    }
  }

  let topCompetitorPhotos: number | null = null;
  for (const comp of competitors) {
    if (comp.photoCount !== null && (topCompetitorPhotos === null || comp.photoCount > topCompetitorPhotos)) {
      topCompetitorPhotos = comp.photoCount;
    }
  }

  const avgCompetitorReviewsRaw = avg(compReviews);
  const avgCompetitorReviews =
    avgCompetitorReviewsRaw !== null ? Math.round(avgCompetitorReviewsRaw) : null;

  const avgCompetitorRatingRaw = avg(compRatings);
  const avgCompetitorRating =
    avgCompetitorRatingRaw !== null ? Number(avgCompetitorRatingRaw.toFixed(1)) : null;

  const avgCompetitorPhotosRaw = avg(compPhotos);
  const avgCompetitorPhotos =
    avgCompetitorPhotosRaw !== null ? Math.round(avgCompetitorPhotosRaw) : null;

  const avgCompetitorPostsRaw = avg(compPosts);
  const avgCompetitorPosts90d =
    avgCompetitorPostsRaw !== null ? Math.round(avgCompetitorPostsRaw) : null;

  const reviewGapToLeader =
    topCompetitorReviews !== null && clientReviews !== null
      ? topCompetitorReviews - clientReviews
      : null;

  const photoGapToLeader =
    topCompetitorPhotos !== null && clientPhotos !== null
      ? topCompetitorPhotos - clientPhotos
      : null;

  const name = clientName.trim() || 'Client';
  let summaryLine = 'Add 1–2 local competitors above to benchmark reviews, star rating, and photos side by side.';
  if (competitors.length > 0) {
    if (reviewGapToLeader !== null && topCompetitorName) {
      if (reviewGapToLeader > 0) {
        summaryLine = `${name} trails ${topCompetitorName} by ${reviewGapToLeader} reviews (${clientReviews} vs ${topCompetitorReviews}).`;
      } else if (reviewGapToLeader === 0) {
        summaryLine = `${name} is tied with ${topCompetitorName} at ${clientReviews} reviews.`;
      } else {
        summaryLine = `${name} leads ${topCompetitorName} by ${Math.abs(reviewGapToLeader)} reviews (${clientReviews} vs ${topCompetitorReviews}).`;
      }
    } else {
      summaryLine = `Benchmarking ${competitors.length} local competitor${competitors.length > 1 ? 's' : ''}.`;
    }
  }

  return {
    competitors,
    clientReviews,
    clientRating,
    clientPhotos,
    clientPosts90d,
    avgCompetitorReviews,
    topCompetitorReviews,
    topCompetitorName,
    reviewGapToLeader,
    avgCompetitorRating,
    avgCompetitorPhotos,
    photoGapToLeader,
    avgCompetitorPosts90d,
    summaryLine,
  };
}

export interface GbpPlaybookAction {
  priority: 'Urgent' | 'This Week' | 'Monthly';
  title: string;
  detail: string;
}

export interface GbpActionPlaybook {
  prioritizedActions: GbpPlaybookAction[];
  photoShotList: string[];
  reviewTemplates: Array<{ channel: string; script: string }>;
  qaSeeds: Array<{ question: string; answerPrompt: string }>;
}

function buildPhotoShotList(businessType: string): string[] {
  const lower = businessType.toLowerCase();
  if (/\b(hotel|resort|villa|inn|lodge|hostel|staycation|guesthouse)\b/.test(lower)) {
    return [
      'Exterior daytime facade + signage (clear landmark view from street)',
      'Sunset / warm-lit exterior or pool deck overview',
      'Each room category showing freshly made bed + natural window light',
      'Clean en-suite bathroom & toiletries close-up',
      'Breakfast area, dining terrace, or coffee bar in morning light',
      'Reception desk with smiling front-desk team member',
      'Parking entrance / drop-off zone or beach access path',
    ];
  }
  if (/\b(dental|dentist|dentistry|clinic|medical|doctor|derma|physio|healthcare)\b/.test(lower)) {
    return [
      'Street-level clinic exterior & entrance signage for easy parking recognition',
      'Bright, calm reception desk & waiting lounge',
      'Lead dentist/doctor portrait in clean clinical coat',
      'Sanitized treatment room & modern diagnostic equipment',
      'Friendly team group photo near clinic entrance',
      'Clear hallway / accessibility ramp & wheelchair access',
    ];
  }
  if (/\b(restaurant|cafe|coffee|bakery|bistro|dining|grill|kitchen)\b/.test(lower)) {
    return [
      'Storefront signage & outdoor seating in daylight',
      '5–8 signature dishes & bestselling drinks in crisp natural lighting',
      'Cozy indoor dining room angle showing table spacing',
      'Chef/barista preparing fresh food or coffee behind counter',
      'Printed or digital menu board close-up',
    ];
  }
  return [
    'Clear exterior storefront & street signage photo',
    'Interior workspace / customer welcome desk',
    'Founder or front-line service team portrait',
    '6+ real photos of completed projects or core services in action',
    'Parking entrance, directional sign, and waiting area',
  ];
}

export function buildGbpActionPlaybook(
  manual: ManualFootprint,
  project: ProjectBrief,
  clientName: string
): GbpActionPlaybook {
  const name = clientName.trim() || manual.nap.businessName.trim() || 'our business';
  const businessType = project.businessType.trim() || 'Local Service';
  const benchmark = computeGbpCompetitorBenchmark(manual, name);

  const actions: GbpPlaybookAction[] = [];

  if (manual.gbp.claimed !== 'yes') {
    actions.push({
      priority: 'Urgent',
      title: 'Claim and verify Business Profile ownership',
      detail: 'Unclaimed profiles allow competitors or random users to edit hours, phone numbers, or mark the business closed.',
    });
  }
  if (manual.gbp.primaryCategorySet !== 'yes') {
    actions.push({
      priority: 'Urgent',
      title: `Lock primary GBP category to exact match for "${businessType}"`,
      detail: 'Add 2–3 secondary categories that reflect high-margin services without keyword-stuffing the business name.',
    });
  }
  if (manual.gbp.hoursListed !== 'yes') {
    actions.push({
      priority: 'Urgent',
      title: 'Publish accurate opening hours + holiday exceptions',
      detail: 'Profiles missing opening hours drop down Map Pack rankings when users filter by "Open now".',
    });
  }
  if (manual.gbp.bookingOrMenuLinkSet !== 'yes') {
    actions.push({
      priority: 'Urgent',
      title: 'Add commission-free direct booking / inquiry URL to profile',
      detail: 'Point the GBP Website & Appointment links directly to your tracked booking or WhatsApp landing page.',
    });
  }

  const targetReviews =
    benchmark.topCompetitorReviews !== null
      ? Math.max(50, benchmark.topCompetitorReviews + 5)
      : 50;
  if (manual.gbp.reviewCount === null || manual.gbp.reviewCount < targetReviews) {
    const currentText =
      manual.gbp.reviewCount !== null ? `${manual.gbp.reviewCount}` : 'current';
    actions.push({
      priority: 'This Week',
      title: `Close review gap (${currentText} → target ${targetReviews}+ reviews)`,
      detail:
        benchmark.reviewGapToLeader !== null && benchmark.reviewGapToLeader > 0
          ? `${name} currently trails ${benchmark.topCompetitorName} by ${benchmark.reviewGapToLeader} reviews. Send the automated post-visit link to reach 5–10 new reviews per month.`
          : 'Send a direct 1-tap review link via WhatsApp or SMS within 2 hours of service completion.',
    });
  }

  if (manual.gbp.ownerReplies !== 'most') {
    actions.push({
      priority: 'This Week',
      title: 'Reply to all existing & incoming reviews within 48 hours',
      detail: 'Mention the service delivered and city/area naturally in replies — never copy-paste identical responses.',
    });
  }

  const targetPhotos =
    benchmark.avgCompetitorPhotos !== null ? Math.max(20, benchmark.avgCompetitorPhotos) : 20;
  if (manual.gbp.photoCount === null || manual.gbp.photoCount < targetPhotos) {
    actions.push({
      priority: 'This Week',
      title: `Upload ${targetPhotos}+ genuine geo-clear photos`,
      detail: 'Upload 3–5 fresh photos every week rather than dumping all at once so the profile signals active management.',
    });
  }

  if (manual.gbp.qaAnswered !== 'yes') {
    actions.push({
      priority: 'This Week',
      title: 'Seed & answer top 5 customer Questions on GBP',
      detail: 'Customers frequently check parking, rates, walk-in rules, and payment methods inside GBP Q&A before calling.',
    });
  }

  if (manual.gbp.postsLast90Days === null || manual.gbp.postsLast90Days < 3) {
    actions.push({
      priority: 'Monthly',
      title: 'Publish 2–4 GBP Updates / Offers per month',
      detail: 'Highlight seasonal promos, direct-booking perks, and new photos with a clear "Book" or "Call now" button.',
    });
  }

  const reviewTemplates = [
    {
      channel: 'WhatsApp / Viber (Same Day)',
      script: `Hi [First Name]! Thanks for visiting ${name} today. Could you spare 20 seconds to share how your experience went? Your feedback helps local guests find us directly: [GBP Review Link] — Thank you!`,
    },
    {
      channel: 'SMS Follow-Up',
      script: `Thank you for choosing ${name}! We'd love a quick rating if we took good care of you today: [GBP Review Link]`,
    },
    {
      channel: 'In-Person Counter / QR Card',
      script: `"If everything was 5-star today, scanning this code leaves a quick Google Maps review for our team at ${name}!"`,
    },
  ];

  const qaSeeds = [
    {
      question: `How do I book directly with ${name} without extra platform fees?`,
      answerPrompt: `Message us directly on WhatsApp/Viber or book on our official website (${project.websiteUrl || 'website link'}) for instant confirmation and direct rates.`,
    },
    {
      question: `Where is ${name} located and is parking available?`,
      answerPrompt: `Give exact landmark directions from the main road and specify on-site or nearby street parking.`,
    },
    {
      question: `What are your operating hours and fastest contact method?`,
      answerPrompt: `${manual.openingHoursText || 'State exact daily hours'} — reach us fastest by phone or direct chat for same-day replies.`,
    },
    {
      question: `What payment methods do you accept?`,
      answerPrompt: `List Cash, GCash / Maya, bank transfer, and major cards accepted on-site.`,
    },
  ];

  return {
    prioritizedActions: actions,
    photoShotList: buildPhotoShotList(businessType),
    reviewTemplates,
    qaSeeds,
  };
}
