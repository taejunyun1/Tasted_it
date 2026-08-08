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
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

function containsWindow(hours: DailyParkingHours, start: Date, endWithMargin: Date) {
  const opens = parseClock(hours.opensAt);
  const closes = parseClock(hours.closesAt);
  if (opens == null || closes == null) return false;
  const startMinutes = minuteOfDay(start);
  let endMinutes = minuteOfDay(endWithMargin);
  const crossesMidnight = closes <= opens;
  if (crossesMidnight && endWithMargin.getTime() > start.getTime() && endMinutes < startMinutes) endMinutes += 24 * 60;
  const normalizedClose = crossesMidnight ? closes + 24 * 60 : closes;
  return startMinutes >= opens && endMinutes <= normalizedClose;
}

export function isParkingOpenForWindow(
  schedule: ParkingSchedule,
  start: Date,
  end: Date,
  exitMarginMinutes = 30,
  isHoliday = false,
) {
  const endWithMargin = new Date(end.getTime() + exitMarginMinutes * 60_000);
  const day = seoulDay(start);
  const hours = isHoliday || day === "Sun"
    ? schedule.holiday
    : day === "Sat"
      ? schedule.saturday
      : schedule.weekday;
  return hours ? containsWindow(hours, start, endWithMargin) : false;
}
