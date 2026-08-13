import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";

import { AppToast, type AppToastValue } from "./app-toast";
import {
  prepareReviewerPhotoFiles,
  releaseReviewerPhotoPreviews,
  reviewerPhotoErrorMessage,
} from "../features/ratings/reviewer-photo.client";
import {
  REVIEWER_BADGE_CATALOG,
  type ReviewerCategoryName,
  type ReviewerEvaluation,
} from "../features/ratings/reviewer-visit";

type ReviewerPlace = {
  placeId: string;
  placeName: string;
  neighborhood: string | null;
  categoryId: string;
  categoryName: string;
  categoryEmoji: string;
};

type ReviewerCategory = { id: string; name: string; emoji: string };

type ReviewerHistory = {
  id: string;
  placeId: string;
  placeName: string;
  categoryId: string;
  categoryName: string;
  evaluation: "RECOMMEND" | "HOLD" | "NOT_RECOMMEND";
  badgesJson: string;
  photoCount: number;
  goldenPickEventId: string | null;
  version: number;
  publishedAt: string;
  photos: Array<{ id: string; url: string }>;
};

type Props = {
  places: ReviewerPlace[];
  categories: ReviewerCategory[];
  history: ReviewerHistory[];
  goldenQuota: { used: number; limit: number; remaining: number };
  publishedReviewId: string | null;
  photoUploadEnabled: boolean;
  notice: "review-published" | "review-with-photos-published" | null;
};

type Draft = {
  step: number;
  placeId: string;
  categoryId: string;
  evaluation: ReviewerEvaluation | null;
  badges: string[];
};

const DRAFT_KEY = "retaste:reviewer-visit:v3";
const evaluationLabels: Record<ReviewerEvaluation, string> = {
  RECOMMEND: "추천",
  HOLD: "보류",
  NOT_RECOMMEND: "비추천",
};

function parseBadges(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function ReviewerVisitFlow({ places, categories, history, goldenQuota, publishedReviewId, photoUploadEnabled, notice }: Props) {
  const fetcher = useFetcher<{ ok: false; error: string }>();
  const [step, setStep] = useState(1);
  const [placeId, setPlaceId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [evaluation, setEvaluation] = useState<ReviewerEvaluation | null>(null);
  const [badges, setBadges] = useState<string[]>([]);
  const [placeQuery, setPlaceQuery] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [badgeError, setBadgeError] = useState("");
  const [photos, setPhotos] = useState<Array<{ file: File; position: number; previewUrl: string }>>([]);
  const photosRef = useRef(photos);
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const submitLockRef = useRef(false);
  const [publishLocked, setPublishLocked] = useState(false);
  const [golden, setGolden] = useState(false);
  const [goldenReason, setGoldenReason] = useState("");
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<AppToastValue | null>(() => notice
    ? { kind: "success", message: notice === "review-with-photos-published" ? "사진과 리뷰를 발행했어요." : "리뷰를 발행했어요." }
    : null);
  const [restored, setRestored] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const selectedPlace = places.find((place) => place.placeId === placeId) ?? null;
  const selectedCategory = categories.find((category) => category.id === categoryId) ?? null;
  const categoryName = selectedCategory?.name as ReviewerCategoryName | undefined;
  const badgeOptions = categoryName ? REVIEWER_BADGE_CATALOG[categoryName] ?? [] : [];
  const filteredPlaces = useMemo(() => {
    const query = placeQuery.trim().toLocaleLowerCase("ko");
    if (!query) return places.slice(0, 12);
    return places.filter((place) => `${place.placeName} ${place.neighborhood ?? ""} ${place.categoryName}`.toLocaleLowerCase("ko").includes(query)).slice(0, 20);
  }, [placeQuery, places]);
  const filteredCategories = useMemo(() => {
    const query = categoryQuery.trim().toLocaleLowerCase("ko");
    return categories.filter((category) => !query || `${category.emoji} ${category.name}`.toLocaleLowerCase("ko").includes(query));
  }, [categories, categoryQuery]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved) as Draft;
        if (draft.placeId && places.some((place) => place.placeId === draft.placeId)) {
          setStep(Math.max(1, Math.min(5, draft.step)));
          setPlaceId(draft.placeId);
          setCategoryId(draft.categoryId);
          setEvaluation(draft.evaluation);
          setBadges(draft.badges.slice(0, 2));
          setRestored(true);
        }
      }
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
    setHydrated(true);
  }, [places]);

  useEffect(() => {
    if (!hydrated || publishedReviewId) return;
    const draft: Draft = { step, placeId, categoryId, evaluation, badges };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [badges, categoryId, evaluation, hydrated, placeId, publishedReviewId, step]);

  useEffect(() => {
    if (!publishedReviewId) return;
    localStorage.removeItem(DRAFT_KEY);
  }, [publishedReviewId]);

  useEffect(() => {
    if (!notice) return;
    setToast({ kind: "success", message: notice === "review-with-photos-published" ? "사진과 리뷰를 발행했어요." : "리뷰를 발행했어요." });
  }, [notice]);

  useEffect(() => () => {
    releaseReviewerPhotoPreviews(photosRef.current);
  }, []);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || fetcher.data.ok !== false) return;
    const message = reviewerPhotoErrorMessage(fetcher.data.error);
    setFormError(message);
    setToast({ kind: "error", message });
  }, [fetcher.data, fetcher.state]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !submitLockRef.current) return;
    submitLockRef.current = false;
    setPublishLocked(false);
  }, [fetcher.state]);

  function choosePlace(nextPlace: ReviewerPlace) {
    setPlaceId(nextPlace.placeId);
    const primary = categories.find((category) => category.id === nextPlace.categoryId);
    setCategoryId(primary?.id ?? "");
    setBadges([]);
    setBadgeError("");
  }

  function chooseCategory(nextCategoryId: string) {
    setCategoryId(nextCategoryId);
    setBadges([]);
    setBadgeError("");
  }

  function toggleBadge(badge: string) {
    if (badges.includes(badge)) {
      setBadges((current) => current.filter((item) => item !== badge));
      setBadgeError("");
      return;
    }
    if (badges.length >= 2) {
      setBadgeError("배지는 최대 2개까지 선택할 수 있어요.");
      return;
    }
    setBadges((current) => [...current, badge]);
    setBadgeError("");
  }

  function discardDraft() {
    localStorage.removeItem(DRAFT_KEY);
    setStep(1);
    setPlaceId("");
    setCategoryId("");
    setEvaluation(null);
    setBadges([]);
    replacePhotos([]);
    setGolden(false);
    setGoldenReason("");
    setRestored(false);
  }

  async function selectPhotos(sourceFiles: File[], input: HTMLInputElement) {
    setFormError("");
    setPreparingPhotos(true);
    try {
      const prepared = await prepareReviewerPhotoFiles(sourceFiles);
      replacePhotos(prepared.map((photo) => ({
        ...photo,
        previewUrl: URL.createObjectURL(photo.file),
      })));
      setToast({ kind: "info", message: `${prepared.length}장 사진을 발행 준비했어요.` });
    } catch (error) {
      const code = error instanceof Error ? error.message : "PHOTO_DECODE_FAILED";
      const message = reviewerPhotoErrorMessage(code);
      setFormError(message);
      setToast({ kind: "error", message });
    } finally {
      input.value = "";
      setPreparingPhotos(false);
    }
  }

  function removePhoto(position: number) {
    const removed = photosRef.current.find((photo) => photo.position === position);
    if (removed) releaseReviewerPhotoPreviews([removed]);
    const next = photosRef.current.filter((photo) => photo.position !== position);
    photosRef.current = next;
    setPhotos(next);
  }

  function replacePhotos(nextPhotos: Array<{ file: File; position: number; previewUrl: string }>) {
    releaseReviewerPhotoPreviews(photosRef.current);
    photosRef.current = nextPhotos;
    setPhotos(nextPhotos);
  }

  function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLockRef.current || fetcher.state !== "idle" || preparingPhotos) {
      if (submitLockRef.current) setToast({ kind: "info", message: "리뷰를 발행하고 있어요." });
      return;
    }
    submitLockRef.current = true;
    setPublishLocked(true);
    setFormError("");
    const form = new FormData(event.currentTarget);
    form.delete("photos");
    [...photos].sort((first, second) => first.position - second.position).forEach((photo) => form.append("photos", photo.file));
    fetcher.submit(form, { method: "post", encType: "multipart/form-data" });
  }

  const goldenEligible = photoUploadEnabled && photos.length > 0 && badges.length === 2;
  const publishing = publishLocked || fetcher.state !== "idle";
  const canPublishGolden = !golden || (goldenReason.trim().length >= 15 && goldenReason.trim().length <= 100);

  useEffect(() => {
    if (!goldenEligible) setGolden(false);
  }, [goldenEligible]);

  const canContinue = step === 1 ? Boolean(selectedPlace)
    : step === 2 ? Boolean(evaluation)
      : step === 3 ? Boolean(selectedCategory)
        : true;

  return (
    <main id="main" className="reviewer-publish shell">
      <header className="reviewer-publish__hero">
        <div>
          <p className="eyebrow">REVIEWER / VISIT NOTE</p>
          <h1>방문 리뷰 발행</h1>
          <p>서술형 후기 없이, 직접 확인한 맛의 핵심만 짧고 정확하게 남겨요.</p>
        </div>
        <div className="reviewer-quota" aria-label="Golden Pick 이번 달 사용량">
          <span>GOLDEN PICK</span>
          <strong>이번 달 {goldenQuota.used}/{goldenQuota.limit} 사용</strong>
          <small>{goldenQuota.remaining}개 남음</small>
        </div>
      </header>

      {publishedReviewId && (
        <section className="reviewer-success" aria-live="polite">
          <span>발행 완료</span>
          <strong>이번 방문의 판단이 추천에 반영됐어요.</strong>
          <a href={`#review-${publishedReviewId}`}>발행 기록 보기</a>
        </section>
      )}
      {restored && !publishedReviewId && (
        <div className="reviewer-draft-banner" role="status">
          <span>작성 중이던 리뷰를 이어서 열었어요.</span>
          <button type="button" onClick={discardDraft}>처음부터</button>
        </div>
      )}

      <nav className="reviewer-steps" aria-label="리뷰 발행 단계">
        {["1. 장소", "2. 평가", "3. 맛 배지", "4. 사진·Golden", "5. 확인"].map((label, index) => (
          <button key={label} type="button" aria-current={step === index + 1 ? "step" : undefined} disabled={index + 1 > step} onClick={() => setStep(index + 1)}>
            {label}
          </button>
        ))}
      </nav>

      <fetcher.Form method="post" className="reviewer-workspace" encType="multipart/form-data" onSubmit={submitReview} aria-busy={publishing || preparingPhotos}>
        <input type="hidden" name="intent" value="publish-review" />
        <input type="hidden" name="placeId" value={placeId} />
        <input type="hidden" name="categoryId" value={categoryId} />
        <input type="hidden" name="categoryName" value={selectedCategory?.name ?? ""} />
        <input type="hidden" name="evaluation" value={evaluation ?? ""} />
        <input type="hidden" name="golden" value={golden ? "1" : "0"} />
        <input type="hidden" name="goldenReason" value={goldenReason} />
        {badges.map((badge) => <input key={badge} type="hidden" name="badges" value={badge} />)}

        {formError && <p className="reviewer-form-error" role="alert">{formError}</p>}

        <div className="reviewer-card-stack">
          <section className="reviewer-step-card" hidden={step !== 1} aria-labelledby="review-step-place">
            <p className="eyebrow">STEP 01 / PLACE</p>
            <h2 id="review-step-place">어디를 다녀오셨나요?</h2>
            <p>검수된 장소를 검색해 선택하세요. 선택한 장소의 대표 카테고리를 먼저 보여드려요.</p>
            <label className="reviewer-search">
              <span>장소 검색</span>
              <input value={placeQuery} onChange={(event) => setPlaceQuery(event.target.value)} placeholder="다녀온 장소 검색" />
            </label>
            <div className="reviewer-place-grid" aria-label="장소 검색 결과">
              {filteredPlaces.map((place) => (
                <button key={place.placeId} type="button" aria-pressed={placeId === place.placeId} onClick={() => choosePlace(place)}>
                  <span>{place.categoryEmoji} {place.categoryName} · {place.neighborhood}</span>
                  <strong>{place.placeName}</strong>
                  <small>{placeId === place.placeId ? "선택됨" : "이 장소 선택"}</small>
                </button>
              ))}
              {!filteredPlaces.length && <p className="reviewer-empty">일치하는 검수 장소가 없어요. 장소 제안에서 먼저 알려주세요.</p>}
            </div>
          </section>

          <section className="reviewer-step-card" hidden={step !== 2} aria-labelledby="review-step-evaluation">
            <p className="eyebrow">STEP 02 / EVALUATION</p>
            <h2 id="review-step-evaluation">이번 방문을 어떻게 판단했나요?</h2>
            <p>다른 리뷰어의 결과는 발행 전까지 보이지 않아요.</p>
            <div className="reviewer-evaluation-grid">
              {([
                ["RECOMMEND", "추천", "다른 사람에게 자신 있게 권할 수 있어요."],
                ["HOLD", "보류", "한 번 더 확인한 뒤 판단하고 싶어요."],
                ["NOT_RECOMMEND", "비추천", "이번 방문에서는 추천하기 어려웠어요."],
              ] as const).map(([value, label, description]) => (
                <button key={value} type="button" aria-label={label} aria-pressed={evaluation === value} onClick={() => setEvaluation(value)}>
                  <strong>{label}</strong><span>{description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="reviewer-step-card" hidden={step !== 3} aria-labelledby="review-step-badges">
            <p className="eyebrow">STEP 03 / TASTE BADGES</p>
            <h2 id="review-step-badges">맛의 핵심을 골라주세요.</h2>
            <p>카테고리마다 3개만 보여드리고, 그중 최대 2개를 선택할 수 있어요. 선택하지 않아도 발행할 수 있습니다.</p>
            <label className="reviewer-search reviewer-search--category">
              <span>음식 카테고리 검색</span>
              <input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="42개 음식 카테고리 검색" />
            </label>
            <div className="reviewer-category-chips" aria-label="음식 카테고리">
              {filteredCategories.map((category) => (
                <button key={category.id} type="button" aria-pressed={categoryId === category.id} onClick={() => chooseCategory(category.id)}>
                  {category.emoji} {category.name}
                </button>
              ))}
            </div>
            {selectedCategory && (
              <div className="reviewer-badge-picker">
                <div><strong>{selectedCategory.emoji} {selectedCategory.name}</strong><span>{badges.length}/2 선택</span></div>
                <div>
                  {badgeOptions.map((badge) => (
                    <button key={badge} type="button" aria-pressed={badges.includes(badge)} disabled={!badges.includes(badge) && badges.length >= 2} onClick={() => toggleBadge(badge)}>{badge}</button>
                  ))}
                </div>
                <p aria-live="polite" data-complete={!badgeError && badges.length === 2 ? true : undefined}>{badgeError || (badges.length === 2 ? "2개 선택 완료 · 선택한 배지를 해제하면 바꿀 수 있어요." : "")}</p>
              </div>
            )}
          </section>

          <section className="reviewer-step-card" hidden={step !== 4} aria-labelledby="review-step-photo">
            <p className="eyebrow">STEP 04 / PHOTO &amp; GOLDEN</p>
            <h2 id="review-step-photo">사진은 선택 사항이에요.</h2>
            <p>얼굴·차량 번호·영수증 개인정보는 올리지 마세요. 선택한 사진은 이 기기에서 JPEG로 다시 준비한 뒤, 리뷰를 발행할 때만 저장됩니다. 발행 후 모든 사용자에게 공개됩니다.</p>
            {photoUploadEnabled ? <>
              <label className="reviewer-photo-picker" aria-disabled={preparingPhotos || publishing}>
                <strong>{preparingPhotos ? "사진 준비 중" : photos.length ? "사진 교체" : "사진 선택"}</strong>
                <span>최대 5장 · 발행 전에는 이 기기에서만 미리보기</span>
                <input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={preparingPhotos || publishing} onChange={(event) => void selectPhotos(Array.from(event.currentTarget.files ?? []), event.currentTarget)} />
              </label>
              {photos.length > 0 && <ul className="reviewer-photo-list">{photos.map((photo, index) => <li key={photo.position}>
                <img src={photo.previewUrl} alt={`발행 전 사진 ${index + 1}`} />
                <span>{index + 1}</span><b>발행 시 공개</b>
                <button type="button" onClick={() => removePhoto(photo.position)} disabled={publishing}>제거</button>
              </li>)}</ul>}
            </> : <p className="reviewer-photo-unavailable">사진 발행 기능을 준비 중이에요. 사진 없이 리뷰는 발행할 수 있어요.</p>}
            <div className="reviewer-golden-disabled">
              <div><span>Golden Pick</span><strong>{goldenEligible ? "이 리뷰를 Golden Pick으로 남길 수 있어요" : "사진 1장과 맛 배지 2개를 먼저 선택해 주세요"}</strong></div>
              <p>Golden Pick은 발행된 사진 1장, 맛 배지 정확히 2개, 15–100자 이유가 모두 확인된 뒤 발행됩니다.</p>
              <button type="button" aria-pressed={golden} disabled={!goldenEligible || publishing} onClick={() => setGolden((current) => !current)}>Golden Pick 선택</button>
              {golden && <label className="reviewer-golden-reason"><span>Golden Pick 이유</span><textarea value={goldenReason} maxLength={100} minLength={15} onChange={(event) => setGoldenReason(event.target.value)} placeholder="다른 사람에게 꼭 권하고 싶은 이유를 15자 이상 남겨주세요." /></label>}
            </div>
          </section>

          <section className="reviewer-step-card reviewer-preview" hidden={step !== 5} aria-labelledby="review-step-preview">
            <p className="eyebrow">STEP 05 / PREVIEW</p>
            <h2 id="review-step-preview">발행 전 한 번만 확인해 주세요</h2>
            <dl>
              <div><dt>장소</dt><dd>{selectedPlace?.placeName ?? "선택 전"}</dd></div>
              <div><dt>평가</dt><dd>{evaluation ? evaluationLabels[evaluation] : "선택 전"}</dd></div>
              <div><dt>카테고리</dt><dd>{selectedCategory ? `${selectedCategory.emoji} ${selectedCategory.name}` : "선택 전"}</dd></div>
              <div><dt>맛 배지</dt><dd>{badges.length ? badges.join(" · ") : "선택 안 함"}</dd></div>
              <div><dt>사진</dt><dd>발행 {photos.length}장{photos.length ? " · 발행 후 공개" : ""}</dd></div>
            </dl>
            <p className="reviewer-privacy-note">발행하면 평가와 배지가 추천 신호에 반영됩니다. 다른 리뷰어의 개별 신원은 공개하지 않습니다.</p>
          </section>
        </div>

        <aside className="reviewer-live-summary" aria-label="현재 리뷰 요약">
          <p className="eyebrow">LIVE SUMMARY</p>
          <strong>{selectedPlace?.placeName ?? "장소를 먼저 골라주세요"}</strong>
          <span>{evaluation ? evaluationLabels[evaluation] : "평가 미선택"} · {selectedCategory?.name ?? "카테고리 미선택"}</span>
          <div>{badges.map((badge) => <i key={badge}>{badge}</i>)}</div>
          <small>사진은 자동 저장하지 않으며, 발행할 때만 업로드됩니다.</small>
        </aside>

        <div className="reviewer-actions">
          <button type="button" className="reviewer-secondary" disabled={step === 1} onClick={() => setStep((current) => Math.max(1, current - 1))}>이전</button>
          {step < 5 ? (
            <button type="button" className="reviewer-primary" disabled={!canContinue} onClick={() => setStep((current) => Math.min(5, current + 1))}>
              {step === 1 ? "다음: 평가" : step === 2 ? "다음: 맛 배지" : step === 3 ? "다음: 사진·Golden" : "다음: 확인"}
            </button>
          ) : (
            <button type="submit" className="reviewer-primary" disabled={!selectedPlace || !selectedCategory || !evaluation || !canPublishGolden || publishing || preparingPhotos}>{publishing ? "발행 중…" : "리뷰 발행"}</button>
          )}
        </div>
      </fetcher.Form>

      <section className="reviewer-history" aria-labelledby="reviewer-history-title">
        <div><p className="eyebrow">PUBLISHED / RECENT</p><h2 id="reviewer-history-title">최근 발행</h2></div>
        {history.length ? <div className="reviewer-history-rail">{history.map((review) => (
          <article key={review.id} id={`review-${review.id}`}>
            <span>{evaluationLabels[review.evaluation]}</span>
            <h3>{review.placeName}</h3>
            <p>{review.categoryName} · v{review.version}</p>
            <div>{parseBadges(review.badgesJson).map((badge) => <i key={badge}>{badge}</i>)}</div>
            {review.photos.length > 0 && <div className="reviewer-history-photos" aria-label={`${review.placeName} 발행 사진`}>
              {review.photos.map((photo) => <img key={photo.id} src={photo.url} alt="" loading="lazy" />)}
            </div>}
            <time dateTime={review.publishedAt}>{new Date(review.publishedAt).toLocaleDateString("ko-KR")}</time>
          </article>
        ))}</div> : <p className="reviewer-empty">아직 발행한 방문 리뷰가 없어요. 첫 기록을 남겨보세요.</p>}
      </section>
      <AppToast toast={toast} onClose={() => setToast(null)} />
    </main>
  );
}
