type FenceEnv = { CST_MAINTENANCE?: string };
type AppHandlers<E> = Required<Pick<ExportedHandler<E>, "fetch" | "scheduled">>;

// Missing is compatible with local fixtures; an unexpected configured value closes access.
export function isDeploymentFenced(value: unknown) {
  return value !== undefined && value !== "false";
}

export function withDeploymentFence<E extends FenceEnv>(handlers: AppHandlers<E>): ExportedHandler<E> {
  return {
    async fetch(request, env, ctx) {
      if (isDeploymentFenced(env.CST_MAINTENANCE)) {
        return new Response(request.method === "HEAD" ? null : "서비스 점검 중입니다. 잠시 후 다시 이용해 주세요.", {
          status: 503,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "Retry-After": "60",
            "X-Robots-Tag": "noindex, nofollow",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      return handlers.fetch(request, env, ctx);
    },
    async scheduled(controller, env, ctx) {
      if (isDeploymentFenced(env.CST_MAINTENANCE)) return;
      return handlers.scheduled(controller, env, ctx);
    },
  };
}
