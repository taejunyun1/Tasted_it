export type AppToastValue = {
  kind: "success" | "error" | "info";
  message: string;
};

export function AppToast({ toast, onClose }: { toast: AppToastValue | null; onClose(): void }) {
  if (!toast) return null;
  return (
    <div className={`app-toast app-toast--${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"} aria-live={toast.kind === "error" ? "assertive" : "polite"}>
      <span>{toast.message}</span>
      <button type="button" aria-label="알림 닫기" onClick={onClose}>×</button>
    </div>
  );
}
