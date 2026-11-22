import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { resolveLocationViewport } from "./location-policy";

type LocationViewport = ReturnType<typeof resolveLocationViewport>;

const pendingNotice = "현재 위치를 확인하고 있습니다.";

function locationErrorNotice(code: number, deniedNotice?: string) {
  switch (code) {
    case 1: return deniedNotice ?? "위치 권한이 꺼져 있습니다. 브라우저 설정에서 허용하거나 장소를 검색해 주세요.";
    case 3: return "현재 위치 확인 시간이 초과됐습니다. 다시 시도하거나 장소를 검색해 주세요.";
    default: return "현재 위치를 확인할 수 없습니다. 다시 시도하거나 지도를 직접 움직여 주세요.";
  }
}

export function useMapLocationRequest(scope: string, deniedNotice?: string) {
  const request = useRef<object | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useLayoutEffect(() => {
    setLocating(false);
    return () => { request.current = null; };
  }, [scope]);

  const clearLocation = useCallback(() => {
    request.current = null;
    setLocating(false);
    setNotice(null);
  }, []);

  function locate(apply: (result: LocationViewport) => string | null) {
    if (request.current) return;
    const geolocation = navigator.geolocation;
    if (typeof geolocation?.getCurrentPosition !== "function") {
      setNotice("이 브라우저는 현재 위치를 지원하지 않습니다. 지도를 직접 움직이거나 장소를 검색해 주세요.");
      return;
    }

    const token = {};
    request.current = token;
    setLocating(true);
    setNotice(null);
    const finish = () => {
      if (request.current !== token) return false;
      request.current = null;
      setLocating(false);
      return true;
    };
    geolocation.getCurrentPosition(({ coords }) => {
      if (finish()) setNotice(apply(resolveLocationViewport(coords)));
    }, (error) => {
      if (finish()) setNotice(locationErrorNotice(error.code, deniedNotice));
    }, { enableHighAccuracy: true, timeout: 8_000 });
  }

  return { locating, notice: locating ? pendingNotice : notice, clearLocation, locate };
}
