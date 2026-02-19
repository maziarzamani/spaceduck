import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../../ui/card";
import { Button } from "../../ui/button";
import { SpaceduckLogo } from "../spaceduck-logo";

interface StepWelcomeProps {
  onContinue: () => void;
}

export function StepWelcome({ onContinue }: StepWelcomeProps) {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <SpaceduckLogo size={56} />
        <CardTitle className="text-2xl mt-4">Welcome to Spaceduck</CardTitle>
        <CardDescription className="mt-2">
          Your private AI assistant that runs on your own hardware.
          No cloud, no subscriptions, no data sharing.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center">
        <p className="text-sm text-muted-foreground">
          Let&apos;s connect you to a Spaceduck gateway in a few quick steps.
        </p>
      </CardContent>
      <CardFooter className="justify-center">
        <Button size="lg" onClick={onContinue}>
          Get Started
        </Button>
      </CardFooter>
    </Card>
  );
}
