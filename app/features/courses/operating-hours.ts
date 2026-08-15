import type { OperatingAvailability } from "./course-context-v2";

export interface OperatingHoursInterval {
  weekday: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
}

function kstParts(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const)[parts.weekday as "Sun"];
  return { weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function toMinutes(value: string | null) {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function includes(interval: OperatingHoursInterval, weekday: number, minutes: number) {
  if (interval.isClosed || interval.weekday !== weekday) return false;
  const open = toMinutes(interval.opensAt);
  const close = toMinutes(interval.closesAt);
  if (open == null || close == null) return false;
  return close > open ? minutes >= open && minutes < close : minutes >= open || minutes < close;
}

export function operatingAvailabilityAt(hours: OperatingHoursInterval[], now: Date): OperatingAvailability {
  if (!hours.length) return "UNKNOWN";
  const { weekday, minutes } = kstParts(now);
  const yesterday = (weekday + 6) % 7;
  const open = hours.some((interval) => includes(interval, weekday, minutes)
    || (interval.weekday === yesterday && !interval.isClosed && (() => {
      const openAt = toMinutes(interval.opensAt); const closeAt = toMinutes(interval.closesAt);
      return openAt != null && closeAt != null && closeAt <= openAt && minutes < closeAt;
    })()));
  return open ? "OPEN" : "CLOSED";
}
