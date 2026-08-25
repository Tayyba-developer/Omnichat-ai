export function EmptyState({
  icon = "🗂️",
  title,
  desc,
}: {
  icon?: string;
  title: string;
  desc?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-ic">{icon}</div>
      <div className="fw6 fs14">{title}</div>
      {desc && <div className="mut fs12 mt2" style={{ maxWidth: 360, textAlign: "center" }}>{desc}</div>}
    </div>
  );
}

export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div className="col gap8" style={{ padding: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skel" key={i} />
      ))}
    </div>
  );
}

export function NotConnectedNotice() {
  return (
    <div className="notice">
      Connect your Supabase project (fill in <span className="mono">.env.local</span>) and add a signed-in agent
      row to start seeing real data here.
    </div>
  );
}
