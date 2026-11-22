export async function readBoundedBody(request: Request, maxBytes: number) {
  if (Number(request.headers.get("Content-Length")) > maxBytes) throw new Response(null, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();

  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return bytes.subarray(0, length);
      if (length + value.byteLength > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Response(null, { status: 413 });
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}
