// Links to each race's betting market on Polymarket. Links only: the site
// does not fetch, store or show any Polymarket data (its terms restrict
// that), it just lets visitors look at the odds there themselves.

export const POLYMARKET_SLUGS = {
  "AK-GOV": "alaska-governor-election-winner", "AK-SEN": "alaska-senate-election-winner",
  "AL-GOV": "alabama-governor-winner-2026", "AL-SEN": "alabama-senate-election-winner-154",
  "AR-GOV": "arkansas-governor-winner-2026", "AR-SEN": "arkansas-senate-election-winner",
  "AZ-GOV": "arizona-governor-winner-2026", "CA-GOV": "california-governor-election-2026",
  "CO-GOV": "colorado-governor-winner-2026", "CO-SEN": "colorado-senate-election-winner",
  "CT-GOV": "connecticut-governor-winner-2026", "DE-SEN": "delaware-senate-election-winner",
  "FL-GOV": "florida-governor-winner-2026", "FL-SEN-S": "florida-senate-election-winner",
  "GA-GOV": "georgia-governor-winner-2026", "GA-SEN": "georgia-senate-election-winner",
  "HI-GOV": "hawaii-governor-winner-2026", "IA-GOV": "iowa-governor-winner-2026",
  "IA-SEN": "iowa-senate-election-winner", "ID-GOV": "idaho-governor-winner-2026",
  "ID-SEN": "idaho-senate-election-winner", "IL-GOV": "illinois-governor-winner-2026",
  "IL-SEN": "illinois-senate-election-winner", "KS-GOV": "kansas-governor-winner-2026",
  "KS-SEN": "kansas-senate-election-winner", "KY-SEN": "kentucky-senate-election-winner",
  "LA-SEN": "louisiana-senate-election-winner", "MA-GOV": "massachusetts-governor-winner-2026",
  "MA-SEN": "massachusetts-senate-election-winner", "MD-GOV": "maryland-governor-winner-2026",
  "ME-GOV": "maine-governor-winner-2026", "ME-SEN": "maine-senate-election-winner",
  "MI-GOV": "michigan-governor-winner-2026", "MI-SEN": "michigan-senate-election-winner",
  "MN-GOV": "minnesota-governor-winner-2026", "MN-SEN": "minnesota-senate-election-winner",
  "MS-SEN": "mississippi-senate-election-winner", "MT-SEN": "montana-senate-election-winner",
  "NC-SEN": "north-carolina-senate-election-winner", "NE-GOV": "nebraska-governor-winner-2026",
  "NE-SEN": "nebraska-senate-election-winner", "NH-GOV": "new-hampshire-governor-winner-2026",
  "NH-SEN": "new-hampshire-senate-election-winner", "NJ-SEN": "new-jersey-senate-election-winner",
  "NM-GOV": "new-mexico-governor-winner-2026", "NM-SEN": "new-mexico-senate-election-winner",
  "NV-GOV": "nevada-governor-winner-2026", "NY-GOV": "new-york-governor-winner-2026",
  "OH-GOV": "ohio-governor-winner-2026", "OH-SEN-S": "ohio-senate-election-winner",
  "OK-GOV": "oklahoma-governor-winner-2026", "OK-SEN": "oklahoma-senate-election-winner",
  "OR-GOV": "oregon-governor-winner-2026", "OR-SEN": "oregon-senate-election-winner",
  "PA-GOV": "pennsylvania-governor-winner-2026", "RI-GOV": "rhode-island-governor-winner-2026",
  "RI-SEN": "rhode-island-senate-election-winner", "SC-GOV": "south-carolina-governor-winner-2026",
  "SC-SEN": "south-carolina-senate-election-winner", "SD-GOV": "south-dakota-governor-winner-2026",
  "SD-SEN": "south-dakota-senate-election-winner", "TN-GOV": "tennessee-governor-winner-2026",
  "TN-SEN": "tennessee-senate-election-winner", "TX-GOV": "texas-governor-winner-2026",
  "TX-SEN": "texas-senate-election-winner", "VA-SEN": "virginia-senate-election-winner",
  "VT-GOV": "vermont-governor-winner-2026", "WI-GOV": "wisconsin-governor-winner-2026",
  "WV-SEN": "west-virginia-senate-election-winner", "WY-GOV": "wyoming-governor-winner-2026",
  "WY-SEN": "wyoming-senate-election-winner",
};

/** Polymarket page for a race id like "GA-SEN", or null. */

export function polymarketUrl(raceId) {

  const slug = POLYMARKET_SLUGS[raceId];
  return slug && /^[a-z0-9-]+$/.test(slug) ? `https://polymarket.com/event/${slug}` : null;
}
