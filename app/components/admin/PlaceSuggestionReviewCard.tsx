import { useEffect, useRef, useState, type FormEvent } from "react";
import { Form, useNavigation } from "react-router";

import { PlaceLocationPicker } from "../places/PlaceLocationPicker";

type SuggestionReviewItem = {
  id: string;
  decisionRevision: string;
  status: string;
  name: string;
  address: string;
  neighborhood: string;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
};

type PlaceSuggestionReviewCardProps = {
  item: SuggestionReviewItem;
  approvalError?: string;
  transitionError?: string;
  clientId: string;
  geocodingAvailable: boolean;
};

export function PlaceSuggestionReviewCard({ item, approvalError, transitionError, clientId, geocodingAvailable }: PlaceSuggestionReviewCardProps) {
  const navigation = useNavigation();
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const submitLock = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const prefix = `approval-${item.id}-`;
  const pending = navigation.state !== "idle" && navigation.formData?.get("suggestionId") === item.id;
  const approving = pending && navigation.formData?.get("intent") === "approve-suggestion";

  useEffect(() => {
    if (!pending) submitLock.current = false;
  }, [pending]);
  useEffect(() => {
    if (approvalError || transitionError) errorRef.current?.focus();
  }, [approvalError, transitionError]);

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
        <Form method="post" className="ops-form ops-suggestion-approval" onSubmit={preventDuplicateSubmit}>
          <input type="hidden" name="intent" value="approve-suggestion" />
          <input type="hidden" name="suggestionId" value={item.id} />
          <input type="hidden" name="expectedRevision" value={item.decisionRevision} />
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
            {approving ? "승인 중…" : "초안 승인"}
          </button>
          {!locationConfirmed && geocodingAvailable && <p className="ops-form-help">지도에서 위치를 확인한 뒤 승인할 수 있습니다.</p>}
          {approvalError && <p className="operation-error" role="alert" tabIndex={-1} ref={errorRef}>{approvalError}</p>}
        </Form>
        <Form method="post" className="ops-form ops-form-compact" onSubmit={preventDuplicateSubmit}>
          <input type="hidden" name="intent" value="transition-suggestion" />
          <input type="hidden" name="suggestionId" value={item.id} />
          <input type="hidden" name="expectedRevision" value={item.decisionRevision} />
          <input name="reason" placeholder="추가 정보 요청 사유" required maxLength={300} />
          <button className="secondary" name="status" value="NEEDS_INFO" disabled={pending}>추가 정보</button>
          <button className="secondary" name="status" value="REJECTED" disabled={pending}>반려</button>
          {transitionError && <p className="operation-error col-span-full" role="alert" tabIndex={-1} ref={errorRef}>{transitionError}</p>}
        </Form>
      </div>
    </article>
  );
}
