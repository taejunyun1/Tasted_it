import { isRouteErrorResponse } from "react-router";

export type PlaceDetailLoadFailure = { detailError: true; status: number };
export type PlaceDetailMutationFailure = { ok: false; resultUnknown: boolean; status: number };

function failureStatus(error: unknown) {
  const status = error instanceof Response || isRouteErrorResponse(error) ? error.status : 503;
  // Authentication and canonical-place redirects must retain router semantics.
  if (status >= 300 && status < 400) throw error;
  return status;
}

export async function loadPlaceDetailSafely<T>(load: () => Promise<T>): Promise<T | PlaceDetailLoadFailure> {
  try { return await load(); }
  catch (error) { return { detailError: true, status: failureStatus(error) }; }
}

export async function mutatePlaceDetailSafely<T>(mutate: () => Promise<T>): Promise<T | PlaceDetailMutationFailure> {
  try { return await mutate(); }
  catch (error) {
    const status = failureStatus(error);
    return { ok: false, resultUnknown: ![400, 401, 403, 404, 409, 422, 429].includes(status), status };
  }
}
