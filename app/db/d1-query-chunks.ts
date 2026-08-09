const D1_MAX_BOUND_PARAMETERS = 100;

export async function loadInD1Chunks<TValue, TRow>(
  values: TValue[],
  loadChunk: (chunk: TValue[]) => Promise<TRow[]>,
  options: { reservedBindings?: number } = {},
): Promise<TRow[]> {
  const reservedBindings = options.reservedBindings ?? 0;
  const chunkSize = D1_MAX_BOUND_PARAMETERS - reservedBindings;
  if (chunkSize < 1) throw new RangeError("D1 조회에 사용할 수 있는 바인딩이 없습니다.");

  const rows: TRow[] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    rows.push(...await loadChunk(values.slice(index, index + chunkSize)));
  }
  return rows;
}
