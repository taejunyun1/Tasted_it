import { useEffect, useState } from "react";

export function readBrowserAccountToken() {
  const hash = window.location.hash.replace(/^#/, "");
  const query = new URLSearchParams(window.location.search).get("token") ?? "";
  const token = decodeURIComponent(hash || query);
  if (query) {
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${hash ? `#${hash}` : ""}`);
  }
  return token;
}

export function TokenHashField({ name = "token" }: { name?: string }) {
  const [token, setToken] = useState("");
  useEffect(() => {
    setToken(readBrowserAccountToken());
  }, []);
  return <input type="hidden" name={name} value={token} />;
}
