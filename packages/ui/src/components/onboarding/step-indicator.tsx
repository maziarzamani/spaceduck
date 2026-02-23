import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export interface Step {
  id: string;
  label: string;
}

interface StepIndicatorProps {
  steps: Step[];
  currentIndex: number;
  onStepClick?: (index: number) => void;
}

export function StepIndicator({ steps, currentIndex, onStepClick }: StepIndicatorProps) {
  return (
    <nav aria-label="Progress" className="w-full">
      <ol className="flex items-center">
        {steps.map((step, i) => {
          const isCompleted = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isFuture = i > currentIndex;
          const isLast = i === steps.length - 1;
          const isClickable = isCompleted && !!onStepClick;

          return (
            <li
              key={step.id}
              className={cn("flex items-center", !isLast && "flex-1")}
            >
              <button
                type="button"
                onClick={() => isClickable && onStepClick(i)}
                disabled={!isClickable}
                className={cn(
                  "group flex flex-col items-center gap-1.5 relative",
                  isClickable && "cursor-pointer",
                  !isClickable && "cursor-default",
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-medium transition-colors",
                    isCompleted && "border-primary bg-primary text-primary-foreground",
                    isCurrent && "border-primary bg-background text-primary",
                    isFuture && "border-muted-foreground/30 bg-background text-muted-foreground/50",
                    isClickable && "group-hover:bg-primary/90 group-hover:border-primary/90",
                  )}
                >
                  {isCompleted ? <Check size={14} strokeWidth={3} /> : i + 1}
                </span>
                <span
                  className={cn(
                    "text-[11px] font-medium whitespace-nowrap transition-colors",
                    isCompleted && "text-foreground",
                    isCurrent && "text-foreground",
                    isFuture && "text-muted-foreground/50",
                    isClickable && "group-hover:text-primary",
                  )}
                >
                  {step.label}
                </span>
              </button>

              {!isLast && (
                <div
                  className={cn(
                    "h-0.5 flex-1 mx-2 mt-[-18px] transition-colors",
                    i < currentIndex ? "bg-primary" : "bg-muted-foreground/20",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
