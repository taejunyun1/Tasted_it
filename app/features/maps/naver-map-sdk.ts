const NAVER_MAPS_SCRIPT_ID = "naver-maps-sdk";
let sdkPromise: Promise<typeof naver> | undefined;

export function buildNaverMapsScriptUrl(clientId: string) {
  return `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
}

export function toBoundsTuple(
  southwest: { lat: number; lng: number },
  northeast: { lat: number; lng: number },
): [number, number, number, number] {
  return [southwest.lng, southwest.lat, northeast.lng, northeast.lat];
}

export function loadNaverMaps(clientId: string): Promise<typeof naver> {
  if (window.naver?.maps) return Promise.resolve(window.naver);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(NAVER_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const onLoad = () => window.naver?.maps
      ? resolve(window.naver)
      : reject(new Error("NAVER Maps SDK가 초기화되지 않았습니다."));

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", () => reject(new Error("NAVER Maps SDK를 불러오지 못했습니다.")), { once: true });
    if (!existing) {
      script.id = NAVER_MAPS_SCRIPT_ID;
      script.src = buildNaverMapsScriptUrl(clientId);
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return sdkPromise;
}
