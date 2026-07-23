interface EmptyStateProps {
  title: string;
  message?: string;
  compact?: boolean;
}

export function EmptyState({ title, message, compact = false }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? "py-8" : "py-16"
      }`}
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-800/60 ring-1 ring-inset ring-slate-700/60">
        <svg
          className="h-5 w-5 text-slate-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </div>
      <div className="text-sm font-medium text-slate-300">{title}</div>
      {message && (
        <div className="mt-1 max-w-sm text-[13px] text-slate-500">{message}</div>
      )}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 ring-1 ring-inset ring-red-500/30">
        <svg
          className="h-5 w-5 text-red-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      </div>
      <div className="text-sm font-medium text-slate-300">Something went wrong</div>
      <div className="mt-1 max-w-sm text-[13px] text-slate-500">{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-[13px] font-medium text-slate-200 transition-colors hover:bg-slate-800"
        >
          Retry
        </button>
      )}
    </div>
  );
}
