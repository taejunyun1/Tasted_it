export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
}
