import { useState, useCallback, useMemo } from "react";
import { StepWelcome } from "./step-welcome";
import { StepSecurity } from "./step-security";
import { StepFindGateway } from "./step-find-gateway";
import { StepPairing } from "./step-pairing";
import { StepDone } from "./step-done";
import { StepSetupChoice } from "./step-setup-choice";
import { StepSetupLocalByos } from "./step-setup-local-byos";
import { StepSetupCloud } from "./step-setup-cloud";
import { StepSetupAdvanced } from "./step-setup-advanced";
import { StepSummary } from "./step-summary";
import { StepIndicator, type Step } from "./step-indicator";
import { Sun, Moon, CheckCircle2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { useTheme } from "../../hooks/use-theme";
import type { SetupMode } from "@spaceduck/config/setup";
import {
  buildLocalPatch,
  buildCloudPatch,
  buildAdvancedPatch,
  buildOnboardingCompletePatch,
  buildOnboardingSkipPatch,
  ONBOARDING_VERSION,
  LOCAL_PRESET_URLS,
} from "@spaceduck/config/setup";

const WIZARD_STEPS: Step[] = [
  { id: "welcome", label: "Welcome" },
  { id: "security", label: "Security" },
  { id: "connect", label: "Connect" },
  { id: "choose", label: "Choose" },
  { id: "configure", label: "Configure" },
  { id: "review", label: "Review" },
];

export type WizardStep =
  | "welcome"
  | "security"
  | "find-gateway"
  | "pairing"
  | "paired-confirmation"
  | "setup-choice"
  | "setup-local"
  | "setup-cloud"
  | "setup-advanced"
  | "summary"
  | "done";

interface OnboardingWizardProps {
  onComplete: (gatewayUrl: string, token: string | null, gatewayName: string) => void;
  initialStep?: WizardStep;
}

interface GatewayConnection {
  url: string;
  gatewayId: string;
  gatewayName: string;
  requiresAuth: boolean;
}

interface SetupState {
  mode: SetupMode | null;
  provider: string;
  model: string;
  baseUrl: string;
  region: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingBaseUrl: string;
}

async function patchGateway(ops: { op: string; path: string; value: unknown }[]): Promise<boolean> {
  const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
  const token = localStorage.getItem("spaceduck.token");
  if (!gatewayUrl) return false;
  try {
    const configRes = await fetch(`${gatewayUrl}/api/config`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!configRes.ok) return false;
    const { rev } = await configRes.json() as { rev: string };

    const res = await fetch(`${gatewayUrl}/api/config`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": rev,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(ops),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function OnboardingWizard({ onComplete, initialStep }: OnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>(initialStep ?? "welcome");
  const [gateway, setGateway] = useState<GatewayConnection | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const { resolved, setTheme } = useTheme();
  const toggleTheme = useCallback(() => setTheme(resolved === "dark" ? "light" : "dark"), [resolved, setTheme]);
  const [setup, setSetup] = useState<SetupState>({
    mode: null,
    provider: "",
    model: "",
    baseUrl: "",
    region: "",
    embeddingProvider: "",
    embeddingModel: "",
    embeddingBaseUrl: "",
  });

  const handleGatewayFound = (conn: GatewayConnection) => {
    setGateway(conn);
    localStorage.setItem("spaceduck.gatewayUrl", conn.url);
    localStorage.setItem("spaceduck.gatewayName", conn.gatewayName);
    if (conn.requiresAuth) {
      setStep("pairing");
    } else {
      setStep("setup-choice");
    }
  };

  const handlePaired = (rawToken: string) => {
    setToken(rawToken);
    localStorage.setItem("spaceduck.token", rawToken);
    setStep("paired-confirmation");
  };

  const handleSetupChoice = (mode: SetupMode) => {
    setSetup((prev) => ({ ...prev, mode }));
    switch (mode) {
      case "local":
        setStep("setup-local");
        break;
      case "cloud":
        setStep("setup-cloud");
        break;
      case "advanced":
        setStep("setup-advanced");
        break;
    }
  };

  const handleFinish = useCallback(() => {
    const url = gateway?.url ?? localStorage.getItem("spaceduck.gatewayUrl") ?? "";
    const name = gateway?.gatewayName ?? localStorage.getItem("spaceduck.gatewayName") ?? "Gateway";
    if (url) {
      localStorage.setItem("spaceduck.gatewayUrl", url);
      localStorage.setItem("spaceduck.gatewayName", name);
    }
    if (token) {
      localStorage.setItem("spaceduck.token", token);
    }
    onComplete(url, token, name);
  }, [gateway, token, onComplete]);

  const handleSkip = useCallback(async () => {
    await patchGateway(buildOnboardingSkipPatch());
    handleFinish();
  }, [handleFinish]);

  const handleLocalContinue = (provider: string, baseUrl: string) => {
    setSetup((prev) => ({
      ...prev,
      mode: "local",
      provider,
      baseUrl: baseUrl || LOCAL_PRESET_URLS[provider] || "",
      model: "",
    }));
    setStep("summary");
  };

  const handleCloudContinue = (provider: string, model: string, region?: string) => {
    setSetup((prev) => ({
      ...prev,
      mode: "cloud",
      provider,
      model,
      region: region ?? "",
    }));
    setStep("summary");
  };

  const handleAdvancedContinue = (opts: {
    provider: string;
    model: string;
    baseUrl: string;
    region: string;
    embeddingProvider: string;
    embeddingModel: string;
    embeddingBaseUrl: string;
  }) => {
    setSetup((prev) => ({ ...prev, mode: "advanced", ...opts }));
    setStep("summary");
  };

  const handleConfirm = useCallback(async () => {
    if (!setup.mode) return;

    let providerOps: { op: string; path: string; value: unknown }[] = [];
    switch (setup.mode) {
      case "local":
        providerOps = buildLocalPatch(setup.provider, setup.baseUrl);
        break;
      case "cloud":
        providerOps = buildCloudPatch(setup.provider, setup.model, setup.region || undefined);
        break;
      case "advanced":
        providerOps = buildAdvancedPatch({
          provider: setup.provider,
          model: setup.model,
          baseUrl: setup.baseUrl,
          region: setup.region,
          embeddingProvider: setup.embeddingProvider,
          embeddingModel: setup.embeddingModel,
          embeddingBaseUrl: setup.embeddingBaseUrl,
        });
        break;
    }

    const onboardingOps = buildOnboardingCompletePatch(setup.mode, ONBOARDING_VERSION);
    await patchGateway([...providerOps, ...onboardingOps]);
    setStep("done");
  }, [setup]);

  const stepIndex = useMemo(() => {
    switch (step) {
      case "welcome": return 0;
      case "security": return 1;
      case "find-gateway":
      case "pairing":
      case "paired-confirmation": return 2;
      case "setup-choice": return 3;
      case "setup-local":
      case "setup-cloud":
      case "setup-advanced": return 4;
      case "summary": return 5;
      case "done": return 6;
      default: return 0;
    }
  }, [step]);

  const handleStepClick = useCallback((index: number) => {
    if (index >= stepIndex) return;
    switch (index) {
      case 0: setStep("welcome"); break;
      case 1: setStep("security"); break;
      case 2: setStep("find-gateway"); break;
      case 3: setStep("setup-choice"); break;
      case 4: {
        switch (setup.mode) {
          case "local": setStep("setup-local"); break;
          case "cloud": setStep("setup-cloud"); break;
          case "advanced": setStep("setup-advanced"); break;
          default: setStep("setup-choice"); break;
        }
        break;
      }
      case 5: setStep("summary"); break;
    }
  }, [stepIndex, setup.mode]);

  const showStepper = step !== "done";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {showStepper && (
        <div className="shrink-0 border-b border-border bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-4 mx-auto max-w-2xl px-6 py-5">
            <div className="flex-1">
              <StepIndicator
                steps={WIZARD_STEPS}
                currentIndex={stepIndex}
                onStepClick={handleStepClick}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-8">
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
          {step === "paired-confirmation" && (
            <div className="flex flex-col items-center text-center gap-6 py-8">
              <CheckCircle2 size={48} className="text-green-500" />
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Paired successfully</h1>
                <p className="text-muted-foreground mt-2">
                  Your device is now authorized to access <strong>{gateway?.gatewayName ?? "the gateway"}</strong>.
                </p>
              </div>
              <Button onClick={() => setStep("setup-choice")}>Continue</Button>
            </div>
          )}
          {step === "setup-choice" && (
            <StepSetupChoice
              onSelect={handleSetupChoice}
              onSkip={handleSkip}
            />
          )}
          {step === "setup-local" && (
            <StepSetupLocalByos
              onContinue={handleLocalContinue}
              onBack={() => setStep("setup-choice")}
              onSkip={handleSkip}
            />
          )}
          {step === "setup-cloud" && (
            <StepSetupCloud
              onContinue={handleCloudContinue}
              onBack={() => setStep("setup-choice")}
              onSkip={handleSkip}
            />
          )}
          {step === "setup-advanced" && (
            <StepSetupAdvanced
              onContinue={handleAdvancedContinue}
              onBack={() => setStep("setup-choice")}
              onSkip={handleSkip}
            />
          )}
          {step === "summary" && setup.mode && (
            <StepSummary
              mode={setup.mode}
              provider={setup.provider}
              model={setup.model}
              baseUrl={setup.baseUrl || undefined}
              onConfirm={handleConfirm}
              onBack={() => {
                switch (setup.mode) {
                  case "local": setStep("setup-local"); break;
                  case "cloud": setStep("setup-cloud"); break;
                  case "advanced": setStep("setup-advanced"); break;
                }
              }}
            />
          )}
          {step === "done" && (
            <StepDone
              gatewayName={gateway?.gatewayName ?? localStorage.getItem("spaceduck.gatewayName") ?? "Gateway"}
              authDisabled={gateway ? !gateway.requiresAuth : false}
              onStart={handleFinish}
            />
          )}
        </div>
      </div>

      <div className="fixed bottom-4 right-4 z-50">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" className="h-8 w-8 rounded-full shadow-sm" onClick={toggleTheme}>
              {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Toggle theme</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
