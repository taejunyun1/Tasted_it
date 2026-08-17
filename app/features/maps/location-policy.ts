import { activeMarketBbox } from "../regions/region-pack";
import { DEFAULT_BBOX } from "./map-state";

export const OUTSIDE_SERVICE_AREA_MESSAGE = "현재 위치는 전라남도 범위 밖에 있습니다.";

// First-pass client gate for the active launch packs. Exact administrative
// polygon matching remains a separate product/data concern.
const LONGITUDE_RADIUS = 0.025;
const LATITUDE_RADIUS = 0.018;

export function resolveLocationViewport({ latitude, longitude }: {
  latitude: number;
  longitude: number;
}): { bbox: [number, number, number, number]; notice: string | null } {
  const [west, south, east, north] = activeMarketBbox();
  const insideServiceArea = Number.isFinite(latitude) && Number.isFinite(longitude) &&
    longitude >= west && longitude <= east && latitude >= south && latitude <= north;

  if (!insideServiceArea) {
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
