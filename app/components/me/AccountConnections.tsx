export function AccountConnections({ naverConnected, googleConnected }: {
  naverConnected: boolean;
  googleConnected: boolean;
}) {
  return <aside className="member-connection-badges" aria-label="외부 서비스 연결 상태">
    <span data-provider="NAVER" data-connected={naverConnected || undefined}>
      N 네이버 {naverConnected ? "연결됨" : "미연결"}
    </span>
    <span data-provider="GOOGLE" data-connected={googleConnected || undefined}>
      G Google {googleConnected ? "연결됨" : "미연결"}
    </span>
  </aside>;
}
