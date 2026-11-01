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
