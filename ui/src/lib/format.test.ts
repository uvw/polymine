import { afterEach, describe, expect, it, vi } from "vitest";

const locale = vi.hoisted(() => ({ code: "en" }));
vi.mock("./i18n", async (original) => ({
  ...(await original<typeof import("./i18n")>()),
  language: () => locale.code,
}));

const { formatClock, formatDate, formatDateTime, formatDuration, formatNumber, formatPercent } =
  await import("./format");

afterEach(() => {
  locale.code = "en";
});

describe("formatClock", () => {
  it("shows whole seconds under a minute and minutes after", () => {
    expect(formatClock(0)).toBe("0");
    expect(formatClock(42_980)).toBe("42");
    expect(formatClock(187_000)).toBe("3:07");
  });
});

describe("formatDuration", () => {
  it("uses seconds with hundredths, then minutes", () => {
    expect(formatDuration(12_346)).toBe("12.35 s");
    expect(formatDuration(187_000)).toBe("3 m 07 s");
  });

  it("writes the number in the UI language", () => {
    locale.code = "de";
    expect(formatDuration(12_346)).toBe("12,35 s");
  });
});

describe("formatPercent", () => {
  it("rounds halves up", () => {
    expect(formatPercent(42.5)).toBe("43%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("follows the UI language's percent style", () => {
    locale.code = "fr";
    expect(formatPercent(43)).toMatch(/^43\s%$/);
  });
});

describe("formatNumber", () => {
  it("formats decimals and grouping per language", () => {
    expect(formatNumber(12.5, { minimumFractionDigits: 1 })).toBe("12.5");
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(1000, { useGrouping: false })).toBe("1000");
    locale.code = "de";
    expect(formatNumber(12.5, { minimumFractionDigits: 1 })).toBe("12,5");
  });
});

describe("formatDate", () => {
  it("uses the UI language, not the system locale", () => {
    const day = Date.UTC(2026, 0, 15, 12);
    expect(formatDate(day)).toBe("Jan 15, 2026");
    locale.code = "de";
    expect(formatDate(day)).toBe("15. Jan. 2026");
  });
});

describe("formatDateTime", () => {
  it("adds the time of day in the UI language", () => {
    const day = Date.UTC(2026, 0, 15, 12);
    expect(formatDateTime(day)).toMatch(/^Jan 15, 2026, \d{1,2}:\d{2}\s[AP]M$/);
    locale.code = "de";
    expect(formatDateTime(day)).toMatch(/^15\.01\.2026, \d{2}:\d{2}$/);
  });
});
