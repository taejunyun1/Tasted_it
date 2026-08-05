export interface PlaceIdentityInput {
  name: string;
  address: string;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  sourceManagementNo?: string | null;
}

export function normalizePlaceIdentity(input: Pick<PlaceIdentityInput, "name" | "address" | "phone">) {
  const compact = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\s\p{P}\p{S}]+/gu, "");
  return { name: compact(input.name), address: compact(input.address), phone: input.phone?.replace(/\D/g, "") || null };
}

function distanceMeters(left: PlaceIdentityInput, right: PlaceIdentityInput) {
  if (left.latitude == null || left.longitude == null || right.latitude == null || right.longitude == null) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function classifyPlaceDuplicate(left: PlaceIdentityInput, right: PlaceIdentityInput) {
  const distance = distanceMeters(left, right);
  if (left.sourceManagementNo && right.sourceManagementNo && left.sourceManagementNo === right.sourceManagementNo) {
    return { level: "EXACT" as const, distanceMeters: distance, reasons: ["SAME_SOURCE_MANAGEMENT_NO"] };
  }
  const leftIdentity = normalizePlaceIdentity(left);
  const rightIdentity = normalizePlaceIdentity(right);
  const within100m = distance !== null && distance <= 100;
  if (within100m && leftIdentity.phone && leftIdentity.phone === rightIdentity.phone) {
    return { level: "HIGH" as const, distanceMeters: distance, reasons: ["SAME_PHONE", "WITHIN_100M"] };
  }
  const shorter = leftIdentity.name.length <= rightIdentity.name.length ? leftIdentity.name : rightIdentity.name;
  const longer = shorter === leftIdentity.name ? rightIdentity.name : leftIdentity.name;
  const similarName = shorter.length >= 3 && longer.includes(shorter);
  if (within100m && similarName) return { level: "MEDIUM" as const, distanceMeters: distance, reasons: ["SIMILAR_NAME", "WITHIN_100M"] };
  return { level: "NONE" as const, distanceMeters: distance, reasons: [] };
}
