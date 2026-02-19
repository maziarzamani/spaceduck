import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { SpaceduckLogo } from "./spaceduck-logo";

interface OnboardingViewProps {
  onComplete: (gatewayUrl: string, token: string | null, gatewayName: string) => void;
}

export function OnboardingView({ onComplete }: OnboardingViewProps) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <SpaceduckLogo size={48} />
          <CardTitle className="text-2xl mt-4">Welcome to Spaceduck</CardTitle>
          <CardDescription>
            Connect to a gateway to get started. The onboarding wizard is coming in Slice 3.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button
            onClick={() => {
              const url = "http://localhost:3000";
              localStorage.setItem("spaceduck.gatewayUrl", url);
              localStorage.setItem("spaceduck.gatewayName", "localhost");
              onComplete(url, null, "localhost");
            }}
          >
            Connect to localhost:3000
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Full onboarding with pairing will be available soon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
