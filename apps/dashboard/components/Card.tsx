interface CardProps {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}

export function Card({ title, action, children, className = "", padded = true }: CardProps) {
  return (
    <section
      className={`rounded-lg border border-slate-800/80 bg-slate-900/60 shadow-card ${className}`}
    >
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-slate-800/60 px-4 py-3">
          {title && (
            <h2 className="text-[13px] font-semibold tracking-tight text-slate-200">
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function KeyValueRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[12px] text-slate-500">{label}</dt>
      <dd className="text-right text-[13px] text-slate-200">{children}</dd>
    </div>
  );
}
