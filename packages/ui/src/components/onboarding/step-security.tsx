import { Button } from "../../ui/button";
import { Shield, Wifi, Lock } from "lucide-react";

interface StepSecurityProps {
  onContinue: () => void;
}

export function StepSecurity({ onContinue }: StepSecurityProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Before we connect</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A few things about how Spaceduck keeps your data safe.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex gap-3 items-start">
          <Shield size={20} className="text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Token authentication</p>
            <p className="text-xs text-muted-foreground">
              Your device pairs with the gateway using a one-time code. Only paired devices can access your conversations.
            </p>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <Wifi size={20} className="text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Local network</p>
            <p className="text-xs text-muted-foreground">
              Currently designed for localhost or trusted LAN connections. Do not expose your gateway to the public internet without TLS.
            </p>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <Lock size={20} className="text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Your data stays yours</p>
            <p className="text-xs text-muted-foreground">
              Conversations, memories, and files are stored locally on the gateway machine. Nothing leaves your network.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={onContinue}>Continue</Button>
      </div>
    </div>
  );
}
