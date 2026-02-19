import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../../ui/card";
import { Button } from "../../ui/button";
import { CheckCircle2, ShieldOff } from "lucide-react";

interface StepDoneProps {
  gatewayName: string;
  authDisabled: boolean;
  onStart: () => void;
}

export function StepDone({ gatewayName, authDisabled, onStart }: StepDoneProps) {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        {authDisabled ? (
          <ShieldOff size={48} className="text-yellow-500" />
        ) : (
          <CheckCircle2 size={48} className="text-green-500" />
        )}
        <CardTitle className="mt-4">
          {authDisabled ? "Connected (no auth)" : "You're all set!"}
        </CardTitle>
        <CardDescription>
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
        </CardDescription>
      </CardHeader>
      <CardContent>
        {authDisabled && (
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 text-sm text-yellow-200">
            For production use, enable authentication by setting{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">SPACEDUCK_REQUIRE_AUTH=1</code>{" "}
            on the gateway.
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-center">
        <Button size="lg" onClick={onStart}>
          Start Chatting
        </Button>
      </CardFooter>
    </Card>
  );
}
