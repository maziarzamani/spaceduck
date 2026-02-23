import { Button } from "../../ui/button";
import { SpaceduckLogo } from "../spaceduck-logo";

interface StepWelcomeProps {
  onContinue: () => void;
}

export function StepWelcome({ onContinue }: StepWelcomeProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center text-center gap-4">
        <SpaceduckLogo size={56} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Spaceduck</h1>
          <p className="text-muted-foreground mt-2">
            Your personal AI assistant, on your terms.
          </p>
          <p className="text-muted-foreground mt-3 text-sm">
            Run it locally on your own hardware, connect a cloud provider, or bring your own setup.
            No lock-in. No subscriptions required.
          </p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground text-center">
        Let&apos;s get you set up in a few quick steps.
      </p>

      <div className="flex justify-center">
        <Button size="lg" onClick={onContinue}>
          Get Started
        </Button>
      </div>
    </div>
  );
}
