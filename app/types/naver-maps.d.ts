declare namespace naver.maps {
  class LatLng {
    constructor(lat: number, lng: number);
  }

  class Point {
    constructor(x: number, y: number);
  }

  class Map {
    constructor(element: HTMLElement, options: { center: LatLng; zoom: number; zoomControl?: boolean; zoomControlOptions?: { position: Position } });
    getBounds(): LatLngBounds;
    getZoom(): number;
    fitBounds(bounds: LatLngBounds): void;
    panTo(position: LatLng): void;
    setCenter(position: LatLng): void;
    setZoom(zoom: number): void;
    destroy(): void;
  }

  class Marker {
    constructor(options: { map: Map; position: LatLng; icon?: { content: HTMLElement; anchor: Point } });
    setMap(map: Map | null): void;
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
    function addListener(target: Map, eventName: string, listener: () => void): unknown;
    function removeListener(listener: unknown): void;
  }
}

declare const naver: { maps: typeof naver.maps };

interface Window {
  naver: typeof naver;
}
