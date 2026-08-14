declare namespace naver.maps {
  class LatLng {
    constructor(lat: number, lng: number);
    lat(): number;
    lng(): number;
  }

  class Point {
    constructor(x: number, y: number);
  }

  class Map {
    constructor(element: HTMLElement, options: { center: LatLng; zoom: number; zoomControl?: boolean; zoomControlOptions?: { position: Position } });
    getBounds(): LatLngBounds;
    getZoom(): number;
    fitBounds(bounds: LatLngBounds): void;
    morph(position: LatLng, zoom: number, options?: { duration?: number; easing?: "linear" | "easeOutCubic" | "easeInCubic" }): void;
    panTo(position: LatLng, options?: { duration?: number; easing?: "linear" | "easeOutCubic" | "easeInCubic" }): void;
    setCenter(position: LatLng): void;
    setZoom(zoom: number): void;
    destroy(): void;
  }

  class Marker {
    constructor(options: { map: Map; position: LatLng; icon?: { content: HTMLElement; anchor: Point }; draggable?: boolean });
    setMap(map: Map | null): void;
    getPosition(): LatLng;
    setPosition(position: LatLng): void;
  }

  class LatLngBounds {
    constructor(southwest: LatLng, northeast: LatLng);
    getSW(): { lat(): number; lng(): number };
    getNE(): { lat(): number; lng(): number };
  }

  enum Position {
    TOP_RIGHT,
  }

  namespace Event {
    function addListener(target: Map | Marker, eventName: string, listener: (event: { coord: LatLng }) => void): unknown;
    function removeListener(listener: unknown): void;
  }

  namespace Service {
    enum Status {
      OK,
      ERROR,
    }

    function geocode(
      options: { query: string },
      callback: (status: Status, response: { v2: { addresses: Array<{
        roadAddress: string;
        jibunAddress: string;
        x: string;
        y: string;
      }> } }) => void,
    ): void;
  }
}

declare const naver: { maps: typeof naver.maps };

interface Window {
  naver: typeof naver;
}
