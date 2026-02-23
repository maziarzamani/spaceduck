import { OnboardingWizard, type WizardStep } from "./onboarding/onboarding-wizard";

interface OnboardingViewProps {
  onComplete: (gatewayUrl: string, token: string | null, gatewayName: string) => void;
  initialStep?: WizardStep;
}

export function OnboardingView({ onComplete, initialStep }: OnboardingViewProps) {
  return <OnboardingWizard onComplete={onComplete} initialStep={initialStep} />;
}
