const NAVER_MAPS_SCRIPT_ID = "naver-maps-sdk";
let sdkPromise: Promise<typeof naver> | undefined;

type LoadNaverMapsOptions = Readonly<{
  requireGeocoder?: boolean;
}>;

function hasMapSdk(value: unknown): value is typeof naver {
  return typeof (value as { maps?: unknown } | undefined)?.maps === "object";
}

function hasGeocoderSdk(value: unknown): value is typeof naver {
  return typeof (value as { maps?: { Service?: { geocode?: unknown } } } | undefined)
    ?.maps?.Service?.geocode === "function";
}

export function buildNaverMapsScriptUrl(clientId: string) {
  const query = new URLSearchParams({ ncpKeyId: clientId, submodules: "geocoder" });
  return `https://oapi.map.naver.com/openapi/v3/maps.js?${query.toString()}`;
}

export function toBoundsTuple(
  southwest: { lat: number; lng: number },
  northeast: { lat: number; lng: number },
): [number, number, number, number] {
  return [southwest.lng, southwest.lat, northeast.lng, northeast.lat];
}

export function loadNaverMaps(clientId: string, { requireGeocoder = false }: LoadNaverMapsOptions = {}): Promise<typeof naver> {
  if (hasMapSdk(window.naver) && (!requireGeocoder || hasGeocoderSdk(window.naver))) return Promise.resolve(window.naver);
  if (hasMapSdk(window.naver) && requireGeocoder) return Promise.reject(new Error("NAVER Maps 지오코더가 초기화되지 않았습니다."));
  if (sdkPromise) return sdkPromise;

  const promise = new Promise<typeof naver>((resolve, reject) => {
    const existing = document.getElementById(NAVER_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const onLoad = () => hasMapSdk(window.naver) && (!requireGeocoder || hasGeocoderSdk(window.naver))
      ? resolve(window.naver)
      : reject(new Error(requireGeocoder ? "NAVER Maps 지오코더가 초기화되지 않았습니다." : "NAVER Maps SDK가 초기화되지 않았습니다."));

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", () => reject(new Error("NAVER Maps SDK를 불러오지 못했습니다.")), { once: true });
    if (!existing) {
      script.id = NAVER_MAPS_SCRIPT_ID;
      script.src = buildNaverMapsScriptUrl(clientId);
      script.async = true;
      document.head.appendChild(script);
    }
  });

  sdkPromise = promise;
  void promise.catch(() => {
    if (sdkPromise === promise) sdkPromise = undefined;
  });
  return promise;
}
