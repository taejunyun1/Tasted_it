const NAVER_MAPS_SCRIPT_ID = "naver-maps-sdk";
const SDK_LOAD_TIMEOUT_MS = 12_000;
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
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      // The next explicit attempt needs a fresh load event. Reusing a failed
      // script element leaves every subsequent caller waiting indefinitely.
      if (document.getElementById(NAVER_MAPS_SCRIPT_ID) === script) script.remove();
      reject(new Error(message));
    };
    const onLoad = () => {
      if (settled) return;
      if (!hasMapSdk(window.naver) || requireGeocoder && !hasGeocoderSdk(window.naver)) {
        fail(requireGeocoder ? "NAVER Maps 지오코더가 초기화되지 않았습니다." : "NAVER Maps SDK가 초기화되지 않았습니다.");
        return;
      }
      settled = true;
      cleanup();
      resolve(window.naver);
    };
    const onError = () => fail("NAVER Maps SDK를 불러오지 못했습니다.");

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    timeout = setTimeout(() => fail("NAVER Maps SDK 응답 시간이 초과됐습니다."), SDK_LOAD_TIMEOUT_MS);
    if (!existing) {
      script.id = NAVER_MAPS_SCRIPT_ID;
      script.src = buildNaverMapsScriptUrl(clientId);
      script.async = true;
      try { document.head.appendChild(script); }
      catch { fail("NAVER Maps SDK를 불러오지 못했습니다."); }
    }
  });

  sdkPromise = promise;
  void promise.catch(() => {
    if (sdkPromise === promise) sdkPromise = undefined;
  });
  return promise;
}
