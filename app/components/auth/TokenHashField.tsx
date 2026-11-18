import { useEffect, useState } from "react";

export function readBrowserAccountToken() {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(window.location.search);
  const query = params.get("token") ?? "";
  // Remove legacy query tokens even when they are malformed. New links use a
  // fragment so the token never reaches the initial HTTP request.
  if (params.has("token")) {
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${hash ? `#${hash}` : ""}`);
  }
  try {
    const token = decodeURIComponent(hash || query);
    return token.length <= 512 && !/[\u0000-\u0020\u007f]/.test(token) ? token : "";
  } catch {
    return "";
  }
}

export function TokenHashField({ name = "token" }: { name?: string }) {
  const [token, setToken] = useState("");
  useEffect(() => {
    setToken(readBrowserAccountToken());
  }, []);
  return <input type="hidden" name={name} value={token} />;
}
