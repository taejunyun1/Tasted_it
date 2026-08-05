import { useEffect, useRef, useState } from "react";
import { loadNaverMaps } from "../../features/maps/naver-map-sdk";

export function CandidateMap({ candidates, clientId }: { candidates: Array<{ id: string; businessName: string; latitude: number | null; longitude: number | null }>; clientId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!host.current || !clientId) { if (!clientId) setError("NAVER Maps Client ID가 설정되지 않았습니다."); return; }
    let disposed = false;
    let map: naver.maps.Map | undefined;
    const markers: naver.maps.Marker[] = [];
    void loadNaverMaps(clientId).then(({ maps }) => {
      if (disposed || !host.current) return;
      map = new maps.Map(host.current, { center: new maps.LatLng(35.1595, 126.8526), zoom: 10, zoomControl: true });
      for (const candidate of candidates) {
        if (candidate.latitude == null || candidate.longitude == null) continue;
        const pin = document.createElement("button");
        pin.className = "candidate-pin"; pin.type = "button"; pin.textContent = "·"; pin.title = candidate.businessName;
        pin.onclick = () => document.getElementById(`candidate-${candidate.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        markers.push(new maps.Marker({ map, position: new maps.LatLng(candidate.latitude, candidate.longitude), icon: { content: pin, anchor: new maps.Point(10, 10) } }));
      }
    }).catch(() => setError("네이버 지도를 불러오지 못했습니다."));
    return () => { disposed = true; markers.forEach((marker) => marker.setMap(null)); map?.destroy(); };
  }, [candidates, clientId]);
  return <div className="candidate-map" ref={host}>{error && <p className="map-error">{error}</p>}</div>;
}
