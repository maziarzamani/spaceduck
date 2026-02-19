import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../../ui/card";
import { Button } from "../../ui/button";
import { Shield, Wifi, Lock } from "lucide-react";

interface StepSecurityProps {
  onContinue: () => void;
}

export function StepSecurity({ onContinue }: StepSecurityProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Before we connect</CardTitle>
        <CardDescription>
          A few things about how Spaceduck keeps your data safe.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={onContinue}>Continue</Button>
      </CardFooter>
    </Card>
  );
}
