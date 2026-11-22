import { isCoordinateInActiveMarket } from "../regions/region-pack";

export type CourseLocationStatus = "IDLE" | "PENDING" | "SUCCESS" | "DENIED" | "UNAVAILABLE" | "TIMEOUT" | "UNSUPPORTED" | "OUTSIDE";

export function resolveCourseDeviceLocation(coordinates: { latitude: number; longitude: number }) {
  return isCoordinateInActiveMarket(coordinates.latitude, coordinates.longitude) ? coordinates : null;
}

export function courseLocationMessage(status: CourseLocationStatus, hasCoordinates: boolean) {
  const fallback = hasCoordinates ? "선택한 위치를 그대로 사용합니다." : "광주시청을 기준으로 계속 찾을 수 있어요.";
  switch (status) {
    case "PENDING": return "현재 위치를 확인하고 있어요.";
    case "SUCCESS": return "현재 위치를 반영했습니다.";
    case "DENIED": return `위치 권한이 꺼져 있어요. 브라우저의 위치 권한을 확인해 주세요. ${fallback}`;
    case "UNAVAILABLE": return `현재 위치를 확인할 수 없어요. 잠시 후 다시 시도해 주세요. ${fallback}`;
    case "TIMEOUT": return `위치 확인 시간이 초과됐어요. 다시 시도할 수 있습니다. ${fallback}`;
    case "UNSUPPORTED": return `이 브라우저는 위치 확인을 지원하지 않아요. ${fallback}`;
    case "OUTSIDE": return `지금은 광주·전남의 코스만 안내합니다. ${fallback}`;
    default: return fallback;
  }
}
