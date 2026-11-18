export function FlavorMeter({ dimension, value }: { dimension: string; value: number }) {
  return <meter min="1" max="5" value={value} aria-label={`${dimension} 점수`}>{value}/5</meter>;
}
