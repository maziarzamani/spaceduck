import { useState, useCallback } from "react";
import { useSpaceduckWs } from "./hooks/use-spaceduck-ws";
import { ChatView } from "./components/chat-view";
import { OnboardingView } from "./components/onboarding-view";
import { SettingsView } from "./components/settings-view";
import { TooltipProvider } from "./ui/tooltip";

export type AppView = "onboarding" | "chat" | "settings";

function resolveInitialView(): AppView {
  const url = localStorage.getItem("spaceduck.gatewayUrl");
  return url ? "chat" : "onboarding";
}

export function App() {
  const [view, setView] = useState<AppView>(resolveInitialView);
  const ws = useSpaceduckWs();

  const handleOnboardingComplete = useCallback(
    (_gatewayUrl: string, _token: string | null, _gatewayName: string) => {
      setView("chat");
    },
    [],
  );

  const handleDisconnect = useCallback(() => {
    localStorage.removeItem("spaceduck.gatewayUrl");
    localStorage.removeItem("spaceduck.token");
    localStorage.removeItem("spaceduck.gatewayName");
    setView("onboarding");
  }, []);

  if (view === "onboarding") {
    return (
      <TooltipProvider delayDuration={300}>
        <OnboardingView onComplete={handleOnboardingComplete} />
      </TooltipProvider>
    );
  }

  if (view === "settings") {
    return (
      <TooltipProvider delayDuration={300}>
        <SettingsView
          onBack={() => setView("chat")}
          onDisconnect={handleDisconnect}
        />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <ChatView ws={ws} onOpenSettings={() => setView("settings")} />
    </TooltipProvider>
  );
}
