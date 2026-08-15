import { useEffect, useRef, useState } from "react";

import {
  isSupportedRegionAddress,
  normalizeSupportedRegionAddress,
  extractPlaceNeighborhood,
  normalizeGeocodeCandidates,
  type GeocodedPlaceCandidate,
  type PlaceCoordinate,
  validateAdjustedCoordinate,
} from "../../features/maps/place-location";
import { loadNaverMaps } from "../../features/maps/naver-map-sdk";

type PlaceLocationPickerProps = {
  clientId: string;
  namePrefix?: string;
  defaultAddress?: string;
  defaultNeighborhood?: string | null;
  defaultLatitude?: number | null;
  defaultLongitude?: number | null;
  mode: "MEMBER" | "ADMIN";
  required?: boolean;
  onConfirmedChange?: (confirmed: boolean) => void;
};

type PickerStatus = "IDLE" | "SEARCHING" | "RESULTS" | "READY";

function inputName(namePrefix: string, field: string) {
  return `${namePrefix}${field}`;
}

function initialCoordinate(latitude?: number | null, longitude?: number | null): PlaceCoordinate | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude: Number(latitude), longitude: Number(longitude) };
}

function nudgeCoordinate(coordinate: PlaceCoordinate, direction: "UP" | "DOWN" | "LEFT" | "RIGHT"): PlaceCoordinate {
  const meters = 10;
  const latitudeDelta = meters / 111_320;
  const longitudeDelta = meters / (111_320 * Math.cos(coordinate.latitude * (Math.PI / 180)));

  if (direction === "UP") return { ...coordinate, latitude: coordinate.latitude + latitudeDelta };
  if (direction === "DOWN") return { ...coordinate, latitude: coordinate.latitude - latitudeDelta };
  if (direction === "LEFT") return { ...coordinate, longitude: coordinate.longitude - longitudeDelta };
  return { ...coordinate, longitude: coordinate.longitude + longitudeDelta };
}

function locationErrorMessage(code: string) {
  if (code === "LOCATION_TOO_FAR_FROM_ADDRESS") return "처음 찾은 주소에서 2km 안에서만 위치를 조정할 수 있어요.";
  if (code === "LOCATION_OUT_OF_SCOPE") return "광주·전남 범위 안의 위치를 선택해 주세요.";
  return "주소와 위치를 다시 확인해 주세요.";
}

export function PlaceLocationPicker({
  clientId,
  namePrefix = "",
  defaultAddress = "",
  defaultNeighborhood,
  defaultLatitude,
  defaultLongitude,
  mode,
  required = false,
  onConfirmedChange,
}: PlaceLocationPickerProps) {
  const initial = initialCoordinate(defaultLatitude, defaultLongitude);
  const [address, setAddress] = useState(defaultAddress);
  const [neighborhood, setNeighborhood] = useState(defaultNeighborhood ?? extractPlaceNeighborhood(defaultAddress));
  const [candidates, setCandidates] = useState<GeocodedPlaceCandidate[]>([]);
  const [origin, setOrigin] = useState<PlaceCoordinate | null>(initial);
  const [adjusted, setAdjusted] = useState<PlaceCoordinate | null>(initial);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<PickerStatus>(initial ? "READY" : "IDLE");
  const [mapVisible, setMapVisible] = useState(mode !== "ADMIN" || initial === null);
  const [error, setError] = useState("");
  const mapElementRef = useRef<HTMLDivElement | null>(null);

  function clearConfirmation() {
    setConfirmed(false);
    onConfirmedChange?.(false);
  }

  function clearLocation() {
    setCandidates([]);
    setOrigin(null);
    setAdjusted(null);
    setNeighborhood(null);
    setMapVisible(false);
    clearConfirmation();
  }

  function selectCandidate(candidate: GeocodedPlaceCandidate) {
    setAddress(candidate.address);
    setOrigin(candidate.coordinate);
    setAdjusted(candidate.coordinate);
    setNeighborhood(candidate.neighborhood);
    setMapVisible(true);
    setStatus("READY");
    setError("");
    clearConfirmation();
  }

  function updateAdjusted(next: PlaceCoordinate) {
    setAdjusted(next);
    clearConfirmation();
    if (origin) {
      const validation = validateAdjustedCoordinate(origin, next);
      setError(validation.ok ? "" : locationErrorMessage(validation.code));
    }
  }

  async function searchAddress() {
    clearLocation();
    const normalizedAddress = normalizeSupportedRegionAddress(address);
    if (!clientId) {
      setError("위치 검색 설정을 확인한 뒤 다시 시도해 주세요.");
      return;
    }
    if (!isSupportedRegionAddress(normalizedAddress)) {
      setError("광주·전남 주소만 제안할 수 있어요.");
      return;
    }

    setStatus("SEARCHING");
    setError("");
    try {
      const sdk = await loadNaverMaps(clientId, { requireGeocoder: true });
      const results = await new Promise<GeocodedPlaceCandidate[]>((resolve, reject) => {
        sdk.maps.Service.geocode({ query: normalizedAddress }, (geocodeStatus, response) => {
          if (geocodeStatus !== sdk.maps.Service.Status.OK) {
            reject(new Error("GEOCODE_FAILED"));
            return;
          }
          resolve(normalizeGeocodeCandidates(response.v2.addresses));
        });
      });
      if (!results.length) {
        setStatus("IDLE");
        setError("주소를 찾지 못했어요. 도로명 또는 지번 주소를 다시 확인해 주세요.");
        return;
      }
      setCandidates(results);
      setStatus("RESULTS");
    } catch {
      setStatus("IDLE");
      setError("위치 검색을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    }
  }

  function confirmLocation() {
    if (!origin || !adjusted) {
      setError("주소 검색 결과에서 위치를 하나 선택해 주세요.");
      return;
    }
    if (!neighborhood) {
      setError("주소의 동·읍·면·리를 확인하지 못했어요. 다른 주소 결과를 선택해 주세요.");
      return;
    }
    const validation = validateAdjustedCoordinate(origin, adjusted);
    if (!validation.ok) {
      setError(locationErrorMessage(validation.code));
      return;
    }
    setError("");
    setConfirmed(true);
    onConfirmedChange?.(true);
  }

  useEffect(() => {
    if (!origin || !adjusted || !mapElementRef.current || typeof window === "undefined") return;
    let disposed = false;
    let marker: naver.maps.Marker | null = null;
    let dragListener: unknown;
    let map: naver.maps.Map | null = null;

    void loadNaverMaps(clientId, { requireGeocoder: true }).then((sdk) => {
      if (disposed || !mapElementRef.current) return;
      const position = new sdk.maps.LatLng(adjusted.latitude, adjusted.longitude);
      map = new sdk.maps.Map(mapElementRef.current, { center: position, zoom: 16, zoomControl: true });
      marker = new sdk.maps.Marker({ map, position, draggable: true });
      dragListener = sdk.maps.Event.addListener(marker, "dragend", () => {
        const nextPosition = marker?.getPosition();
        if (!nextPosition) return;
        updateAdjusted({ latitude: nextPosition.lat(), longitude: nextPosition.lng() });
      });
    }).catch(() => {
      if (!disposed) setError("지도를 불러오지 못했어요. 위치를 다시 검색해 주세요.");
    });

    return () => {
      disposed = true;
      if (dragListener) window.naver?.maps.Event.removeListener(dragListener);
      marker?.setMap(null);
      map?.destroy();
    };
  // adjusted values deliberately recreate the simple marker state after a nudge.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjusted?.latitude, adjusted?.longitude, clientId, origin?.latitude, origin?.longitude]);

  const prefix = namePrefix;
  const hasMap = mapVisible && origin !== null && adjusted !== null;
  const canConfirm = hasMap && !error;

  return (
    <section className="place-location-picker" data-mode={mode} aria-labelledby={`${prefix}location-heading`}>
      <div className="place-location-picker-heading">
        <div>
          <p className="eyebrow">LOCATION / NAVER MAP</p>
          <h2 id={`${prefix}location-heading`}>지도에서 위치 확인</h2>
        </div>
        {confirmed && <b className="place-location-confirmed">위치 확인됨</b>}
      </div>
      <p className="place-location-help">주소를 찾고 지도 핀을 확인해 주세요. 정확한 위도·경도 입력은 필요 없어요.</p>

      <label className="place-location-address">
        <span>주소</span>
        <input
          name={inputName(prefix, "address")}
          value={address}
          required={required}
          autoComplete="street-address"
          placeholder="예: 광주광역시 동구 서석로 1"
          onChange={(event) => {
            setAddress(event.target.value);
            clearLocation();
            setStatus("IDLE");
            setError("");
          }}
        />
      </label>
      <button className="place-location-search" type="button" onClick={() => void searchAddress()} disabled={status === "SEARCHING"}>
        {status === "SEARCHING" ? "주소 찾는 중…" : "지도에서 위치 찾기"}
      </button>
      {mode === "ADMIN" && !mapVisible && origin && adjusted && (
        <button className="place-location-search" type="button" onClick={() => { setMapVisible(true); clearConfirmation(); }}>
          기존 위치 지도에서 확인
        </button>
      )}

      <p className="place-location-status" role="status" aria-live="polite">
        {status === "SEARCHING" ? "NAVER 지도에서 주소를 찾고 있어요." : ""}
        {status === "RESULTS" ? "주소 결과를 하나 선택해 지도에서 확인해 주세요." : ""}
        {status === "READY" && !confirmed ? "핀 위치가 맞는지 확인한 뒤 확정해 주세요." : ""}
        {confirmed ? "이 위치로 제안에 저장됩니다." : ""}
      </p>
      {error && <p className="place-location-error" role="alert">{error}</p>}

      {candidates.length > 0 && (
        <fieldset className="place-location-candidates">
          <legend>찾은 주소</legend>
          {candidates.map((candidate, index) => (
            <button
              key={`${candidate.address}-${candidate.coordinate.latitude}-${candidate.coordinate.longitude}`}
              className="place-location-candidate"
              type="button"
              aria-pressed={origin?.latitude === candidate.coordinate.latitude && origin.longitude === candidate.coordinate.longitude}
              onClick={() => selectCandidate(candidate)}
            >
              <span>
                <b>{candidate.roadAddress ?? candidate.jibunAddress ?? candidate.address}</b>
                {candidate.roadAddress && candidate.jibunAddress && <small>{candidate.jibunAddress}</small>}
                <i>후보 {index + 1} · 지도에서 확인</i>
              </span>
              <em aria-hidden="true">선택</em>
            </button>
          ))}
        </fieldset>
      )}

      {hasMap && (
        <div className="place-location-map-wrap">
          <div className="place-location-map" ref={mapElementRef} aria-label="선택한 장소 위치 지도" />
          <div className="place-location-controls" aria-label="핀 위치 미세 조정">
            <button type="button" onClick={() => origin && updateAdjusted(origin)}>원래 위치</button>
            <button type="button" onClick={() => adjusted && updateAdjusted(nudgeCoordinate(adjusted, "UP"))}>10m 위</button>
            <button type="button" onClick={() => adjusted && updateAdjusted(nudgeCoordinate(adjusted, "DOWN"))}>10m 아래</button>
            <button type="button" onClick={() => adjusted && updateAdjusted(nudgeCoordinate(adjusted, "LEFT"))}>10m 왼쪽</button>
            <button type="button" onClick={() => adjusted && updateAdjusted(nudgeCoordinate(adjusted, "RIGHT"))}>10m 오른쪽</button>
          </div>
          {mode === "ADMIN" && adjusted && (
            <small className="place-location-coordinate">선택 좌표: {adjusted.latitude.toFixed(5)}, {adjusted.longitude.toFixed(5)}</small>
          )}
          <button className="place-location-confirm" type="button" onClick={confirmLocation} disabled={!canConfirm}>이 위치로 확정</button>
        </div>
      )}

      <input type="hidden" name={inputName(prefix, "latitude")} value={confirmed && adjusted ? adjusted.latitude : ""} />
      <input type="hidden" name={inputName(prefix, "longitude")} value={confirmed && adjusted ? adjusted.longitude : ""} />
      <input type="hidden" name={inputName(prefix, "originLatitude")} value={confirmed && origin ? origin.latitude : ""} />
      <input type="hidden" name={inputName(prefix, "originLongitude")} value={confirmed && origin ? origin.longitude : ""} />
      <input type="hidden" name={inputName(prefix, "locationConfirmed")} value={confirmed ? "true" : ""} />
      <input type="hidden" name={inputName(prefix, "neighborhood")} value={confirmed ? neighborhood ?? "" : ""} />
    </section>
  );
}
