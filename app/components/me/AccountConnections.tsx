export function AccountConnections({ naverConnected, hasAlternativeLogin }: {
  naverConnected: boolean;
  hasAlternativeLogin: boolean;
}) {
  return <section className="member-account-card" aria-labelledby="login-connections-title">
    <header>
      <p className="eyebrow">LOGIN CONNECTIONS</p>
      <h2 id="login-connections-title">로그인 연결</h2>
    </header>
    <div className="member-connection-row">
      <div>
        <strong>네이버 로그인</strong>
        <span data-connected={naverConnected || undefined}>{naverConnected ? "연결됨" : "연결되지 않음"}</span>
      </div>
      {naverConnected
        ? hasAlternativeLogin
          ? <a className="member-connection-action" href="/auth/naver?flow=disconnect">네이버 연동 해제</a>
          : <p>다른 로그인 수단을 먼저 등록해 주세요.</p>
        : <a className="member-connection-action member-connection-action--naver" href="/auth/naver?flow=connect">네이버 연결</a>}
    </div>
  </section>;
}
