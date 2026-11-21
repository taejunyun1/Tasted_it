export interface RecordedOperatingHours {
  weekday: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
  lastVerifiedAt: string;
}

export interface PublicOperatingDay {
  weekday: number;
  summary: string;
  verifiedOn: string | null;
}

/** A recorded information date is not proof that a business is open now. */
export function informationDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const day = new Date(value.slice(0, 10));
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  if (value.length === 10) return value;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function publicOperatingDays(rows: RecordedOperatingHours[]): PublicOperatingDay[] {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  return Array.from({ length: 7 }, (_, weekday) => {
    const day = rows.filter((row) => row.weekday === weekday);
    if (!day.length) return null;
    const dates = day.map((row) => informationDate(row.lastVerifiedAt));
    const closed = day.every((row) => row.isClosed);
    const invalid = dates.some((date) => !date)
      || (day.some((row) => row.isClosed) && !closed)
      || day.some((row) => row.isClosed
        ? row.opensAt !== null || row.closesAt !== null
        : !time.test(row.opensAt ?? "") || !time.test(row.closesAt ?? ""));
    if (invalid) return { weekday, summary: "정보 미확인", verifiedOn: null };
    return {
      weekday,
      summary: closed ? "휴무" : [...new Set(day.map((row) => `${row.opensAt}–${row.closesAt! <= row.opensAt! ? "다음 날 " : ""}${row.closesAt}`))].sort().join(", "),
      verifiedOn: (dates as string[]).sort()[0],
    };
  }).filter((day): day is PublicOperatingDay => day !== null);
}
