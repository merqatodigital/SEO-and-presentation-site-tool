import React, { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { evaluateNapConsistency } from '../audit/nap';
import { ManualFootprint, TriState } from '../audit/types';

interface ManualFootprintFormProps {
  manual: ManualFootprint;
  onChange: (next: ManualFootprint) => void;
}

const TRI_OPTIONS: Array<{ value: TriState; label: string }> = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export const ManualFootprintForm: React.FC<ManualFootprintFormProps> = ({
  manual,
  onChange,
}) => {
  const napSummary = useMemo(() => evaluateNapConsistency(manual), [manual]);
  const comparisonById = useMemo(
    () => new Map(napSummary.comparisons.map((c) => [c.listingId, c])),
    [napSummary]
  );

  const parseNumOrNull = (raw: string): number | null => {
    if (!raw.trim()) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <div className="space-y-6">
      {/* 1. Canonical NAP */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Canonical NAP (Official Name, Address, Phone)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Used to check consistency across directories and populate Schema JSON-LD. Autosaved locally.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Canonical Business Name
            </label>
            <input
              type="text"
              value={manual.nap.businessName}
              onChange={(e) =>
                onChange({
                  ...manual,
                  nap: { ...manual.nap, businessName: e.target.value },
                })
              }
              placeholder="Coco Cove Resort"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Official Phone
            </label>
            <input
              type="text"
              value={manual.nap.phone}
              onChange={(e) =>
                onChange({
                  ...manual,
                  nap: { ...manual.nap, phone: e.target.value },
                })
              }
              placeholder="0917 123 4567"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Full Street Address
            </label>
            <input
              type="text"
              value={manual.nap.fullAddress}
              onChange={(e) =>
                onChange({
                  ...manual,
                  nap: { ...manual.nap, fullAddress: e.target.value },
                })
              }
              placeholder="123 Rizal Street, El Nido, Palawan"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Opening Hours Text (Optional for JSON-LD)
            </label>
            <input
              type="text"
              value={manual.openingHoursText || ''}
              onChange={(e) =>
                onChange({ ...manual, openingHoursText: e.target.value })
              }
              placeholder="Daily 08:00-21:00"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Price Range (Optional, e.g. PHP 2,500–6,000 or $$)
            </label>
            <input
              type="text"
              value={manual.priceRange || ''}
              onChange={(e) => onChange({ ...manual, priceRange: e.target.value })}
              placeholder="Leave blank if unknown"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
      </div>

      {/* 2. Business Profile (GBP) & Reviews */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Business Profile (GBP) &amp; Reviews (30% of Scorecard)
        </h3>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Leave any unverified field as Unknown or blank — unknown fields are excluded from scoring.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Profile Claimed
            </label>
            <select
              value={manual.gbp.claimed}
              onChange={(e) =>
                onChange({
                  ...manual,
                  gbp: { ...manual.gbp, claimed: e.target.value as TriState },
                })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {TRI_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Primary Category Set
            </label>
            <select
              value={manual.gbp.primaryCategorySet}
              onChange={(e) =>
                onChange({
                  ...manual,
                  gbp: { ...manual.gbp, primaryCategorySet: e.target.value as TriState },
                })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {TRI_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Hours Listed
            </label>
            <select
              value={manual.gbp.hoursListed}
              onChange={(e) =>
                onChange({
                  ...manual,
                  gbp: { ...manual.gbp, hoursListed: e.target.value as TriState },
                })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {TRI_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Q&amp;A Answered
            </label>
            <select
              value={manual.gbp.qaAnswered}
              onChange={(e) =>
                onChange({
                  ...manual,
                  gbp: { ...manual.gbp, qaAnswered: e.target.value as TriState },
                })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {TRI_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Booking / Menu Link
            </label>
            <select
              value={manual.gbp.bookingOrMenuLinkSet}
              onChange={(e) =>
                onChange({
                  ...manual,
                  gbp: { ...manual.gbp, bookingOrMenuLinkSet: e.target.value as TriState },
                })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {TRI_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Photo Count (pass ≥20)
            </label>
            <input
              type="number"
              min={0}
              value={manual.gbp.photoCount ?? ''}
              onChange={(e) =>
                onChange({
                  ...manual,
                  gbp: { ...manual.gbp, photoCount: parseNumOrNull(e.target.value) },
                })
              }
              placeholder="Unknown"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Posts Last 90d (pass ≥3)
            </label>
            <input
              type="number"
              min={0}
              value={manual.gbp.postsLast90Days ?? ''}
              onChange={(e) =>
                onChange({
                  ...manual,
                  gbp: { ...manual.gbp, postsLast90Days: parseNumOrNull(e.target.value) },
                })
              }
              placeholder="Unknown"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Review Count (pass ≥50)
            </label>
            <input
              type="number"
              min={0}
              value={manual.gbp.reviewCount ?? ''}
              onChange={(e) =>
                onChange({
                  ...manual,
                  gbp: { ...manual.gbp, reviewCount: parseNumOrNull(e.target.value) },
                })
              }
              placeholder="Unknown"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Average Rating (pass ≥4.3)
            </label>
            <input
              type="number"
              min={1}
              max={5}
              step={0.1}
              value={manual.gbp.averageRating ?? ''}
              onChange={(e) =>
                onChange({
                  ...manual,
                  gbp: { ...manual.gbp, averageRating: parseNumOrNull(e.target.value) },
                })
              }
              placeholder="Unknown"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Owner Review Replies
            </label>
            <select
              value={manual.gbp.ownerReplies}
              onChange={(e) =>
                onChange({
                  ...manual,
                  gbp: {
                    ...manual.gbp,
                    ownerReplies: e.target.value as ManualFootprint['gbp']['ownerReplies'],
                  },
                })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="unknown">Unknown</option>
              <option value="most">Most</option>
              <option value="some">Some</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. Facebook & Instagram */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Facebook</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Page Exists
              </label>
              <select
                value={manual.facebook.exists}
                onChange={(e) =>
                  onChange({
                    ...manual,
                    facebook: { ...manual.facebook, exists: e.target.value as TriState },
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {TRI_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Messenger Replies Within 24h
              </label>
              <select
                value={manual.facebook.messengerRepliesWithinDay}
                onChange={(e) =>
                  onChange({
                    ...manual,
                    facebook: {
                      ...manual.facebook,
                      messengerRepliesWithinDay: e.target.value as TriState,
                    },
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {TRI_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Last Post Date
              </label>
              <input
                type="date"
                value={manual.facebook.lastPostDate}
                onChange={(e) =>
                  onChange({
                    ...manual,
                    facebook: { ...manual.facebook, lastPostDate: e.target.value },
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Followers
              </label>
              <input
                type="number"
                min={0}
                value={manual.facebook.followers ?? ''}
                onChange={(e) =>
                  onChange({
                    ...manual,
                    facebook: {
                      ...manual.facebook,
                      followers: parseNumOrNull(e.target.value),
                    },
                  })
                }
                placeholder="Unknown"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Facebook Page URL (Optional)
              </label>
              <input
                type="url"
                value={manual.facebook.url}
                onChange={(e) =>
                  onChange({
                    ...manual,
                    facebook: { ...manual.facebook, url: e.target.value },
                  })
                }
                placeholder="https://facebook.com/..."
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Instagram</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Profile Exists
              </label>
              <select
                value={manual.instagram.exists}
                onChange={(e) =>
                  onChange({
                    ...manual,
                    instagram: { ...manual.instagram, exists: e.target.value as TriState },
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {TRI_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Followers
              </label>
              <input
                type="number"
                min={0}
                value={manual.instagram.followers ?? ''}
                onChange={(e) =>
                  onChange({
                    ...manual,
                    instagram: {
                      ...manual.instagram,
                      followers: parseNumOrNull(e.target.value),
                    },
                  })
                }
                placeholder="Unknown"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Last Post Date
              </label>
              <input
                type="date"
                value={manual.instagram.lastPostDate}
                onChange={(e) =>
                  onChange({
                    ...manual,
                    instagram: { ...manual.instagram, lastPostDate: e.target.value },
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Instagram Profile URL (Optional)
              </label>
              <input
                type="url"
                value={manual.instagram.url}
                onChange={(e) =>
                  onChange({
                    ...manual,
                    instagram: { ...manual.instagram, url: e.target.value },
                  })
                }
                placeholder="https://instagram.com/..."
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 4. Listings & NAP Consistency */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Directory Listings &amp; NAP Consistency
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Enter as-seen name, address, or phone on each platform to auto-detect NAP mismatches.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...manual,
                listings: [
                  ...manual.listings,
                  {
                    id: `listing-custom-${Date.now()}`,
                    platform: 'Custom Listing',
                    listed: 'unknown',
                    url: '',
                    seenName: '',
                    seenAddress: '',
                    seenPhone: '',
                  },
                ],
              })
            }
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <Plus className="h-3.5 w-3.5" />
            Add custom row
          </button>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Platform</th>
                <th className="px-3 py-2 font-semibold">Listed</th>
                <th className="px-3 py-2 font-semibold">Listing URL</th>
                <th className="px-3 py-2 font-semibold">As-Seen Name</th>
                <th className="px-3 py-2 font-semibold">As-Seen Address</th>
                <th className="px-3 py-2 font-semibold">As-Seen Phone</th>
                <th className="px-3 py-2 font-semibold">NAP Check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {manual.listings.map((row, idx) => {
                const cmp = comparisonById.get(row.id);
                const updateRow = (patch: Partial<typeof row>) => {
                  onChange({
                    ...manual,
                    listings: manual.listings.map((r, i) =>
                      i === idx ? { ...r, ...patch } : r
                    ),
                  });
                };

                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2">
                      {row.id.includes('custom') ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={row.platform}
                            onChange={(e) => updateRow({ platform: e.target.value })}
                            aria-label="Custom directory name"
                            className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                          {manual.listings.length > 7 && (
                            <button
                              type="button"
                              onClick={() =>
                                onChange({
                                  ...manual,
                                  listings: manual.listings.filter((_, i) => i !== idx),
                                })
                              }
                              aria-label={`Remove ${row.platform}`}
                              className="rounded p-1 text-slate-400 hover:text-rose-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {row.platform}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={row.listed}
                        onChange={(e) =>
                          updateRow({ listed: e.target.value as TriState })
                        }
                        aria-label={`${row.platform} listed status`}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        {TRI_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="url"
                        value={row.url}
                        onChange={(e) => updateRow({ url: e.target.value })}
                        placeholder="https://..."
                        aria-label={`${row.platform} listing URL`}
                        className="w-32 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.seenName}
                        onChange={(e) => updateRow({ seenName: e.target.value })}
                        placeholder="As seen"
                        aria-label={`${row.platform} seen name`}
                        className="w-32 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.seenAddress}
                        onChange={(e) => updateRow({ seenAddress: e.target.value })}
                        placeholder="As seen"
                        aria-label={`${row.platform} seen address`}
                        className="w-36 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.seenPhone}
                        onChange={(e) => updateRow({ seenPhone: e.target.value })}
                        placeholder="As seen"
                        aria-label={`${row.platform} seen phone`}
                        className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {!cmp || cmp.overallStatus === 'incomplete' ? (
                        <span className="text-slate-400">Not compared</span>
                      ) : cmp.overallStatus === 'match' ? (
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                          Match
                        </span>
                      ) : (
                        <span className="font-semibold text-rose-700 dark:text-rose-400">
                          Mismatch ({cmp.mismatchFields.join(', ')})
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
