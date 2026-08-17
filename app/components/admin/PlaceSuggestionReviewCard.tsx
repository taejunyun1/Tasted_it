import { useEffect, useRef, useState, type FormEvent } from "react";
import { Form, Link, useFetcher } from "react-router";

import { PlaceLocationPicker } from "../places/PlaceLocationPicker";

type SuggestionReviewItem = {
  id: string;
  status: string;
  name: string;
  address: string;
  neighborhood: string;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
};

type SuggestionActionData = {
  ok: boolean;
  message?: string;
  error?: string;
  suggestionId?: string;
  placeId?: string;
  slug?: string;
};

type PlaceSuggestionReviewCardProps = {
  item: SuggestionReviewItem;
  clientId: string;
  geocodingAvailable: boolean;
};

export function PlaceSuggestionReviewCard({ item, clientId, geocodingAvailable }: PlaceSuggestionReviewCardProps) {
  const fetcher = useFetcher<SuggestionActionData>();
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const submitLock = useRef(false);
  const prefix = `approval-${item.id}-`;
  const pending = fetcher.state !== "idle";
  const actionData = fetcher.data;
  const approved = actionData?.ok && actionData.suggestionId === item.id && actionData.slug;

  useEffect(() => {
    if (!pending) submitLock.current = false;
  }, [pending]);

  function preventDuplicateSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitLock.current) {
      event.preventDefault();
      return;
    }
    submitLock.current = true;
  }

  return (
    <article className="ops-card" data-suggestion-id={item.id}>
      <div>
        <span>{item.status}</span>
        <h3>{item.name}</h3>
        <p>{item.address} · {item.neighborhood}</p>
        <small>{item.description ?? "설명 없음"}</small>
      </div>
      <div className="ops-actions">
        {approved ? (
          <p className="operation-success" role="status">
            승인 완료 · <Link to={`/places/${actionData.slug}`}>생성한 초안 보기</Link>
          </p>
        ) : (
          <fetcher.Form method="post" className="ops-form ops-suggestion-approval" onSubmit={preventDuplicateSubmit}>
            <input type="hidden" name="intent" value="approve-suggestion" />
            <input type="hidden" name="suggestionId" value={item.id} />
            {geocodingAvailable ? (
              <PlaceLocationPicker
                clientId={clientId}
                namePrefix={prefix}
                defaultAddress={item.address}
                defaultNeighborhood={item.neighborhood}
                defaultLatitude={item.latitude}
                defaultLongitude={item.longitude}
                mode="ADMIN"
                required
                onConfirmedChange={setLocationConfirmed}
              />
            ) : (
              <p className="operation-error" role="alert">현재 위치 검색을 사용할 수 없어 승인할 수 없습니다.</p>
            )}
            <input name="reason" placeholder="승인 근거" required maxLength={300} disabled={pending} />
            <button disabled={pending || !locationConfirmed || !geocodingAvailable}>
              {pending ? "승인 중…" : "초안 승인"}
            </button>
            {!locationConfirmed && geocodingAvailable && <p className="ops-form-help">지도에서 위치를 확인한 뒤 승인할 수 있습니다.</p>}
            {actionData && !actionData.ok && <p className="operation-error" role="alert">{actionData.error ?? "초안 승인에 실패했어요. 잠시 뒤 다시 시도해 주세요."}</p>}
          </fetcher.Form>
        )}
        <Form method="post" className="ops-form ops-form-compact">
          <input type="hidden" name="intent" value="transition-suggestion" />
          <input type="hidden" name="suggestionId" value={item.id} />
          <input name="reason" placeholder="추가 정보 요청 사유" required />
          <button className="secondary" name="status" value="NEEDS_INFO" disabled={pending}>추가 정보</button>
          <button className="secondary" name="status" value="REJECTED" disabled={pending}>반려</button>
        </Form>
      </div>
    </article>
  );
}
