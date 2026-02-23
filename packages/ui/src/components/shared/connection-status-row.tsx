import { Button } from "../../ui/button";
import { Loader2, Check, AlertCircle } from "lucide-react";
import type { ProviderTestStatus } from "../../hooks/use-provider-test";

interface ConnectionStatusRowProps {
  status: ProviderTestStatus;
  error: string | null;
  hint: string | null;
  retryable: boolean;
  onTest: () => void;
  disabled?: boolean;
}

export function ConnectionStatusRow({
  status,
  error,
  hint,
  retryable,
  onTest,
  disabled = false,
}: ConnectionStatusRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          {status === "idle" && (
            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30 shrink-0" />
          )}
          {status === "checking" && (
            <Loader2 size={14} className="animate-spin text-muted-foreground shrink-0" />
          )}
          {status === "ok" && (
            <Check size={14} className="text-green-500 shrink-0" />
          )}
          {status === "stale" && (
            <AlertCircle size={14} className="text-amber-500 shrink-0" />
          )}
          {status === "error" && (
            <span className="h-2.5 w-2.5 rounded-full bg-destructive shrink-0" />
          )}
          <span className="text-muted-foreground text-xs">
            {status === "idle" && "Not tested yet"}
            {status === "checking" && "Testing..."}
            {status === "ok" && "Connected"}
            {status === "stale" && "Settings changed. Please test again."}
            {status === "error" && (error ?? "Connection failed")}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onTest}
          disabled={disabled || status === "checking"}
        >
          {status === "checking"
            ? "Testing..."
            : status === "ok"
              ? "Re-test"
              : status === "error" && retryable
                ? "Retry"
                : "Test connection"}
        </Button>
      </div>
      {status === "error" && hint && (
        <p className="text-xs text-muted-foreground px-1">{hint}</p>
      )}
    </div>
  );
}
