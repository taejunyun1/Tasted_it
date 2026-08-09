import type { ReactNode } from "react";
import { Link } from "react-router";

export function ActivityCollection({ title, count, emptyText, emptyHref, children }: {
  title: string;
  count: number;
  emptyText: string;
  emptyHref: string;
  children: ReactNode;
}) {
  return <section className="member-activity-card">
    <header>
      <h2>{title}</h2>
      <span>{count}곳</span>
    </header>
    {count > 0 ? <div className="member-place-list">{children}</div> : <div className="member-empty">
      <p>{emptyText}</p>
      <Link to={emptyHref}>맛집 둘러보기</Link>
    </div>}
  </section>;
}
