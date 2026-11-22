import { isCoordinateInActiveMarket, isCoordinateInBounds, type GeoBounds } from "../regions/region-pack";
import { DEFAULT_BBOX } from "./map-state";

export const OUTSIDE_SERVICE_AREA_MESSAGE = "현재 위치는 광주·전남·전북 탐색 범위 밖에 있습니다.";

// Provincial extremes rounded outward for the browse viewport only.
// https://www.jeonbuk.go.kr/index.jeonbuk?menuCd=DOM_000000101004000000
const JEONBUK_BROWSE_BOUNDS: GeoBounds = {
  minLatitude: 35.28,
  maxLatitude: 36.16,
  minLongitude: 125.96,
  maxLongitude: 127.92,
};

// Existing public venue rules still determine which results can be displayed.
const LONGITUDE_RADIUS = 0.025;
const LATITUDE_RADIUS = 0.018;

export function resolveLocationViewport({ latitude, longitude }: {
  latitude: number;
  longitude: number;
}): { bbox: [number, number, number, number]; notice: string | null } {
  const insideBrowseArea = isCoordinateInActiveMarket(latitude, longitude)
    || isCoordinateInBounds(JEONBUK_BROWSE_BOUNDS, latitude, longitude);

  if (!insideBrowseArea) {
    return { bbox: [...DEFAULT_BBOX], notice: OUTSIDE_SERVICE_AREA_MESSAGE };
  }

  return {
    bbox: [
      longitude - LONGITUDE_RADIUS,
      latitude - LATITUDE_RADIUS,
      longitude + LONGITUDE_RADIUS,
      latitude + LATITUDE_RADIUS,
    ],
    notice: null,
  };
}
