import { Button } from "../../ui/button";
import { Monitor, Cloud, Settings2 } from "lucide-react";

interface StepSetupChoiceProps {
  onSelect: (mode: "local" | "cloud" | "advanced") => void;
  onSkip: () => void;
}

const DOORS = [
  {
    mode: "local" as const,
    icon: Monitor,
    title: "Local",
    description: "Private. Runs on your computer.",
    detail: "Use llama.cpp, LM Studio, or another local server.",
  },
  {
    mode: "cloud" as const,
    icon: Cloud,
    title: "Cloud",
    description: "Best quality. Uses an API key.",
    detail: "Google Gemini, OpenRouter, or Amazon Bedrock.",
  },
  {
    mode: "advanced" as const,
    icon: Settings2,
    title: "Advanced",
    description: "Full control over models, memory, and providers.",
    detail: "Configure chat, embeddings, and everything else.",
  },
];

export function StepSetupChoice({ onSelect, onSkip }: StepSetupChoiceProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Set up Spaceduck</h1>
        <p className="text-muted-foreground mt-2">
          How would you like your AI to run?
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {DOORS.map((door) => {
          const Icon = door.icon;
          return (
            <Button
              key={door.mode}
              variant="outline"
              onClick={() => onSelect(door.mode)}
              className="flex items-start gap-4 h-auto rounded-lg p-5 text-left justify-start hover:bg-accent hover:border-accent-foreground/20"
            >
              <div className="mt-0.5 rounded-md bg-primary/10 p-2.5">
                <Icon size={22} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-base">{door.title}</div>
                <div className="text-sm text-muted-foreground font-normal">{door.description}</div>
                <div className="text-xs text-muted-foreground/70 font-normal mt-1">{door.detail}</div>
              </div>
            </Button>
          );
        })}
      </div>

      <div className="text-center">
        <Button variant="link" size="sm" className="text-muted-foreground" onClick={onSkip}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}
