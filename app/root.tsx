import { Form, isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation } from "react-router";
import type { Route } from "./+types/root";
import { getOptionalUser } from "./features/auth/session.server";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Noto+Sans+KR:wght@400;500;600&display=swap" },
];
export async function loader({ request }: Route.LoaderArgs) { return { user: await getOptionalUser(request) }; }
export function Layout({ children }: { children: React.ReactNode }) { return <html lang="ko"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><Meta/><Links/></head><body><a className="skip-link" href="#main">본문으로 건너뛰기</a>{children}<ScrollRestoration/><Scripts/></body></html>; }
export default function App({ loaderData }: Route.ComponentProps) {
  const user = loaderData.user;
  const location = useLocation();
  return <>
    <header className="site-head">
      <Link className="brand" to="/">Re:Taste<span>광주·전남 맛 지도</span></Link>
      <nav className="site-head__nav" aria-label="주요 메뉴">
        <div className="site-head__primary">
          <Link to="/places">맛집 리스트</Link>
          <Link to="/me">내 상태</Link>
        </div>
        <details className="site-menu" key={location.pathname}>
          <summary role="button" aria-label="메뉴"><span aria-hidden="true">☰</span></summary>
          <div className="site-menu__panel">
            {user ? <>
              <span className="session-status" aria-label={`로그인됨 · ${user.displayName}`}><i aria-hidden="true" />로그인됨 · {user.displayName}</span>
              <Link to="/suggestions/new">장소 제안</Link>
              {user.role === "REVIEWER" && <Link to="/reviewer/ratings">리뷰어 평가</Link>}
              {user.role === "ADMIN" && <Link to="/admin/place-operations">어드민</Link>}
              <Form method="post" action="/logout"><button type="submit">로그아웃</button></Form>
            </> : <>
              <Link to="/login">로그인</Link>
              <Link to="/signup">회원가입</Link>
            </>}
          </div>
        </details>
      </nav>
    </header>
    <Outlet/>
    <footer className="site-footer"><strong>Re:Taste</strong><span>추천할 만한 한 끼를 기록합니다.</span><nav aria-label="서비스 안내"><Link to="/corrections/new">정보 정정</Link><Link to="/privacy">개인정보 처리방침</Link><Link to="/terms">이용약관</Link></nav></footer>
  </>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { const notFound = isRouteErrorResponse(error) && error.status === 404; return <main id="main" className="error-page"><p className="eyebrow">{notFound ? "404 / NOT FOUND" : "ERROR"}</p><h1>{notFound ? "이 페이지는 지도 밖에 있어요." : "잠시 길을 잃었습니다."}</h1><p>{isRouteErrorResponse(error) ? error.statusText : "예상하지 못한 오류가 발생했습니다."}</p><Link to="/">처음으로 돌아가기</Link></main>; }
