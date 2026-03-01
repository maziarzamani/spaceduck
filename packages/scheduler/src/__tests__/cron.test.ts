import { describe, it, expect } from "bun:test";
import { parseCron, nextRun } from "../cron";

describe("parseCron", () => {
  it("parses wildcard fields", () => {
    const f = parseCron("* * * * *");
    expect(f.minutes.size).toBe(60);
    expect(f.hours.size).toBe(24);
    expect(f.daysOfMonth.size).toBe(31);
    expect(f.months.size).toBe(12);
    expect(f.daysOfWeek.size).toBe(7);
  });

  it("parses fixed values", () => {
    const f = parseCron("30 14 1 6 3");
    expect([...f.minutes]).toEqual([30]);
    expect([...f.hours]).toEqual([14]);
    expect([...f.daysOfMonth]).toEqual([1]);
    expect([...f.months]).toEqual([6]);
    expect([...f.daysOfWeek]).toEqual([3]);
  });

  it("parses ranges", () => {
    const f = parseCron("0-5 * * * *");
    expect([...f.minutes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("parses steps", () => {
    const f = parseCron("*/15 * * * *");
    expect([...f.minutes].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
  });

  it("parses step with range", () => {
    const f = parseCron("1-10/3 * * * *");
    expect([...f.minutes].sort((a, b) => a - b)).toEqual([1, 4, 7, 10]);
  });

  it("parses lists", () => {
    const f = parseCron("1,15,30 * * * *");
    expect([...f.minutes].sort((a, b) => a - b)).toEqual([1, 15, 30]);
  });

  it("parses complex expression", () => {
    const f = parseCron("0,30 9-17 * * 1-5");
    expect([...f.minutes].sort((a, b) => a - b)).toEqual([0, 30]);
    expect([...f.hours].sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...f.daysOfWeek].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("throws on invalid field count", () => {
    expect(() => parseCron("* *")).toThrow("expected 5 fields");
    expect(() => parseCron("* * * * * *")).toThrow("expected 5 fields");
  });
});

describe("nextRun", () => {
  it("returns the next matching minute", () => {
    const after = new Date("2026-03-01T10:00:00Z");
    const next = nextRun("30 * * * *", after);
    expect(next.getMinutes()).toBe(30);
    expect(next.getHours()).toBe(10);
  });

  it("advances to the next hour if minute has passed", () => {
    const after = new Date("2026-03-01T10:45:00Z");
    const next = nextRun("30 * * * *", after);
    expect(next.getMinutes()).toBe(30);
    expect(next.getHours()).toBe(11);
  });

  it("handles every-15-minutes cron", () => {
    const after = new Date("2026-03-01T10:05:00Z");
    const next = nextRun("*/15 * * * *", after);
    expect(next.getMinutes()).toBe(15);
    expect(next.getHours()).toBe(10);
  });

  it("handles daily at midnight", () => {
    const after = new Date("2026-03-01T12:00:00Z");
    const next = nextRun("0 0 * * *", after);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(2);
  });

  it("handles specific day of week", () => {
    // 2026-03-01 is a Sunday (day 0)
    const after = new Date("2026-03-01T00:00:00Z");
    const next = nextRun("0 9 * * 1", after); // Monday at 9am
    expect(next.getDay()).toBe(1);
    expect(next.getHours()).toBe(9);
  });

  it("handles monthly on the 15th", () => {
    const after = new Date("2026-03-20T00:00:00Z");
    const next = nextRun("0 0 15 * *", after);
    expect(next.getMonth()).toBe(3); // April (0-indexed)
    expect(next.getDate()).toBe(15);
  });

  it("returns time after the given date, not equal to it", () => {
    const after = new Date("2026-03-01T10:30:00Z");
    const next = nextRun("30 10 * * *", after);
    expect(next.getTime()).toBeGreaterThan(after.getTime());
  });
});
