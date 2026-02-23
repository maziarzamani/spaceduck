import { Button } from "../../ui/button";
import { CheckCircle2, ShieldOff } from "lucide-react";

interface StepDoneProps {
  gatewayName: string;
  authDisabled: boolean;
  onStart: () => void;
}

export function StepDone({ gatewayName, authDisabled, onStart }: StepDoneProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center text-center gap-3">
        {authDisabled ? (
          <ShieldOff size={48} className="text-yellow-500" />
        ) : (
          <CheckCircle2 size={48} className="text-green-500" />
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {authDisabled ? "Connected (no auth)" : "You're all set!"}
          </h1>
          <p className="text-muted-foreground mt-2">
            {authDisabled ? (
              <>
                Connected to <strong>{gatewayName}</strong>. This gateway does not require
                pairing (auth disabled). Anyone on the same network can access it.
              </>
            ) : (
              <>
                Successfully paired with <strong>{gatewayName}</strong>.
                Your device is now authorized to use this gateway.
              </>
            )}
          </p>
        </div>
      </div>

      {authDisabled && (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 text-sm text-yellow-600 dark:text-yellow-200">
          For production use, enable authentication by setting{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">SPACEDUCK_REQUIRE_AUTH=1</code>{" "}
          on the gateway.
        </div>
      )}

      <div className="flex justify-center">
        <Button size="lg" onClick={onStart}>
          Start Chatting
        </Button>
      </div>
    </div>
  );
}
