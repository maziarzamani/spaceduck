import { tryParseChartSpec } from "./chart-types";
import { ChartRenderer } from "./chart-renderer";

function ChartCodeFallback({ raw, reason }: { raw: string; reason?: string }) {
  return (
    <div>
      {reason && (
        <p className="text-xs text-muted-foreground mb-1 italic">{reason}</p>
      )}
      <pre className="bg-background/50 rounded-lg p-3">
        <code className="text-primary font-mono text-sm whitespace-pre-wrap">{raw}</code>
      </pre>
    </div>
  );
}

export function ChartBlock({ raw }: { raw: string }) {
  const result = tryParseChartSpec(raw);

  if (!result.ok) {
    const reason = result.code === "unsupported_type"
      ? result.error
      : undefined;
    return <ChartCodeFallback raw={raw} reason={reason} />;
  }

  return <ChartRenderer spec={result.spec} />;
}
