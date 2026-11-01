// When polls close on Election Day, November 3, 2026, in Eastern Time.
// `first` is when most polls in the state close (when networks start
// projecting); `last` is when the final polls close, for states split
// across time zones. Sources: The Green Papers (2026 poll closing times),
// NPR's election-night guide and 270toWin. North Dakota is left out: the
// sources disagree and it has no statewide race this year.
//
// Daylight saving time ends November 1, 2026, so Eastern Time is UTC-5.

export const POLL_CLOSING_ET = {
  AL: { first: "20:00" }, AK: { first: "24:00", last: "25:00" }, AZ: { first: "21:00" },
  AR: { first: "20:30" }, CA: { first: "23:00" }, CO: { first: "21:00" },
  CT: { first: "20:00" }, DE: { first: "20:00" }, FL: { first: "19:00", last: "20:00" },
  GA: { first: "19:00" }, HI: { first: "24:00" }, ID: { first: "22:00", last: "23:00" },
  IL: { first: "20:00" }, IN: { first: "18:00", last: "19:00" }, IA: { first: "21:00" },
  KS: { first: "20:00", last: "21:00" }, KY: { first: "18:00", last: "19:00" }, LA: { first: "21:00" },
  ME: { first: "20:00" }, MD: { first: "20:00" }, MA: { first: "20:00" },
  MI: { first: "20:00", last: "21:00" }, MN: { first: "21:00" }, MS: { first: "20:00" },
  MO: { first: "20:00" }, MT: { first: "22:00" }, NE: { first: "21:00" },
  NV: { first: "22:00" }, NH: { first: "20:00" }, NJ: { first: "20:00" },
  NM: { first: "21:00" }, NY: { first: "21:00" }, NC: { first: "19:30" },
  OH: { first: "19:30" }, OK: { first: "20:00" }, OR: { first: "22:00", last: "23:00" },
  PA: { first: "20:00" }, RI: { first: "20:00" }, SC: { first: "19:00" },
  SD: { first: "20:00", last: "21:00" }, TN: { first: "20:00" }, TX: { first: "20:00", last: "21:00" },
  UT: { first: "22:00" }, VT: { first: "19:00" }, VA: { first: "19:00" },
  WA: { first: "23:00" }, WV: { first: "19:30" }, WI: { first: "21:00" },
  WY: { first: "21:00" },
};

/** "20:30" Eastern on Election Day -> Date (handles 24:00+ as after midnight). */
function etToDate(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 3, h + 5, m)); // EST = UTC-5
}

/** { first: Date, last: Date } for a state code, or null. */
export function closingTimes(code) {
  const t = POLL_CLOSING_ET[code];
  if (!t) return null;
  const first = etToDate(t.first);
  return { first, last: t.last ? etToDate(t.last) : first };
}

/** "8:00 PM ET" style label for an ET time string. */
export function etLabel(hhmm) {
  let [h, m] = hhmm.split(":").map(Number);
  const nextDay = h >= 24;
  h %= 24;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix} ET${nextDay ? " (Nov 4)" : ""}`;
}
