import {
  AuditFinding,
  ListingRow,
  ManualFootprint,
} from './types';

const LEGAL_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'llc',
  'ltd',
  'limited',
  'co',
  'company',
  'opc',
  'plc',
  'pty',
  'gmbh',
  'ph',
  'philippines',
]);

const ADDRESS_SYNONYMS: Record<string, string> = {
  st: 'street',
  ave: 'avenue',
  rd: 'road',
  blvd: 'boulevard',
  dr: 'drive',
  ln: 'lane',
  brgy: 'barangay',
  bgy: 'barangay',
  ste: 'suite',
  flr: 'floor',
  bldg: 'building',
};

export function normalizeBusinessName(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens.join(' ').trim();
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  // Normalize Philippine international format (+63 / 63) to local 0-prefixed digits
  if (digits.startsWith('63') && digits.length >= 11) {
    return `0${digits.slice(2)}`;
  }
  // 10-digit mobile without leading 0 (e.g., 9171234567)
  if (digits.length === 10 && digits.startsWith('9')) {
    return `0${digits}`;
  }
  return digits;
}

export function tokenizeAddress(raw: string): Set<string> {
  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ADDRESS_SYNONYMS[word] || word);
  return new Set(words);
}

export function addressTokenOverlap(a: string, b: string): number {
  const setA = tokenizeAddress(a);
  const setB = tokenizeAddress(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let matches = 0;
  for (const token of setA) {
    if (setB.has(token)) matches++;
  }
  return matches / Math.max(setA.size, setB.size);
}

export interface NapFieldCheck {
  checked: boolean;
  match: boolean;
}

export interface NapListingComparison {
  listingId: string;
  platform: string;
  overallStatus: 'match' | 'mismatch' | 'incomplete';
  name: NapFieldCheck;
  address: NapFieldCheck & { overlap: number };
  phone: NapFieldCheck;
  mismatchFields: string[];
}

export function compareListingNap(
  canonical: ManualFootprint['nap'],
  listing: ListingRow
): NapListingComparison {
  const canonName = normalizeBusinessName(canonical.businessName);
  const seenName = normalizeBusinessName(listing.seenName);
  const nameChecked = Boolean(canonName && seenName);
  const nameMatch = nameChecked ? canonName === seenName : true;

  const canonAddr = canonical.fullAddress.trim();
  const seenAddr = listing.seenAddress.trim();
  const addrChecked = Boolean(canonAddr && seenAddr);
  const overlap = addrChecked ? addressTokenOverlap(canonAddr, seenAddr) : 0;
  const addrMatch = addrChecked ? overlap >= 0.6 : true;

  const canonPhone = normalizePhone(canonical.phone);
  const seenPhone = normalizePhone(listing.seenPhone);
  const phoneChecked = Boolean(canonPhone && seenPhone);
  const phoneMatch = phoneChecked ? canonPhone === seenPhone : true;

  const anyChecked = nameChecked || addrChecked || phoneChecked;
  const mismatchFields: string[] = [];
  if (nameChecked && !nameMatch) mismatchFields.push('Name');
  if (addrChecked && !addrMatch) mismatchFields.push('Address');
  if (phoneChecked && !phoneMatch) mismatchFields.push('Phone');

  return {
    listingId: listing.id,
    platform: listing.platform,
    overallStatus: !anyChecked
      ? 'incomplete'
      : mismatchFields.length === 0
      ? 'match'
      : 'mismatch',
    name: { checked: nameChecked, match: nameMatch },
    address: { checked: addrChecked, match: addrMatch, overlap },
    phone: { checked: phoneChecked, match: phoneMatch },
    mismatchFields,
  };
}

export interface NapConsistencySummary {
  comparisons: NapListingComparison[];
  checkedCount: number;
  matchedCount: number;
  mismatchedCount: number;
}

export function evaluateNapConsistency(manual: ManualFootprint): NapConsistencySummary {
  const comparisons = manual.listings.map((row) => compareListingNap(manual.nap, row));
  const checked = comparisons.filter((c) => c.overallStatus !== 'incomplete');
  const matched = checked.filter((c) => c.overallStatus === 'match');
  const mismatched = checked.filter((c) => c.overallStatus === 'mismatch');
  return {
    comparisons,
    checkedCount: checked.length,
    matchedCount: matched.length,
    mismatchedCount: mismatched.length,
  };
}

function daysSinceIsoDate(dateStr: string, referenceDate = new Date()): number | null {
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const diffMs = referenceDate.getTime() - parsed.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export function manualFootprintToFindings(
  manual: ManualFootprint,
  referenceDate = new Date()
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const { gbp, facebook, instagram } = manual;

  // 1. GBP Claimed
  findings.push({
    id: 'gbp-claimed',
    category: 'gbp',
    label: 'Business Profile claimed & verified',
    status:
      gbp.claimed === 'yes' ? 'pass' : gbp.claimed === 'no' ? 'fail' : 'unknown',
    evidence:
      gbp.claimed === 'yes'
        ? 'Claimed = Yes'
        : gbp.claimed === 'no'
        ? 'Claimed = No'
        : 'Not checked yet',
    fix: 'Claim and verify your Business Profile so you control hours, photos, and booking links.',
    businessImpact:
      'An unclaimed profile leaves hours, phone numbers, and photos vulnerable to random edits.',
    weight: 5,
  });

  // 2. GBP Primary Category
  findings.push({
    id: 'gbp-category',
    category: 'gbp',
    label: 'Primary business category set',
    status:
      gbp.primaryCategorySet === 'yes'
        ? 'pass'
        : gbp.primaryCategorySet === 'no'
        ? 'fail'
        : 'unknown',
    evidence:
      gbp.primaryCategorySet === 'yes'
        ? 'Primary category set'
        : gbp.primaryCategorySet === 'no'
        ? 'No primary category set'
        : 'Not checked yet',
    fix: 'Select the most accurate primary category and relevant secondary categories.',
    businessImpact:
      'Local customers searching for your exact service cannot find you reliably without the right category.',
    weight: 3,
  });

  // 3. GBP Hours Listed
  findings.push({
    id: 'gbp-hours',
    category: 'gbp',
    label: 'Opening hours listed on profile',
    status:
      gbp.hoursListed === 'yes' ? 'pass' : gbp.hoursListed === 'no' ? 'fail' : 'unknown',
    evidence:
      gbp.hoursListed === 'yes'
        ? 'Hours listed'
        : gbp.hoursListed === 'no'
        ? 'Hours missing'
        : 'Not checked yet',
    fix: 'Publish complete regular and holiday opening hours on your Business Profile.',
    businessImpact:
      'Missing opening hours cause nearby travelers to skip calling or assume the business is closed.',
    weight: 3,
  });

  // 4. GBP Photo Count (pass >=20, warn >=8, fail <8)
  const photos = gbp.photoCount;
  findings.push({
    id: 'gbp-photos',
    category: 'gbp',
    label: 'Business Profile photo library',
    status:
      photos === null
        ? 'unknown'
        : photos >= 20
        ? 'pass'
        : photos >= 8
        ? 'warn'
        : 'fail',
    evidence: photos === null ? 'Photo count not entered' : `${photos} photos uploaded`,
    fix: 'Upload at least 20 bright, real photos covering rooms, exterior, team, and key offerings.',
    businessImpact:
      'Customers build trust from real photos before messaging or booking directly.',
    weight: 3,
  });

  // 5. GBP Posts in last 90 days (pass >=3, warn 1-2, fail 0)
  const posts90 = gbp.postsLast90Days;
  findings.push({
    id: 'gbp-posts-90d',
    category: 'gbp',
    label: 'Recent profile updates (last 90 days)',
    status:
      posts90 === null
        ? 'unknown'
        : posts90 >= 3
        ? 'pass'
        : posts90 >= 1
        ? 'warn'
        : 'fail',
    evidence:
      posts90 === null ? '90-day post count not entered' : `${posts90} posts in last 90 days`,
    fix: 'Publish a short update or seasonal offer on your profile at least once per month.',
    businessImpact:
      'Active monthly updates signal to first-time visitors that the business is open and responsive.',
    weight: 2,
  });

  // 6. GBP Review Count (pass >=50, warn >=15, fail <15)
  const revCount = gbp.reviewCount;
  findings.push({
    id: 'gbp-reviews-count',
    category: 'gbp',
    label: 'Customer review volume',
    status:
      revCount === null
        ? 'unknown'
        : revCount >= 50
        ? 'pass'
        : revCount >= 15
        ? 'warn'
        : 'fail',
    evidence:
      revCount === null
        ? 'Review count not entered'
        : gbp.averageRating !== null
        ? `${revCount} reviews, ${gbp.averageRating.toFixed(1)} avg`
        : `${revCount} reviews`,
    fix: 'Send an automated post-visit review link via SMS or WhatsApp to reach 50+ recent reviews.',
    businessImpact:
      'Too few reviews push cautious prospects toward competitors with stronger local proof.',
    weight: 5,
  });

  // 7. GBP Average Rating (pass >=4.3, warn >=4.0, fail <4.0)
  const avgRating = gbp.averageRating;
  findings.push({
    id: 'gbp-rating',
    category: 'gbp',
    label: 'Average star rating',
    status:
      avgRating === null
        ? 'unknown'
        : avgRating >= 4.3
        ? 'pass'
        : avgRating >= 4.0
        ? 'warn'
        : 'fail',
    evidence:
      avgRating === null
        ? 'Average rating not entered'
        : revCount !== null
        ? `${revCount} reviews, ${avgRating.toFixed(1)} avg`
        : `${avgRating.toFixed(1)} avg rating`,
    fix: 'Invite satisfied guests to share feedback and resolve negative comments promptly.',
    businessImpact:
      'Ratings below 4.3 stars noticeably reduce clicks and direct inquiries from map searchers.',
    weight: 5,
  });

  // 8. GBP Owner Replies (pass most, warn some, fail none)
  findings.push({
    id: 'gbp-owner-replies',
    category: 'gbp',
    label: 'Owner replies to reviews',
    status:
      gbp.ownerReplies === 'unknown'
        ? 'unknown'
        : gbp.ownerReplies === 'most'
        ? 'pass'
        : gbp.ownerReplies === 'some'
        ? 'warn'
        : 'fail',
    evidence:
      gbp.ownerReplies === 'unknown'
        ? 'Reply habit not entered'
        : `Owner replies: ${gbp.ownerReplies}`,
    fix: 'Reply warmly to every new positive and critical review within 48 hours.',
    businessImpact:
      'Thoughtful owner replies show prospective customers that a real team cares after booking.',
    weight: 3,
  });

  // 9. GBP Q&A Answered
  findings.push({
    id: 'gbp-qa',
    category: 'gbp',
    label: 'Profile Questions & Answers covered',
    status:
      gbp.qaAnswered === 'yes' ? 'pass' : gbp.qaAnswered === 'no' ? 'warn' : 'unknown',
    evidence:
      gbp.qaAnswered === 'yes'
        ? 'Q&A answered'
        : gbp.qaAnswered === 'no'
        ? 'Unanswered or empty Q&A'
        : 'Not checked yet',
    fix: 'Seed and answer top 5 customer questions directly inside your profile Q&A.',
    businessImpact:
      'Answered Q&As stop prospects from leaving to ask competitors basic availability or parking questions.',
    weight: 2,
  });

  // 10. GBP Booking / Menu Link Set
  findings.push({
    id: 'gbp-booking-link',
    category: 'gbp',
    label: 'Direct booking or menu link on profile',
    status:
      gbp.bookingOrMenuLinkSet === 'yes'
        ? 'pass'
        : gbp.bookingOrMenuLinkSet === 'no'
        ? 'fail'
        : 'unknown',
    evidence:
      gbp.bookingOrMenuLinkSet === 'yes'
        ? 'Direct booking/menu link active'
        : gbp.bookingOrMenuLinkSet === 'no'
        ? 'No direct booking/menu link'
        : 'Not checked yet',
    fix: 'Attach your own commission-free booking or inquiry link directly to your Business Profile.',
    businessImpact:
      'Without a direct link on the profile, commission-heavy OTAs intercept ready-to-book guests.',
    weight: 4,
  });

  // 11. Facebook Page Activity (pass <=30 days, warn <=90 days, fail >90 or exists='no')
  const fbDays = daysSinceIsoDate(facebook.lastPostDate, referenceDate);
  let fbStatus: AuditFinding['status'] = 'unknown';
  let fbEvidence = 'Facebook status not entered';
  if (facebook.exists === 'no') {
    fbStatus = 'fail';
    fbEvidence = 'No active Facebook page';
  } else if (fbDays !== null) {
    fbStatus = fbDays <= 30 ? 'pass' : fbDays <= 90 ? 'warn' : 'fail';
    fbEvidence = `Last post ${fbDays} days ago (${facebook.lastPostDate})${
      facebook.followers !== null ? ` · ${facebook.followers.toLocaleString()} followers` : ''
    }`;
  } else if (facebook.exists === 'yes') {
    fbStatus = 'warn';
    fbEvidence = `Page exists (last post date not entered)${
      facebook.followers !== null ? ` · ${facebook.followers.toLocaleString()} followers` : ''
    }`;
  }

  findings.push({
    id: 'social-facebook-activity',
    category: 'social',
    label: 'Facebook page freshness',
    status: fbStatus,
    evidence: fbEvidence,
    fix: 'Post fresh photos, guest stories, or direct-booking offers on Facebook at least every 2 weeks.',
    businessImpact:
      'A stale Facebook page makes customers wonder if the business has closed or changed management.',
    weight: 3,
  });

  // 12. Messenger Response Time (belongs to Contact & Conversion)
  findings.push({
    id: 'contact-messenger-reply',
    category: 'contact',
    label: 'Messenger replies within a day',
    status:
      facebook.messengerRepliesWithinDay === 'yes'
        ? 'pass'
        : facebook.messengerRepliesWithinDay === 'no'
        ? 'fail'
        : 'unknown',
    evidence:
      facebook.messengerRepliesWithinDay === 'yes'
        ? 'Replies within 24 hours'
        : facebook.messengerRepliesWithinDay === 'no'
        ? 'Slow or unmonitored Messenger replies'
        : 'Response speed not checked',
    fix: 'Set up instant auto-greeting and automated after-hours replies in Messenger.',
    businessImpact:
      'Evening Messenger inquiries book with whoever answers their first question fastest.',
    weight: 4,
  });

  // 13. Instagram Activity (pass <=30 days, warn <=90 days)
  const igDays = daysSinceIsoDate(instagram.lastPostDate, referenceDate);
  let igStatus: AuditFinding['status'] = 'unknown';
  let igEvidence = 'Instagram status not entered';
  if (instagram.exists === 'no') {
    igStatus = 'warn';
    igEvidence = 'No active Instagram profile';
  } else if (igDays !== null) {
    igStatus = igDays <= 30 ? 'pass' : igDays <= 90 ? 'warn' : 'fail';
    igEvidence = `Last post ${igDays} days ago (${instagram.lastPostDate})${
      instagram.followers !== null ? ` · ${instagram.followers.toLocaleString()} followers` : ''
    }`;
  } else if (instagram.exists === 'yes') {
    igStatus = 'warn';
    igEvidence = `Profile exists (last post date not entered)${
      instagram.followers !== null ? ` · ${instagram.followers.toLocaleString()} followers` : ''
    }`;
  }

  findings.push({
    id: 'social-instagram-activity',
    category: 'social',
    label: 'Instagram profile freshness',
    status: igStatus,
    evidence: igEvidence,
    fix: 'Share current visual reels and photos on Instagram with a direct booking link in bio.',
    businessImpact:
      'Travelers verify ambiance and authenticity on Instagram before clicking through to book.',
    weight: 2,
  });

  // 14. NAP Consistency across listings
  const napSummary = evaluateNapConsistency(manual);
  let napStatus: AuditFinding['status'] = 'unknown';
  let napEvidence = 'Enter canonical NAP and at least one directory listing to compare';

  if (napSummary.checkedCount > 0) {
    if (napSummary.mismatchedCount === 0) {
      napStatus = 'pass';
      napEvidence = `${napSummary.matchedCount} of ${napSummary.checkedCount} listings match canonical NAP`;
    } else {
      const badPlatforms = napSummary.comparisons
        .filter((c) => c.overallStatus === 'mismatch')
        .map((c) => `${c.platform} (${c.mismatchFields.join('/')})`)
        .join(', ');
      napStatus =
        napSummary.mismatchedCount >= Math.ceil(napSummary.checkedCount / 2) ? 'fail' : 'warn';
      napEvidence = `${napSummary.matchedCount}/${napSummary.checkedCount} match · Mismatches: ${badPlatforms}`;
    }
  }

  findings.push({
    id: 'nap-consistency',
    category: 'social',
    label: 'Name, Address & Phone (NAP) consistency across directories',
    status: napStatus,
    evidence: napEvidence,
    fix: 'Update mismatched directory listings so business name, address, and phone match word-for-word.',
    businessImpact:
      'Conflicting phone numbers or addresses across booking sites confuse guests and weaken local trust.',
    weight: 5,
  });

  return findings;
}
