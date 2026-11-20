import { AISearchLayerData, ProjectBrief } from '../types/tour';
import { AuditResult, ManualFootprint } from './types';

export function selectJsonLdBusinessType(businessType: string): string {
  const lower = businessType.toLowerCase();
  if (/\b(hotel|resort|inn|lodge|motel|hostel|villa|homestay|staycation|guesthouse)\b/.test(lower)) {
    return /\b(hotel|resort)\b/.test(lower) ? 'Hotel' : 'LodgingBusiness';
  }
  if (/\b(restaurant|dining|bistro|eatery|grill|steakhouse|kitchen|bar\s*&\s*grill)\b/.test(lower)) {
    return 'Restaurant';
  }
  if (/\b(cafe|coffee|bakery|tea\s*house|espresso)\b/.test(lower)) {
    return 'CafeOrCoffeeShop';
  }
  if (/\b(clinic|dental|dentist|medical|doctor|hospital|healthcare|derma|physio)\b/.test(lower)) {
    return 'MedicalClinic';
  }
  if (/\b(travel|tour\s*operator|travel\s*agency|booking\s*agency)\b/.test(lower)) {
    return 'TravelAgency';
  }
  if (/\b(attraction|museum|park|landmark|sanctuary|theme\s*park)\b/.test(lower)) {
    return 'TouristAttraction';
  }
  if (/\b(store|shop|retail|boutique|mart|pharmacy|hardware)\b/.test(lower)) {
    return 'Store';
  }
  return 'LocalBusiness';
}

export interface JsonLdBuildResult {
  scriptTag: string;
  rawJson: string;
  valid: boolean;
  validationError: string | null;
  selectedType: string;
}

export function buildValidatedJsonLd(
  project: ProjectBrief,
  aiSearch: AISearchLayerData,
  audit: AuditResult | null,
  manual: ManualFootprint
): JsonLdBuildResult {
  const name =
    manual.nap.businessName.trim() || project.clientName.trim() || 'Client Business';
  const businessTypeText = project.businessType.trim() || 'LocalBusiness';
  const selectedType = selectJsonLdBusinessType(businessTypeText);

  const sameAsSet = new Set<string>();
  const linkGroups = audit?.parsed?.links;
  if (linkGroups) {
    for (const url of [
      ...linkGroups.facebook,
      ...linkGroups.instagram,
      ...linkGroups.tiktok,
      ...linkGroups.tripadvisor,
      ...linkGroups.bookingCom,
      ...linkGroups.agoda,
      ...linkGroups.airbnb,
      ...linkGroups.mapLinks,
    ]) {
      if (/^https?:\/\//i.test(url)) sameAsSet.add(url);
    }
  }
  if (manual.facebook.url.trim() && /^https?:\/\//i.test(manual.facebook.url.trim())) {
    sameAsSet.add(manual.facebook.url.trim());
  }
  if (manual.instagram.url.trim() && /^https?:\/\//i.test(manual.instagram.url.trim())) {
    sameAsSet.add(manual.instagram.url.trim());
  }
  for (const row of manual.listings) {
    if (row.url.trim() && /^https?:\/\//i.test(row.url.trim())) {
      sameAsSet.add(row.url.trim());
    }
  }

  const businessNode: Record<string, unknown> = {
    '@type': selectedType,
    name,
    description: aiSearch.primaryOffer.trim() || undefined,
    url: aiSearch.websiteUrl.trim() || audit?.finalUrl || undefined,
    areaServed: aiSearch.serviceArea.trim() || undefined,
    knowsAbout: businessTypeText,
  };

  if (manual.nap.phone.trim()) {
    businessNode.telephone = manual.nap.phone.trim();
  } else if (audit?.parsed?.links.tel[0]) {
    businessNode.telephone = audit.parsed.links.tel[0].replace(/^tel:/i, '').trim();
  }

  if (manual.nap.fullAddress.trim()) {
    businessNode.address = {
      '@type': 'PostalAddress',
      streetAddress: manual.nap.fullAddress.trim(),
    };
  }

  if (manual.openingHoursText && manual.openingHoursText.trim()) {
    businessNode.openingHoursSpecification = [
      {
        '@type': 'OpeningHoursSpecification',
        description: manual.openingHoursText.trim(),
      },
    ];
  }

  if (sameAsSet.size > 0) {
    businessNode.sameAs = Array.from(sameAsSet);
  }

  if (audit?.parsed?.ogImage) {
    businessNode.image = audit.parsed.ogImage;
  }

  if (manual.priceRange && manual.priceRange.trim()) {
    businessNode.priceRange = manual.priceRange.trim();
  }

  // Note: aggregateRating is intentionally never emitted (self-serving review markup is ineligible)
  const graph: Record<string, unknown>[] = [businessNode];

  if (aiSearch.faqs.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: aiSearch.faqs.map((qa) => ({
        '@type': 'Question',
        name: qa.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: qa.answer,
        },
      })),
    });
  }

  const schemaObj = {
    '@context': 'https://schema.org',
    '@graph': graph,
  };

  const rawJson = JSON.stringify(schemaObj, null, 2);
  let valid = false;
  let validationError: string | null = null;
  try {
    const reparsed = JSON.parse(rawJson) as Record<string, unknown>;
    if (reparsed && typeof reparsed === 'object' && Array.isArray(reparsed['@graph'])) {
      valid = true;
    }
  } catch (err) {
    validationError = err instanceof Error ? err.message : 'Invalid JSON-LD';
  }

  return {
    scriptTag: `<script type="application/ld+json">\n${rawJson}\n</script>`,
    rawJson,
    valid,
    validationError,
    selectedType,
  };
}
