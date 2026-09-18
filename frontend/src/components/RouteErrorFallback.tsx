interface Props {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export default function RouteErrorFallback({ title = "Something went wrong", message, onRetry }: Props) {
  return (
    <div className="min-h-[40vh] flex flex-col items-center justify-center px-6 text-center border border-[#1f1f23] bg-[#111113] m-6">
      <p className="font-mono text-accent uppercase tracking-widest text-xs mb-2">Error</p>
      <p className="font-mono text-lg text-[#e8e8e8]">{title}</p>
      {message && <p className="font-mono text-sm text-[#6b6b6b] mt-2 max-w-md">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 px-6 py-2 border border-[#00d4aa] text-[#00d4aa] font-mono text-xs uppercase tracking-widest hover:bg-[#00d4aa] hover:text-[#0a0a0b]"
        >
          Retry
        </button>
      )}
    </div>
  );
}
