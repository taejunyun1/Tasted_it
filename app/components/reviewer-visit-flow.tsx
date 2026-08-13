import { useEffect, useMemo, useState } from "react";

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

export function ReviewerVisitFlow({ places, categories, history, goldenQuota, publishedReviewId }: Props) {
  const [step, setStep] = useState(1);
  const [placeId, setPlaceId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [evaluation, setEvaluation] = useState<ReviewerEvaluation | null>(null);
  const [badges, setBadges] = useState<string[]>([]);
  const [placeQuery, setPlaceQuery] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [badgeError, setBadgeError] = useState("");
  const [photoNames, setPhotoNames] = useState<string[]>([]);
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
    setPhotoNames([]);
    setRestored(false);
  }

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

      <form method="post" className="reviewer-workspace">
        <input type="hidden" name="intent" value="publish-review" />
        <input type="hidden" name="placeId" value={placeId} />
        <input type="hidden" name="categoryId" value={categoryId} />
        <input type="hidden" name="categoryName" value={selectedCategory?.name ?? ""} />
        <input type="hidden" name="evaluation" value={evaluation ?? ""} />
        <input type="hidden" name="golden" value="0" />
        <input type="hidden" name="goldenReason" value="" />
        {badges.map((badge) => <input key={badge} type="hidden" name="badges" value={badge} />)}

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
            <p>얼굴·차량 번호·영수증 개인정보는 올리지 마세요. 현재 사진은 이 기기의 미리보기로만 보이며 발행 데이터에는 포함되지 않습니다.</p>
            <label className="reviewer-photo-picker">
              <strong>사진 미리보기 추가</strong>
              <span>최대 5장 · 업로드 저장소 승인 전 로컬 확인용</span>
              <input type="file" accept="image/*" multiple onChange={(event) => setPhotoNames(Array.from(event.target.files ?? []).slice(0, 5).map((file) => file.name))} />
            </label>
            {photoNames.length > 0 && <ul className="reviewer-photo-list">{photoNames.map((name, index) => <li key={`${name}-${index}`}><span>{index + 1}</span>{name}<b>기기 미리보기</b></li>)}</ul>}
            <div className="reviewer-golden-disabled">
              <div><span>Golden Pick</span><strong>사진 저장 기능 준비 중</strong></div>
              <p>Golden Pick은 발행된 사진 1장, 맛 배지 정확히 2개, 15–100자 이유가 모두 확인된 뒤 활성화됩니다.</p>
              <button type="button" disabled aria-describedby="golden-hold-note">Golden Pick 선택</button>
              <small id="golden-hold-note">새 Cloudflare 사진 저장소는 운영 승인 후 연결합니다.</small>
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
              <div><dt>사진</dt><dd>발행 0장 · 로컬 미리보기 {photoNames.length}장</dd></div>
            </dl>
            <p className="reviewer-privacy-note">발행하면 평가와 배지가 추천 신호에 반영됩니다. 다른 리뷰어의 개별 신원은 공개하지 않습니다.</p>
          </section>
        </div>

        <aside className="reviewer-live-summary" aria-label="현재 리뷰 요약">
          <p className="eyebrow">LIVE SUMMARY</p>
          <strong>{selectedPlace?.placeName ?? "장소를 먼저 골라주세요"}</strong>
          <span>{evaluation ? evaluationLabels[evaluation] : "평가 미선택"} · {selectedCategory?.name ?? "카테고리 미선택"}</span>
          <div>{badges.map((badge) => <i key={badge}>{badge}</i>)}</div>
          <small>작성 내용은 이 기기에 자동 저장됩니다.</small>
        </aside>

        <div className="reviewer-actions">
          <button type="button" className="reviewer-secondary" disabled={step === 1} onClick={() => setStep((current) => Math.max(1, current - 1))}>이전</button>
          {step < 5 ? (
            <button type="button" className="reviewer-primary" disabled={!canContinue} onClick={() => setStep((current) => Math.min(5, current + 1))}>
              {step === 1 ? "다음: 평가" : step === 2 ? "다음: 맛 배지" : step === 3 ? "다음: 사진·Golden" : "다음: 확인"}
            </button>
          ) : (
            <button type="submit" className="reviewer-primary" disabled={!selectedPlace || !selectedCategory || !evaluation}>리뷰 발행</button>
          )}
        </div>
      </form>

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
    </main>
  );
}
