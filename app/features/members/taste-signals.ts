export type TasteGraph = {
  status: "LEARNING" | "VISIBLE";
  placeCount: number;
  dimensions: Array<{ key: string; value: number }>;
};

export function selectTasteSignals(graph: TasteGraph) {
  if (graph.status === "LEARNING") {
    return {
      status: "LEARNING" as const,
      placeCount: graph.placeCount,
      requiredPlaceCount: 5,
      signals: [] as Array<{ key: string; value: number; label: string }>,
    };
  }

  return {
    status: "VISIBLE" as const,
    placeCount: graph.placeCount,
    signals: [...graph.dimensions]
      .sort((left, right) => right.value - left.value || left.key.localeCompare(right.key, "ko"))
      .slice(0, 3)
      .map(({ key, value }) => ({ key, value, label: `${key} ${value.toFixed(1)}` })),
  };
}
