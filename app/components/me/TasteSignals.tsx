import { Link } from "react-router";

import type { DisplayTasteBadge } from "../../features/members/profile-taste-badges";

export function TasteSignals({ profile, placeCount }: {
  profile: { headline: string; badges: DisplayTasteBadge[] };
  placeCount: number;
}) {
  return <div className="member-profile__taste">
    <p className="eyebrow">MY TASTE / PROFILE</p>
    <h1>{profile.headline}</h1>
    {profile.badges.length > 0 ? <ul className="member-taste-badges" aria-label="대표 취향">
      {profile.badges.map((badge, index) => <li
        data-category={badge.category}
        data-primary={index === 0 || undefined}
        key={badge.id}
      >{badge.label}</li>)}
    </ul> : <div className="member-learning member-learning--compact">
      <span className="member-learning-badge">취향 학습 중 {placeCount}/5</span>
      <progress aria-label="취향 학습 진행도" max={5} value={Math.min(placeCount, 5)}>{placeCount}/5</progress>
      <p>좋아하는 장소를 저장하고 평가하면 음식·맛·식당 스타일 배지가 생겨요.</p>
      <Link to="/places">맛집 둘러보기</Link>
    </div>}
  </div>;
}
