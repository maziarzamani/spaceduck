import { OnboardingWizard } from "./onboarding/onboarding-wizard";

interface OnboardingViewProps {
  onComplete: (gatewayUrl: string, token: string | null, gatewayName: string) => void;
}

export function OnboardingView({ onComplete }: OnboardingViewProps) {
  return <OnboardingWizard onComplete={onComplete} />;
}
