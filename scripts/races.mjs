// Every state, and which statewide races are on the 2026 ballot.
// Senate: the 33 Class 2 seats plus the Florida and Ohio special elections.
// Governor: the 36 states that elect a governor in 2026.

export const STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"],
  ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"],
  ["WI", "Wisconsin"], ["WY", "Wyoming"],
].map(([code, name]) => ({ code, name }));

const SENATE_REGULAR = new Set([
  "AL", "AK", "AR", "CO", "DE", "GA", "ID", "IL", "IA", "KS", "KY", "LA", "ME",
  "MA", "MI", "MN", "MS", "MT", "NE", "NH", "NJ", "NM", "NC", "OK", "OR", "RI",
  "SC", "SD", "TN", "TX", "VA", "WV", "WY",
]);

const SENATE_SPECIAL = new Set(["FL", "OH"]);

const GOVERNOR = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "FL", "GA", "HI", "ID", "IL", "IA",
  "KS", "ME", "MD", "MA", "MI", "MN", "NE", "NV", "NH", "NM", "NY", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "VT", "WI", "WY",
]);

/** All races, one entry per Wikipedia article. */
export function listRaces() {
  const races = [];
  for (const { code, name } of STATES) {
    if (SENATE_REGULAR.has(code)) {
      races.push({
        id: `${code}-SEN`,
        state: code,
        office: "Senate",
        label: "U.S. Senate",
        page: `2026 United States Senate election in ${name}`,
      });
    }
    if (SENATE_SPECIAL.has(code)) {
      races.push({
        id: `${code}-SEN-S`,
        state: code,
        office: "Senate",
        label: "U.S. Senate (special)",
        page: `2026 United States Senate special election in ${name}`,
      });
    }
    if (GOVERNOR.has(code)) {
      races.push({
        id: `${code}-GOV`,
        state: code,
        office: "Governor",
        label: "Governor",
        page: `2026 ${name} gubernatorial election`,
      });
    }
  }
  return races;
}

export function houseSeatsPage(stateName) {
  return `2026 United States House of Representatives elections in ${stateName}`;
}

// Polymarket "<State> <Office> Election Winner" events, by race id. Found by
// listing Polymarket's midterms events; build-data.mjs searches for any slug
// that stops resolving.
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
