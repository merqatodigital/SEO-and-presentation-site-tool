import { manualFootprintToFindings } from './nap';
import {
  AUDIT_CATEGORIES,
  AuditAssumptions,
  AuditCategoryId,
  AuditFinding,
  AuditNote,
  AuditResult,
  CategoryScore,
  IgnoredLeadsEstimate,
  LetterGrade,
  ManualFootprint,
  RagBand,
  Scorecard,
} from './types';

export function getRagBand(score: number | null): RagBand {
  if (score === null) return 'unknown';
  if (score >= 80) return 'green';
  if (score >= 50) return 'amber';
  return 'red';
}

export function getRagLabel(rag: RagBand): string {
  switch (rag) {
    case 'green':
      return 'Strong (Green)';
    case 'amber':
      return 'Needs Work (Amber)';
    case 'red':
      return 'At Risk (Red)';
    default:
      return 'Insufficient data';
  }
}

export function getLetterGrade(score: number | null): LetterGrade {
  if (score === null) return 'N/A';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function findingPoints(status: AuditFinding['status']): number | null {
  if (status === 'pass') return 1;
  if (status === 'warn') return 0.5;
  if (status === 'fail') return 0;
  return null;
}

export function computeIgnoredLeadsEstimate(
  allFindings: AuditFinding[],
  manual: ManualFootprint,
  assumptions: AuditAssumptions
): IgnoredLeadsEstimate {
  const disclaimer = 'Estimate from stated assumptions, not a measured figure.';
  const lcpFinding = allFindings.find((f) => f.id === 'speed-lcp');
  const telFinding = allFindings.find((f) => f.id === 'contact-tel');
  const msgFinding = allFindings.find((f) => f.id === 'contact-messaging');

  const defaultSlowPct =
    lcpFinding?.status === 'fail' ? 10 : lcpFinding?.status === 'warn' ? 5 : 0;

  const missingContact =
    telFinding?.status === 'fail' && msgFinding?.status === 'fail';
  const defaultMissingContactPct = missingContact ? 10 : 0;

  const lowTrustByInput =
    (manual.gbp.averageRating !== null && manual.gbp.averageRating < 4.0) ||
    (manual.gbp.reviewCount !== null && manual.gbp.reviewCount < 15);
  const lowTrustByFinding = allFindings.some(
    (f) => (f.id === 'gbp-rating' || f.id === 'gbp-reviews-count') && f.status === 'fail'
  );
  const defaultReviewTrustPct = lowTrustByInput || lowTrustByFinding ? 10 : 0;

  const slowLoad =
    assumptions.slowLoadLossPct !== null ? assumptions.slowLoadLossPct : defaultSlowPct;
  const missingContactPct =
    assumptions.missingContactLossPct !== null
      ? assumptions.missingContactLossPct
      : defaultMissingContactPct;
  const lowReviewTrust =
    assumptions.lowReviewTrustLossPct !== null
      ? assumptions.lowReviewTrustLossPct
      : defaultReviewTrustPct;

  const effectiveLossPct = Math.min(85, Math.max(0, slowLoad + missingContactPct + lowReviewTrust));

  const visitors = assumptions.monthlyVisitors;
  if (visitors === null || !Number.isFinite(visitors) || visitors <= 0) {
    return {
      visible: false,
      monthlyVisitors: null,
      inquiryRatePct: assumptions.inquiryRatePct,
      avgBookingValuePhp: assumptions.avgBookingValuePhp,
      effectiveLossPct,
      breakdownPct: {
        slowLoad,
        missingContact: missingContactPct,
        lowReviewTrust,
      },
      inquiriesLostLow: 0,
      inquiriesLostHigh: 0,
      revenueLostPhpLow: null,
      revenueLostPhpHigh: null,
      disclaimer,
    };
  }

  const expectedInquiries = visitors * (Math.max(0, assumptions.inquiryRatePct) / 100);
  const centralLost = expectedInquiries * (effectiveLossPct / 100);

  const roundInquiries = (n: number) =>
    n < 10 ? Number(n.toFixed(1)) : Math.round(n);

  const inquiriesLostLow = roundInquiries(centralLost * 0.6);
  const inquiriesLostHigh = roundInquiries(centralLost * 1.4);

  const bookingVal = assumptions.avgBookingValuePhp;
  const hasBookingVal = bookingVal !== null && Number.isFinite(bookingVal) && bookingVal > 0;
  const revenueLostPhpLow = hasBookingVal
    ? Math.round(centralLost * 0.6 * bookingVal)
    : null;
  const revenueLostPhpHigh = hasBookingVal
    ? Math.round(centralLost * 1.4 * bookingVal)
    : null;

  return {
    visible: true,
    monthlyVisitors: visitors,
    inquiryRatePct: assumptions.inquiryRatePct,
    avgBookingValuePhp: hasBookingVal ? bookingVal : null,
    effectiveLossPct,
    breakdownPct: {
      slowLoad,
      missingContact: missingContactPct,
      lowReviewTrust,
    },
    inquiriesLostLow,
    inquiriesLostHigh,
    revenueLostPhpLow,
    revenueLostPhpHigh,
    disclaimer,
  };
}

export function computeScorecard(
  audit: AuditResult | null,
  manual: ManualFootprint,
  assumptions: AuditAssumptions
): Scorecard {
  const autoFindings = audit?.findings ?? [];
  const manualFindings = manualFootprintToFindings(manual);

  // Deduplicate by finding ID in case an external bundle supplies merged findings
  const mergedMap = new Map<string, AuditFinding>();
  for (const f of autoFindings) mergedMap.set(f.id, f);
  for (const f of manualFindings) mergedMap.set(f.id, f);
  const allFindings = Array.from(mergedMap.values());

  const totalChecks = allFindings.length;
  const knownChecks = allFindings.filter((f) => f.status !== 'unknown').length;
  const dataCompletenessPct =
    totalChecks > 0 ? Math.round((knownChecks / totalChecks) * 100) : 0;

  const rawCategories = AUDIT_CATEGORIES.map((def) => {
    const catFindings = allFindings.filter((f) => f.category === def.id);
    let weightedScoreSum = 0;
    let totalWeight = 0;
    let knownCount = 0;

    for (const f of catFindings) {
      const pts = findingPoints(f.status);
      if (pts === null) continue;
      knownCount++;
      weightedScoreSum += pts * f.weight;
      totalWeight += f.weight;
    }

    const totalCount = catFindings.length;
    const insufficientData = totalCount === 0 || knownCount * 2 < totalCount;
    const score =
      !insufficientData && totalWeight > 0
        ? Math.round((weightedScoreSum / totalWeight) * 100)
        : null;

    return {
      id: def.id,
      label: def.label,
      baseWeight: def.weight,
      score,
      rag: getRagBand(score),
      knownCount,
      totalCount,
      insufficientData,
    };
  });

  // Renormalize weights across categories with >=50% measured findings
  const activeWeightSum = rawCategories.reduce(
    (sum, cat) => (cat.score !== null && !cat.insufficientData ? sum + cat.baseWeight : sum),
    0
  );

  let overallWeightedSum = 0;
  const categories: CategoryScore[] = rawCategories.map((cat) => {
    const isActive = cat.score !== null && !cat.insufficientData && activeWeightSum > 0;
    const effectiveWeight = isActive
      ? Number(((cat.baseWeight / activeWeightSum) * 100).toFixed(1))
      : 0;
    if (isActive && cat.score !== null) {
      overallWeightedSum += (cat.score * cat.baseWeight) / activeWeightSum;
    }
    return {
      ...cat,
      effectiveWeight,
    };
  });

  const overallScore = activeWeightSum > 0 ? Math.round(overallWeightedSum) : null;
  const categoryScoreLookup = new Map<AuditCategoryId, number>(
    categories.map((c) => [c.id, c.score ?? 100])
  );

  // Top 5 non-pass (fail/warn) findings sorted by weight desc, then lowest category score asc
  const fixFirst = allFindings
    .filter((f) => f.status === 'fail' || f.status === 'warn')
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      const catScoreA = categoryScoreLookup.get(a.category) ?? 100;
      const catScoreB = categoryScoreLookup.get(b.category) ?? 100;
      if (catScoreA !== catScoreB) return catScoreA - catScoreB;
      if (a.status !== b.status) return a.status === 'fail' ? -1 : 1;
      return a.id.localeCompare(b.id);
    })
    .slice(0, 5);

  const ignoredLeads = computeIgnoredLeadsEstimate(allFindings, manual, assumptions);
  const isProvisional = dataCompletenessPct < 70;

  return {
    overallScore,
    grade: getLetterGrade(overallScore),
    rag: getRagBand(overallScore),
    dataCompletenessPct,
    isProvisional,
    knownChecks,
    totalChecks,
    categories,
    fixFirst,
    allFindings,
    ignoredLeads,
  };
}

export function buildOutreachSummary(
  clientName: string,
  websiteUrl: string,
  scorecard: Scorecard,
  auditNotes?: AuditNote[]
): string {
  const displayClient = clientName.trim() || 'your team';
  const displayUrl = websiteUrl.trim() || 'your website';
  const isProvisional = scorecard.isProvisional ?? scorecard.dataCompletenessPct < 70;
  const provisionalBadge = isProvisional ? ' [Provisional]' : '';
  const scorePart =
    scorecard.overallScore !== null
      ? `${scorecard.overallScore}/100 (Grade ${scorecard.grade}${provisionalBadge})`
      : `incomplete${provisionalBadge}`;

  const top3 = scorecard.fixFirst.slice(0, 3);
  const bullets =
    top3.length > 0
      ? top3
          .map((f, idx) => `${idx + 1}. ${f.label} (${f.evidence}) — ${f.businessImpact}`)
          .join('\n')
      : 'No urgent website blockers were flagged yet.';

  const lines = [
    `Hi [Owner / Team Name],`,
    ``,
    `Hope your week is going well! I ran a quick digital visibility check on ${displayUrl} for ${displayClient} — it scored ${scorePart}.`,
    ``,
    `Here are the top 3 quick wins that could bring in more direct bookings and inquiries:`,
    bullets,
  ];

  if (auditNotes && auditNotes.length > 0) {
    lines.push(``);
    for (const note of auditNotes) {
      lines.push(`Note: ${note.message}`);
    }
  }

  if (isProvisional) {
    lines.push(``, `Add Google Business Profile data for a final grade.`);
  }

  lines.push(
    ``,
    `Happy to send over the full 1-page scorecard with exact numbers anytime — just reply if you'd like a copy!`
  );

  return lines.join('\n');
}
