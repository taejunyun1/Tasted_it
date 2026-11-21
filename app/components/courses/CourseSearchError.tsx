import { Form, Link } from "react-router";
import { courseTimeLabels } from "../../features/courses/course-context-v2";
import { parseCourseOptions, toCourseSearchParams } from "../../features/courses/course-options";

export function CourseSearchError({ search }: { search: string }) {
  const { options, context, hasSelection } = parseCourseOptions(search);
  const params = hasSelection ? toCourseSearchParams(options) : new URLSearchParams();
  if (context.locationSource === "USER") {
    params.set("lat", String(context.latitude));
    params.set("lng", String(context.longitude));
  }
  const time = options.time === "auto" ? "자동" : courseTimeLabels[options.time];

  return <main id="main" className="course-page">
    <section className="course-empty">
      <h1>코스를 불러오지 못했어요</h1>
      <p role="alert">선택 조건은 남겨 두었습니다. 연결을 확인한 뒤 다시 검색해 주세요.</p>
      <p>{hasSelection ? `${time} · ${options.second === "cafe" ? "카페" : "디저트"} · 반경 ${options.radiusKm}km` : "조건을 선택하기 전 화면으로 돌아갑니다."}</p>
      <Form method="get" action="/courses" reloadDocument>
        {[...params].map(([name, value], index) => <input key={`${name}-${index}`} type="hidden" name={name} value={value} />)}
        <button className="course-apply" type="submit">다시 검색</button>
      </Form>
      <Link className="inline-flex min-h-11 items-center underline" to="/courses">조건을 새로 선택</Link>
    </section>
  </main>;
}
