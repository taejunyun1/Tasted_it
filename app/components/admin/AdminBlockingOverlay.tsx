export function AdminBlockingOverlay({ active, label }: { active: boolean; label: string }) {
  if (!active) return null;
  return <div className="admin-blocking-overlay" role="dialog" aria-modal="true" aria-label={label}>
    <div><span className="admin-blocking-spinner" aria-hidden="true" /><strong>{label}</strong><p>처리가 끝날 때까지 다른 작업을 할 수 없습니다.</p></div>
  </div>;
}
