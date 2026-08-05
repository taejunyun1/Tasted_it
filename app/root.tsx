import { isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import "maplibre-gl/dist/maplibre-gl.css";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Noto+Sans+KR:wght@400;600;700;900&display=swap" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><Meta /><Links /></head><body><a className="skip-link" href="#main">본문으로 건너뛰기</a><header className="site-head"><Link className="brand" to="/">Re:Taste<span>광주·전남 맛 지도</span></Link><nav><Link to="/maps/ramen">맛 지도</Link><Link to="/login">로그인</Link></nav></header>{children}<footer className="site-footer"><strong>Re:Taste</strong><span>추천할 만한 한 끼를 기록합니다.</span><nav aria-label="법적 고지"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a><Link to="/privacy">개인정보 처리방침</Link><Link to="/terms">이용약관</Link></nav></footer><ScrollRestoration /><Scripts /></body></html>;
}
export default function App() { return <Outlet />; }
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return <main id="main" className="error-page"><p className="eyebrow">{notFound ? "404 / NOT FOUND" : "ERROR"}</p><h1>{notFound ? "이 페이지는 지도 밖에 있어요." : "잠시 길을 잃었습니다."}</h1><p>{isRouteErrorResponse(error) ? error.statusText : "예상하지 못한 오류가 발생했습니다."}</p><Link to="/">처음으로 돌아가기</Link></main>;
}
