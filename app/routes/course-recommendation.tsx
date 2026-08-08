import { env } from "cloudflare:workers";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Form, Link } from "react-router";
import type { Route } from "./+types/course-recommendation";
import { createDb } from "../db/client.server";
import { toggleMealCategorySelection } from "../features/courses/course-filter-selection";
import { parseCourseOptions } from "../features/courses/course-options";
import { recommendCourses } from "../features/courses/course-recommendation.server";
import { listPublicCategoryGroups } from "../features/places/place.server";

export function meta() {
  return [{ title: "오늘의 두 곳 코스 — Re:Taste" }, { name: "description", content: "한 끼와 카페·디저트, 주차까지 이동거리 중심으로 고른 코스" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const parsed = parseCourseOptions(url.search, new Date());
  const db = createDb(env.DB);
  if (!parsed.hasSelection) {
    const groups = await listPublicCategoryGroups(db);
    return { ...parsed, categories: groups.filter((group) => group.slug !== "cafe-dessert").flatMap((group) => group.children), courses: [] };
  }
  const result = await recommendCourses(db, { options: parsed.options, context: parsed.context, now: new Date() });
  return { ...parsed, categories: result.categories, courses: result.courses };
}

const timeLabels = { auto: "자동", lunch: "점심", afternoon: "오후", dinner: "저녁", late: "늦은 시간" } as const;
const secondOptions = [{ value: "cafe", label: "☕ 카페" }, { value: "dessert", label: "🍰 디저트·베이커리" }];
const radiusOptions = [1, 3, 5, 8].map((value) => ({ value: String(value), label: `${value}km` }));
const parkingOptions = [{ value: "auto", label: "상황에 맞게" }, { value: "shared", label: "한 곳 주차" }, { value: "separate", label: "장소별 주차" }];
const evOptions = [{ value: "none", label: "상관없음" }, { value: "preferred", label: "있으면 우선" }, { value: "required", label: "설치 확인 필수" }];
const distance = (meters: number) => meters < 1_000 ? `${Math.round(meters / 10) * 10}m` : `${(meters / 1_000).toFixed(1)}km`;
const fee = (value: number | null) => value == null ? "요금 확인 필요" : value === 0 ? "무료" : `약 ${value.toLocaleString("ko-KR")}원`;

function ChoiceGroup({ legend, name, value, options }: { legend: string; name: string; value: string; options: Array<{ value: string; label: string }> }) {
  return <fieldset className="course-filter-group"><legend>{legend}</legend><div className="course-chip-grid">
    {options.map((option) => <label key={option.value}><input className="course-choice-input" type="radio" name={name} value={option.value} defaultChecked={value === option.value} /><span className="course-choice-chip">{option.label}</span></label>)}
  </div></fieldset>;
}

function Conditions({ data, onClose }: { data: Route.ComponentProps["loaderData"]; onClose: () => void }) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(data.context.locationSource === "USER" ? { lat: data.context.latitude, lng: data.context.longitude } : null);
  const [mealCategories, setMealCategories] = useState(data.options.mealCategories);
  const [mealLimitReached, setMealLimitReached] = useState(false);
  const locate = () => navigator.geolocation?.getCurrentPosition(({ coords: next }) => setCoords({ lat: next.latitude, lng: next.longitude }), () => undefined, { enableHighAccuracy: true, timeout: 8_000 });
  const toggleMeal = (slug: string) => {
    const next = toggleMealCategorySelection(mealCategories, slug);
    setMealCategories(next.values);
    setMealLimitReached(next.limitReached);
  };
  return <Form method="get" className="course-filter-form" onSubmit={onClose}>
    <input type="hidden" name="apply" value="1" />
    {coords && <><input type="hidden" name="lat" value={coords.lat} /><input type="hidden" name="lng" value={coords.lng} /></>}
    <div className="course-filter-title"><div><span>COURSE SETUP</span><h2>선택 조건</h2></div><button className="course-filter-close" type="button" onClick={onClose} aria-label="조건 닫기">×</button></div>
    <button type="button" className="course-location" onClick={locate}><span aria-hidden="true">◎</span>{coords ? "현재 위치 반영됨" : "내 위치 사용"}</button>
    <ChoiceGroup legend="시간대" name="time" value={data.options.time} options={Object.entries(timeLabels).map(([value, label]) => ({ value, label }))} />
    <fieldset className="course-filter-group course-meal-group"><legend>한 끼 메뉴 <small>최대 2개</small></legend><p>먹고 싶은 메뉴를 골라주세요. 선택하지 않으면 전체를 봅니다.</p><div className="course-chip-grid course-meal-grid">
      <button type="button" className="course-choice-chip course-all-meals" aria-pressed={!mealCategories.length} data-selected={!mealCategories.length || undefined} onClick={() => { setMealCategories([]); setMealLimitReached(false); }}>전체 한 끼</button>
      {data.categories.map((category) => <label key={category.id}><input className="course-choice-input" type="checkbox" name="mealCategory" value={category.slug} checked={mealCategories.includes(category.slug)} onChange={() => toggleMeal(category.slug)} /><span className="course-choice-chip course-meal-chip"><b>{category.emoji} {category.name}</b><small>{category.count}곳</small></span></label>)}
    </div><p className="course-meal-count" data-limit={mealLimitReached || undefined} aria-live="polite">{mealLimitReached ? "최대 2개까지 선택할 수 있어요" : `${mealCategories.length}/2 선택`}</p></fieldset>
    <ChoiceGroup legend="두 번째 장소" name="second" value={data.options.second} options={secondOptions} />
    <ChoiceGroup legend="검색 반경" name="radiusKm" value={String(data.options.radiusKm)} options={radiusOptions} />
    <ChoiceGroup legend="주차 방식" name="parkingMode" value={data.options.parkingMode} options={parkingOptions} />
    <ChoiceGroup legend="전기차 충전" name="ev" value={data.options.ev} options={evOptions} />
    <fieldset className="course-filter-group"><legend>이동 조건</legend><div className="course-chip-grid"><label><input className="course-choice-input" type="radio" name="weather" value="normal" defaultChecked={data.options.weather === "normal"} /><span className="course-choice-chip">보통</span></label><label><input className="course-choice-input" type="radio" name="weather" value="rain" defaultChecked={data.options.weather === "rain"} /><span className="course-choice-chip">☔ 비 오는 날</span></label><label><input className="course-choice-input" type="checkbox" name="child" value="1" defaultChecked={data.options.child} /><span className="course-choice-chip">👶 아이 동반</span></label></div></fieldset>
    <button className="course-apply" type="submit">이 조건으로 코스 만들기</button>
  </Form>;
}

function PlaceStop({ index, place, role, score }: { index: number; place: Route.ComponentProps["loaderData"]["courses"][number]["first"]; role: string; score?: number }) {
  const count = place.positive + place.negative;
  return <article className="course-stop">
    <span className="course-stop-index">{String(index).padStart(2, "0")}</span>
    <div className="course-stop-main"><p>{place.primaryCategory.emoji} {place.primaryCategory.name} · {place.neighborhood}</p><h3><Link to={`/places/${place.slug}`}>{place.name}</Link></h3><small>{role} · 영업시간 확인 필요</small></div>
    {score != null && <strong className="course-stop-score">{score}점</strong>}
    <div className="course-stop-tags"><span>{count >= 8 ? `추천 평가 ${count}명` : `평가 ${count}/8`}</span><span>검수 공개 장소</span></div>
  </article>;
}

function ParkingResult({ parking }: { parking: Route.ComponentProps["loaderData"]["courses"][number]["parking"] }) {
  if (parking.status === "PARKING_DATA_UNAVAILABLE") return <div className="course-parking-empty"><strong>주차 정보 준비 중</strong><p>음식 코스는 먼저 볼 수 있어요. 공공 주차장 스냅샷이 준비되면 자동으로 비교합니다.</p></div>;
  if (parking.status === "NO_ELIGIBLE_PARKING") return <div className="course-parking-empty"><strong>조건에 맞는 주차장 없음</strong><p>검색 반경이나 전기차 조건을 바꿔보세요.</p></div>;
  return <div className="course-parking-options">
    {parking.shared && <article data-recommended={parking.recommendedMode === "SHARED" || parking.recommendedMode === "BOTH_SIMILAR" || undefined}><header><span>한 곳 주차</span>{(parking.recommendedMode === "SHARED" || parking.recommendedMode === "BOTH_SIMILAR") && <b>추천</b>}</header><h4>{parking.shared.parking.name}</h4><dl><div><dt>예상 도보거리</dt><dd>{distance(parking.shared.totalWalkingMeters)}</dd></div><div><dt>예상 요금</dt><dd>{fee(parking.shared.totalFee)}</dd></div><div><dt>주차면</dt><dd>{parking.shared.parking.capacity == null ? "확인 필요" : `${parking.shared.parking.capacity}면`}</dd></div><div><dt>전기차</dt><dd>{parking.shared.parking.hasOnsiteEv ? "설치 확인" : "정보 없음"}</dd></div></dl></article>}
    {parking.separate && <article data-recommended={parking.recommendedMode === "SEPARATE" || parking.recommendedMode === "BOTH_SIMILAR" || undefined}><header><span>장소별 주차</span>{(parking.recommendedMode === "SEPARATE" || parking.recommendedMode === "BOTH_SIMILAR") && <b>추천</b>}</header><h4>{parking.separate.first.name}<br /><small>+ {parking.separate.second.name}</small></h4><dl><div><dt>예상 도보거리</dt><dd>{distance(parking.separate.totalWalkingMeters)}</dd></div><div><dt>예상 요금</dt><dd>{fee(parking.separate.totalFee)}</dd></div><div><dt>추가 처리</dt><dd>약 7분</dd></div><div><dt>방식</dt><dd>두 번 주차</dd></div></dl></article>}
  </div>;
}

function CourseCard({ course, index }: { course: Route.ComponentProps["loaderData"]["courses"][number]; index: number }) {
  return <section className="course-result-card">
    <header className="course-result-head"><div><span>COURSE {String(index + 1).padStart(2, "0")}</span><h2>두 곳을 이렇게 이어요</h2></div><strong>{course.score}<small>/100</small></strong></header>
    <div className="course-value-badges">{course.badges.map((badge, badgeIndex) => <span key={badge} data-primary={badgeIndex === 0 || undefined}>{badge}</span>)}</div>
    <div className="course-route-ribbon">
      <PlaceStop index={1} place={course.first} role="한 끼" score={course.score} />
      <div className="course-leg"><i /><span>예상 이동 {distance(course.betweenPlacesMeters)}</span><i /></div>
      <PlaceStop index={2} place={course.second} role="카페·디저트" />
    </div>
    <section className="course-parking"><header><div><span>PARKING / COMPARE</span><h3>어디에 주차할까요?</h3></div><small>거리 우선 · 공공데이터 기준</small></header><ParkingResult parking={course.parking} />{course.parking.snapshot?.referenceDate && <p className="course-data-date">주차장 데이터 기준일 {course.parking.snapshot.referenceDate}</p>}</section>
  </section>;
}

export default function CourseRecommendation({ loaderData }: Route.ComponentProps) {
  const [filtersOpen, setFiltersOpen] = useState(!loaderData.hasSelection);
  const filterSheetRef = useRef<HTMLElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const previousFiltersOpen = useRef(filtersOpen);
  const [isCompact, setIsCompact] = useState(false);
  const conditionsKey = JSON.stringify({ options: loaderData.options, latitude: loaderData.context.latitude, longitude: loaderData.context.longitude, locationSource: loaderData.context.locationSource });
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setIsCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!loaderData.hasSelection) setFiltersOpen(true);
  }, [loaderData.hasSelection]);
  useEffect(() => {
    const changed = previousFiltersOpen.current !== filtersOpen;
    if (filtersOpen && (changed || (!loaderData.hasSelection && isCompact))) filterSheetRef.current?.focus();
    else if (!filtersOpen && changed) filterTriggerRef.current?.focus();
    previousFiltersOpen.current = filtersOpen;
  }, [filtersOpen, isCompact, loaderData.hasSelection]);
  const handleSheetKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isCompact || !filtersOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setFiltersOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(filterSheetRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled])') ?? [])]
      .filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const mealSummary = loaderData.options.mealCategories.length
    ? loaderData.options.mealCategories.map((slug) => loaderData.categories.find((item) => item.slug === slug)?.name ?? "한 끼").join("·")
    : "모든 한 끼";
  const summary = `${timeLabels[loaderData.options.time]} · ${mealSummary} · ${loaderData.options.second === "cafe" ? "카페" : "디저트"} · ${loaderData.options.radiusKm}km`;
  return <main id="main" className="course-page">
    <header className="course-hero"><div><p>COURSE / FOR YOU</p><h1>오늘의 두 곳,<br />주차까지 이어봤어요.</h1><span>한 끼부터 다음 장소까지. 거리와 이동 부담을 먼저 계산합니다.</span></div><div className="course-context"><small>AUTO CONTEXT</small><strong>{loaderData.context.resolvedTime === "afternoon" ? "오후" : timeLabels[loaderData.context.resolvedTime]} · {loaderData.context.locationSource === "USER" ? "현재 위치" : "광주시청 기준"} · 반경 {loaderData.options.radiusKm}km</strong></div></header>
    <button ref={filterTriggerRef} aria-controls="course-filter-sheet" aria-expanded={isCompact ? filtersOpen : undefined} className="course-filter-trigger" type="button" onClick={() => setFiltersOpen(true)}><span>선택 조건</span><strong>{summary}</strong><b>조건 변경</b></button>
    <div className="course-layout">
      <div className="course-filter-backdrop" data-open={filtersOpen || undefined} onClick={() => setFiltersOpen(false)} />
      <aside ref={filterSheetRef} id="course-filter-sheet" tabIndex={-1} role={isCompact ? "dialog" : undefined} aria-modal={isCompact ? true : undefined} aria-hidden={isCompact && !filtersOpen ? true : undefined} onKeyDown={handleSheetKeyDown} className="course-filter-sheet" data-open={filtersOpen || undefined} data-initial-open={!loaderData.hasSelection || undefined} aria-label="코스 선택 조건"><span className="course-sheet-handle" aria-hidden="true" /><Conditions key={conditionsKey} data={loaderData} onClose={() => setFiltersOpen(false)} /></aside>
      <div className="course-results">
        {!loaderData.hasSelection && <section className="course-empty"><span>START HERE</span><h2>먼저 오늘의 조건을 골라주세요.</h2><p>위치, 한 끼, 다음 장소와 주차 조건을 고르면 이동 부담이 적은 순서로 코스를 만듭니다.</p><button type="button" onClick={() => setFiltersOpen(true)}>조건 고르기</button></section>}
        {loaderData.hasSelection && !loaderData.courses.length && <section className="course-empty"><span>NO COURSE</span><h2>이 조건에서는 두 곳을 잇기 어려워요.</h2><p>검색 반경을 넓히거나 한 끼 카테고리를 전체로 바꿔보세요.</p><button type="button" onClick={() => setFiltersOpen(true)}>조건 다시 고르기</button></section>}
        {loaderData.courses.map((course, index) => <CourseCard course={course} index={index} key={`${course.first.id}-${course.second.id}`} />)}
      </div>
    </div>
  </main>;
}
