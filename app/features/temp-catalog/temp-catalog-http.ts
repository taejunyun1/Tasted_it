const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function readTempForm(request: Request): Promise<FormData> {
  const advertised = Number(request.headers.get("Content-Length") ?? 0);
  if (!Number.isFinite(advertised) || advertised < 0 || advertised > MAX_BODY_BYTES) throw new Error("TEMP_REQUEST_TOO_LARGE");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("TEMP_REQUEST_TOO_LARGE"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("Content-Type") ?? "application/octet-stream" } }).formData();
  const keys = [...form.keys()];
  if (keys.length > 6 || new Set(keys).size !== keys.length || keys.some((key) => !["intent", "manifest", "batchId", "operationId", "evidence"].includes(key))) throw new Error("TEMP_FORM_INVALID");
  return form;
}
