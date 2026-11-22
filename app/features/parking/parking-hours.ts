import type { DailyParkingHours, ParkingSchedule } from "./parking-types";

function minuteOfDay(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(value.hour) * 60 + Number(value.minute);
}

function seoulDay(date: Date) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short" }).format(date);
  return day;
}

function parseClock(value: string) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function containsWindow(hours: DailyParkingHours, start: Date, endWithMargin: Date) {
  const opens = parseClock(hours.opensAt);
  const closes = parseClock(hours.closesAt);
  if (opens == null || closes == null) return false;
  const startMinutes = minuteOfDay(start);
  // Compare closing and exit on the same timeline, including an elapsed date change.
  const startMinuteTime = Math.floor(start.getTime() / 60_000) * 60_000;
  const endMinutes = startMinutes + (endWithMargin.getTime() - startMinuteTime) / 60_000;
  const normalizedClose = closes <= opens ? closes + 24 * 60 : closes;
  return startMinutes >= opens && endMinutes <= normalizedClose;
}

export function isParkingOpenForWindow(
  schedule: ParkingSchedule,
  start: Date,
  end: Date,
  exitMarginMinutes = 30,
  isHoliday = false,
) {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return false;
  if (!Number.isFinite(exitMarginMinutes) || exitMarginMinutes < 0) return false;
  const endWithMargin = new Date(end.getTime() + exitMarginMinutes * 60_000);
  const day = seoulDay(start);
  const hours = isHoliday || day === "Sun"
    ? schedule.holiday
    : day === "Sat"
      ? schedule.saturday
      : schedule.weekday;
  return hours ? containsWindow(hours, start, endWithMargin) : false;
}
