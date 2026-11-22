import type { OperatingAvailability } from "./course-context-v2";

export interface OperatingHoursInterval {
  weekday: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
}

const kstClock = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function kstParts(now: Date) {
  const parts = Object.fromEntries(kstClock.formatToParts(now).map((part) => [part.type, part.value]));
  const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const)[parts.weekday as "Sun"];
  return { weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function toMinutes(value: string | null) {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function dailyIntervals(hours: OperatingHoursInterval[], weekday: number) {
  const rows = hours.filter((row) => row.weekday === weekday);
  if (!rows.length) return null;
  if (rows.every((row) => row.isClosed && row.opensAt === null && row.closesAt === null)) return [];

  const intervals: Array<{ open: number; close: number }> = [];
  for (const row of rows) {
    const open = toMinutes(row.opensAt);
    const close = toMinutes(row.closesAt);
    if (row.isClosed || open === null || close === null) return null;
    intervals.push({ open, close });
  }
  return intervals;
}

export function operatingAvailabilityAt(hours: OperatingHoursInterval[], now: Date): OperatingAvailability {
  if (!hours.length) return "UNKNOWN";
  const { weekday, minutes } = kstParts(now);
  const today = dailyIntervals(hours, weekday);
  const yesterday = dailyIntervals(hours, (weekday + 6) % 7);

  // Equal or earlier closing times refer to the following day.
  if (today?.some(({ open, close }) => minutes >= open && (close <= open || minutes < close))
      || yesterday?.some(({ open, close }) => close <= open && minutes < close)) return "OPEN";
  return today === null ? "UNKNOWN" : "CLOSED";
}
