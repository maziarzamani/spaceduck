import { useState } from "react";
import { StepWelcome } from "./step-welcome";
import { StepSecurity } from "./step-security";
import { StepFindGateway } from "./step-find-gateway";
import { StepPairing } from "./step-pairing";
import { StepDone } from "./step-done";

export type WizardStep = "welcome" | "security" | "find-gateway" | "pairing" | "done";

interface OnboardingWizardProps {
  onComplete: (gatewayUrl: string, token: string | null, gatewayName: string) => void;
}

interface GatewayConnection {
  url: string;
  gatewayId: string;
  gatewayName: string;
  requiresAuth: boolean;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>("welcome");
  const [gateway, setGateway] = useState<GatewayConnection | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const handleGatewayFound = (conn: GatewayConnection) => {
    setGateway(conn);
    if (conn.requiresAuth) {
      setStep("pairing");
    } else {
      setStep("done");
    }
  };

  const handlePaired = (rawToken: string) => {
    setToken(rawToken);
    setStep("done");
  };

  const handleFinish = () => {
    if (!gateway) return;
    localStorage.setItem("spaceduck.gatewayUrl", gateway.url);
    localStorage.setItem("spaceduck.gatewayName", gateway.gatewayName);
    if (token) {
      localStorage.setItem("spaceduck.token", token);
    }
    onComplete(gateway.url, token, gateway.gatewayName);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-md">
        {step === "welcome" && (
          <StepWelcome onContinue={() => setStep("security")} />
        )}
        {step === "security" && (
          <StepSecurity onContinue={() => setStep("find-gateway")} />
        )}
        {step === "find-gateway" && (
          <StepFindGateway onGatewayFound={handleGatewayFound} />
        )}
        {step === "pairing" && gateway && (
          <StepPairing
            gatewayUrl={gateway.url}
            gatewayName={gateway.gatewayName}
            onPaired={handlePaired}
            onBack={() => setStep("find-gateway")}
          />
        )}
        {step === "done" && gateway && (
          <StepDone
            gatewayName={gateway.gatewayName}
            authDisabled={!gateway.requiresAuth}
            onStart={handleFinish}
          />
        )}
      </div>
    </div>
  );
}
