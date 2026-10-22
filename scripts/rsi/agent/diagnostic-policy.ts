// Mutable strategy. The supervisor reads/bundles these bytes as data; execution
// belongs exclusively to the isolated agent container. No oracle lives here.
export function diagnose(payload: Record<string, unknown>): Record<string, unknown> {
  return payload.modelReply as Record<string, unknown>;
}
