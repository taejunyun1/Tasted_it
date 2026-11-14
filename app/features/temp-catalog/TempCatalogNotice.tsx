import type { TempPublicInfo } from "./temp-catalog";

export function TempCatalogNotice({ info }: { info: TempPublicInfo }) {
  return <section className="flavor-print" aria-label="TEMP 임시 장소 정보">
    <p className="eyebrow">TEMP / BETA</p><h2>공식 출처를 참고한 임시 정보</h2>
    <p>{info.summary}</p><p><strong>현재 영업·현장 방문 미확인</strong> · 웹 출처 확인일 {info.checkedAt.slice(0, 10)}</p>
    <p><a href={info.sourceUrl} target="_blank" rel="noopener noreferrer">{info.sourceTitle} 원문</a></p>
    <h3>외부 공식 소개·선정</h3>
    <p><a href={info.evaluation.sourceUrl} target="_blank" rel="noopener noreferrer">{info.evaluation.provider}에서 확인</a> · 회원·리뷰어의 내부 평가에 합산하지 않습니다.</p>
    {info.photo ? <p><a href={info.photoUrl ?? undefined}>TEMP 출처 사진</a>: {info.photo.attribution} · <a href={info.photo.evidenceUrl} target="_blank" rel="noopener noreferrer">개별 사진 근거</a> · <a href={info.photo.licenseUrl} target="_blank" rel="noopener noreferrer">공공누리 제1유형</a> · 촬영일 미확인</p> : info.photoSupplement ? <p><a href={info.photoUrl ?? undefined}>TEMP 출처 사진</a>: {info.photoSupplement.attribution} · <a href={info.photoSupplement.sourcePageUrl} target="_blank" rel="noopener noreferrer">NAVER 공개 출처</a> · 이용권리 미확인 · 웹 확인 {info.photoSupplement.checkedAt.slice(0, 10)} · 촬영일 미확인</p> : <p>사진은 제공하지 않습니다. 실제 모습은 공식 원문에서 확인해 주세요.</p>}
  </section>;
}
