// Minimal 5-field cron parser — zero dependencies
//
// Supports: numbers, ranges (1-5), steps (*/15), lists (1,3,5), wildcard (*)
// Fields: minute(0-59) hour(0-23) dom(1-31) month(1-12) dow(0-6, 0=Sun)

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    const range = stepMatch ? stepMatch[1] : part;

    let start: number;
    let end: number;

    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      start = a;
      end = b;
    } else {
      start = parseInt(range, 10);
      end = start;
    }

    for (let i = start; i <= end; i += step) {
      if (i >= min && i <= max) values.add(i);
    }
  }

  return values;
}

export interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minutes: parseField(parts[0], 0, 59),
    hours: parseField(parts[1], 0, 23),
    daysOfMonth: parseField(parts[2], 1, 31),
    months: parseField(parts[3], 1, 12),
    daysOfWeek: parseField(parts[4], 0, 6),
  };
}

/**
 * Compute the next run time after `after` for the given cron expression.
 * Scans forward minute-by-minute up to a maximum of 366 days.
 */
export function nextRun(cronExpr: string, after: Date): Date {
  const fields = parseCron(cronExpr);
  const MAX_ADVANCE_MS = 366 * 24 * 60 * 60 * 1000;
  const deadline = after.getTime() + MAX_ADVANCE_MS;

  const candidate = new Date(after.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  while (candidate.getTime() <= deadline) {
    if (
      fields.months.has(candidate.getMonth() + 1) &&
      fields.daysOfMonth.has(candidate.getDate()) &&
      fields.daysOfWeek.has(candidate.getDay()) &&
      fields.hours.has(candidate.getHours()) &&
      fields.minutes.has(candidate.getMinutes())
    ) {
      return candidate;
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error(`No matching cron time found within 366 days for: ${cronExpr}`);
}
