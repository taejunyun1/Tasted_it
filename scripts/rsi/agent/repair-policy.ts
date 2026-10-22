import { diagnose } from "./diagnostic-policy";

// Both task kinds use the same active two-module source closure. R4 may replace
// these modules, but must validate an improve-agent proposal outside the agent.
export default function strategy(input: { schemaVersion: 1; taskKind: "repair" | "improve-agent"; payload: Record<string, unknown> }) {
  if (input.taskKind === "improve-agent") return input.payload.modelReply;
  if (input.payload.phase === "DIAGNOSE") return diagnose(input.payload);
  return input.payload.modelReply;
}
