import { describe, expect, it } from "vitest";
import {
  hasSendWindow,
  isWithinSendWindow,
  localParts,
  nextSendWindowStart,
  planSendTimes,
  readSendWindow,
  sendWindowSchema,
  spacingMs,
  throttleDelayMs,
  zonedTimeToUtc,
  type SendWindow,
} from "../../apps/api/src/campaigns/schedule";

const IST = "Asia/Kolkata";
const NY = "America/New_York";
const WEEKDAYS = [1, 2, 3, 4, 5];
const officeHoursIst: SendWindow = { start: "09:00", end: "17:00", days: WEEKDAYS, timezone: IST };
const at = (iso: string) => new Date(iso);

describe("sendWindowSchema", () => {
  it.each([
    [{}],
    [{ start: "09:00", end: "17:00" }],
    [{ start: "00:00", end: "23:59" }],
    [{ start: "20:00", end: "06:00", timezone: IST }],
    [{ days: [0, 6] }],
    [{ days: [0, 1, 2, 3, 4, 5, 6] }],
    [{ timezone: " UTC " }],
  ])("accepts %j", (input) => {
    expect(sendWindowSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    [{ start: "09:00" }],
    [{ end: "17:00" }],
    [{ start: "09:00", end: "09:00" }],
    [{ start: "24:00", end: "06:00" }],
    [{ start: "9:00", end: "17:00" }],
    [{ start: "09:60", end: "17:00" }],
    [{ days: [] }],
    [{ days: [7] }],
    [{ days: [-1] }],
    [{ days: [1.5] }],
    [{ days: [0, 1, 2, 3, 4, 5, 6, 0] }],
    [{ timezone: "Mars/Olympus_Mons" }],
    [{ everyday: true }],
  ])("rejects %j", (input) => {
    expect(sendWindowSchema.safeParse(input).success).toBe(false);
  });

  it("reports missing or equal times on end", () => {
    const missing = sendWindowSchema.safeParse({ start: "09:00" });
    const equal = sendWindowSchema.safeParse({ start: "09:00", end: "09:00" });
    expect(missing.success || missing.error.issues[0].path).toEqual(["end"]);
    expect(equal.success || equal.error.issues[0].path).toEqual(["end"]);
  });
});

describe("readSendWindow", () => {
  it("returns the parsed window, or any-time for missing / invalid input", () => {
    expect(readSendWindow({ start: "09:00", end: "17:00" })).toEqual({ start: "09:00", end: "17:00" });
    expect(readSendWindow(null)).toEqual({});
    expect(readSendWindow({ start: "nope" })).toEqual({});
  });
});

describe("hasSendWindow", () => {
  it("is false for any-time windows", () => {
    expect(hasSendWindow({})).toBe(false);
    expect(hasSendWindow({ days: [0, 1, 2, 3, 4, 5, 6] })).toBe(false);
    expect(hasSendWindow({ timezone: IST })).toBe(false);
  });

  it("is true for time or day restrictions", () => {
    expect(hasSendWindow({ start: "09:00", end: "17:00" })).toBe(true);
    expect(hasSendWindow({ days: [1] })).toBe(true);
  });

  it("is true when seven day entries repeat the same days", () => {
    expect(hasSendWindow({ days: [1, 1, 1, 1, 1, 1, 1] })).toBe(true);
    expect(isWithinSendWindow(at("2026-03-03T10:00:00Z"), { days: [1, 1, 1, 1, 1, 1, 1] })).toBe(false);
  });
});

describe("localParts", () => {
  it("reads wall-clock parts in a time zone", () => {
    expect(localParts(at("2026-03-02T00:00:00Z"), IST)).toEqual({ year: 2026, month: 3, day: 2, hour: 5, minute: 30, weekday: 1 });
    expect(localParts(at("2026-03-01T23:59:00Z"), "UTC")).toEqual({ year: 2026, month: 3, day: 1, hour: 23, minute: 59, weekday: 0 });
  });

  it("reports midnight as hour 0", () => {
    expect(localParts(at("2026-03-02T00:00:00Z"), "UTC").hour).toBe(0);
  });

  it("crosses the date line", () => {
    expect(localParts(at("2026-12-31T20:00:00Z"), IST)).toMatchObject({ year: 2027, month: 1, day: 1, hour: 1, minute: 30, weekday: 5 });
  });
});

describe("zonedTimeToUtc", () => {
  it("converts fixed-offset zones", () => {
    expect(zonedTimeToUtc(2026, 3, 2, 9, 0, IST).toISOString()).toBe("2026-03-02T03:30:00.000Z");
    expect(zonedTimeToUtc(2026, 3, 2, 9, 0, "UTC").toISOString()).toBe("2026-03-02T09:00:00.000Z");
  });

  it("handles daylight saving time on both sides of the switch", () => {
    expect(zonedTimeToUtc(2026, 3, 7, 9, 0, NY).toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(zonedTimeToUtc(2026, 3, 9, 9, 0, NY).toISOString()).toBe("2026-03-09T13:00:00.000Z");
    expect(zonedTimeToUtc(2026, 11, 2, 9, 0, NY).toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });

  it("rolls the previous local day across midnight", () => {
    expect(zonedTimeToUtc(2026, 3, 2, 2, 0, IST).toISOString()).toBe("2026-03-01T20:30:00.000Z");
  });
});

describe("isWithinSendWindow", () => {
  it("is always true without a window", () => {
    expect(isWithinSendWindow(at("2026-03-01T03:00:00Z"), {})).toBe(true);
  });

  it("includes the start and excludes the end", () => {
    expect(isWithinSendWindow(at("2026-03-02T03:30:00Z"), officeHoursIst)).toBe(true);
    expect(isWithinSendWindow(at("2026-03-02T03:29:00Z"), officeHoursIst)).toBe(false);
    expect(isWithinSendWindow(at("2026-03-02T11:29:00Z"), officeHoursIst)).toBe(true);
    expect(isWithinSendWindow(at("2026-03-02T11:30:00Z"), officeHoursIst)).toBe(false);
  });

  it("checks the local weekday", () => {
    expect(isWithinSendWindow(at("2026-03-07T05:00:00Z"), officeHoursIst)).toBe(false);
    expect(isWithinSendWindow(at("2026-03-01T10:00:00Z"), { days: [0] })).toBe(true);
    expect(isWithinSendWindow(at("2026-03-02T10:00:00Z"), { days: [0] })).toBe(false);
  });

  it("supports overnight windows", () => {
    const night: SendWindow = { start: "20:00", end: "06:00" };
    expect(isWithinSendWindow(at("2026-03-02T21:00:00Z"), night)).toBe(true);
    expect(isWithinSendWindow(at("2026-03-02T05:59:00Z"), night)).toBe(true);
    expect(isWithinSendWindow(at("2026-03-02T06:00:00Z"), night)).toBe(false);
    expect(isWithinSendWindow(at("2026-03-02T12:00:00Z"), night)).toBe(false);
  });

  it("uses the default time zone when the window has none", () => {
    const w: SendWindow = { start: "09:00", end: "10:00" };
    expect(isWithinSendWindow(at("2026-03-02T03:30:00Z"), w, IST)).toBe(true);
    expect(isWithinSendWindow(at("2026-03-02T03:30:00Z"), w)).toBe(false);
  });
});

describe("nextSendWindowStart", () => {
  it("returns the same instant inside the window", () => {
    const inside = at("2026-03-02T05:00:00Z");
    expect(nextSendWindowStart(inside, officeHoursIst)).toBe(inside);
  });

  it("waits for today's opening", () => {
    expect(nextSendWindowStart(at("2026-03-02T02:00:00Z"), officeHoursIst).toISOString()).toBe("2026-03-02T03:30:00.000Z");
  });

  it("moves to tomorrow's opening after hours", () => {
    expect(nextSendWindowStart(at("2026-03-02T12:00:00Z"), officeHoursIst).toISOString()).toBe("2026-03-03T03:30:00.000Z");
  });

  it("skips the weekend", () => {
    expect(nextSendWindowStart(at("2026-03-06T12:00:00Z"), officeHoursIst).toISOString()).toBe("2026-03-09T03:30:00.000Z");
  });

  it("opens at local midnight for day-only windows", () => {
    expect(nextSendWindowStart(at("2026-03-02T10:00:00Z"), { days: [0] }).toISOString()).toBe("2026-03-08T00:00:00.000Z");
    expect(nextSendWindowStart(at("2026-03-02T10:00:00Z"), { days: [0], timezone: IST }).toISOString()).toBe(
      "2026-03-07T18:30:00.000Z"
    );
  });

  it("opens an overnight window the same evening", () => {
    expect(nextSendWindowStart(at("2026-03-02T12:00:00Z"), { start: "20:00", end: "06:00" }).toISOString()).toBe(
      "2026-03-02T20:00:00.000Z"
    );
  });

  it("uses the post-DST offset after the clocks change", () => {
    const w: SendWindow = { start: "09:00", end: "17:00", timezone: NY };
    expect(nextSendWindowStart(at("2026-03-07T23:00:00Z"), w).toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("always returns a time inside the window", () => {
    for (let h = 0; h < 24 * 7; h += 5) {
      const from = new Date(Date.UTC(2026, 2, 1, h, 17));
      const next = nextSendWindowStart(from, officeHoursIst);
      expect(next.getTime()).toBeGreaterThanOrEqual(from.getTime());
      expect(isWithinSendWindow(next, officeHoursIst)).toBe(true);
    }
  });
});

describe("spacingMs", () => {
  it("spreads sends evenly across an hour", () => {
    expect(spacingMs(60)).toBe(60_000);
    expect(spacingMs(3600)).toBe(1_000);
    expect(spacingMs(7)).toBe(514_286);
  });

  it("treats non-positive throttles as one per hour", () => {
    expect(spacingMs(0)).toBe(3_600_000);
    expect(spacingMs(-5)).toBe(3_600_000);
  });
});

describe("planSendTimes", () => {
  it("returns nothing for zero recipients", () => {
    expect(planSendTimes(0, at("2026-03-02T05:00:00Z"), 60)).toEqual([]);
  });

  it("spaces sends at the throttle without a window", () => {
    expect(planSendTimes(3, at("2026-03-02T05:00:00Z"), 60).map((d) => d.toISOString())).toEqual([
      "2026-03-02T05:00:00.000Z",
      "2026-03-02T05:01:00.000Z",
      "2026-03-02T05:02:00.000Z",
    ]);
  });

  it("pushes slots that fall outside the window to the next opening", () => {
    expect(planSendTimes(4, at("2026-03-02T11:28:00Z"), 60, officeHoursIst).map((d) => d.toISOString())).toEqual([
      "2026-03-02T11:28:00.000Z",
      "2026-03-02T11:29:00.000Z",
      "2026-03-03T03:30:00.000Z",
      "2026-03-03T03:31:00.000Z",
    ]);
  });

  it("starts at the next opening when launched outside the window", () => {
    expect(planSendTimes(1, at("2026-03-07T05:00:00Z"), 10, officeHoursIst)[0].toISOString()).toBe("2026-03-09T03:30:00.000Z");
  });
});

describe("throttleDelayMs", () => {
  const now = at("2026-03-02T10:00:00Z");

  it("is 0 while under the hourly limit", () => {
    expect(throttleDelayMs({ sentLastHour: 59, oldestSentAt: "2026-03-02T09:30:00Z", throttlePerHour: 60, now })).toBe(0);
    expect(throttleDelayMs({ sentLastHour: 0, oldestSentAt: null, throttlePerHour: 0, now })).toBe(0);
  });

  it("waits until the oldest send leaves the rolling hour, plus a second", () => {
    expect(throttleDelayMs({ sentLastHour: 60, oldestSentAt: "2026-03-02T09:30:00Z", throttlePerHour: 60, now })).toBe(
      30 * 60_000 + 1_000
    );
    expect(throttleDelayMs({ sentLastHour: 61, oldestSentAt: at("2026-03-02T09:59:00Z"), throttlePerHour: 60, now })).toBe(
      59 * 60_000 + 1_000
    );
  });

  it("waits a full hour when the oldest send is unknown", () => {
    expect(throttleDelayMs({ sentLastHour: 1, oldestSentAt: null, throttlePerHour: 1, now })).toBe(3_600_000 + 1_000);
  });

  it("waits at least one second", () => {
    expect(throttleDelayMs({ sentLastHour: 5, oldestSentAt: "2026-03-02T08:00:00Z", throttlePerHour: 5, now })).toBe(1_000);
  });

  it("treats a zero throttle as one per hour", () => {
    expect(throttleDelayMs({ sentLastHour: 1, oldestSentAt: "2026-03-02T09:30:00Z", throttlePerHour: 0, now })).toBe(
      30 * 60_000 + 1_000
    );
  });
});
