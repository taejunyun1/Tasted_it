import { useEffect, useRef, useState } from "react";
import { loadNaverMaps } from "../../features/maps/naver-map-sdk";
import { LAUNCH_DEFAULT_CENTER } from "../../features/regions/region-pack";

export function CandidateMap({ candidates, clientId, selected, onSelect }: { candidates: Array<{ id: string; businessName: string; latitude: number | null; longitude: number | null }>; clientId: string; selected?: string | null; onSelect?: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!host.current || !clientId) { if (!clientId) setError("NAVER Maps Client ID가 설정되지 않았습니다."); return; }
    let disposed = false;
    let map: naver.maps.Map | undefined;
    const markers: naver.maps.Marker[] = [];
    void loadNaverMaps(clientId).then(({ maps }) => {
      if (disposed || !host.current) return;
      map = new maps.Map(host.current, { center: new maps.LatLng(LAUNCH_DEFAULT_CENTER.latitude, LAUNCH_DEFAULT_CENTER.longitude), zoom: 10, zoomControl: true });
      for (const candidate of candidates) {
        if (candidate.latitude == null || candidate.longitude == null) continue;
        const pin = document.createElement("button");
        pin.className = `candidate-pin${selected === candidate.id ? " is-selected" : ""}`; pin.type = "button"; pin.textContent = "·"; pin.title = candidate.businessName;
        pin.onclick = () => { onSelect?.(candidate.id); document.getElementById(`candidate-${candidate.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); };
        markers.push(new maps.Marker({ map, position: new maps.LatLng(candidate.latitude, candidate.longitude), icon: { content: pin, anchor: new maps.Point(10, 10) } }));
      }
    }).catch(() => setError("네이버 지도를 불러오지 못했습니다."));
    return () => { disposed = true; markers.forEach((marker) => marker.setMap(null)); map?.destroy(); };
  }, [candidates, clientId, onSelect, selected]);
  return <div className="candidate-map" ref={host}>{error && <p className="map-error">{error}</p>}</div>;
}
