import { useState, useCallback, useEffect, useRef } from "react";
import { useSpaceduckWs } from "./hooks/use-spaceduck-ws";
import { useDictation } from "./hooks/use-dictation";
import { ThemeProvider } from "./hooks/use-theme";
import { Button } from "./ui/button";
import { ChatView } from "./components/chat-view";
import { OnboardingView } from "./components/onboarding-view";
import { SettingsView } from "./components/settings-view";
import { DictationOverlay } from "./components/dictation-overlay";
import { TooltipProvider } from "./ui/tooltip";
import { Toaster } from "sonner";
import type { ChatInputRecorderHandle } from "./components/chat-input";

export type AppView = "onboarding" | "chat" | "settings";

function resolveInitialView(): { view: AppView; setupNeeded: boolean } {
  const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

  if (isTauri) {
    if (!localStorage.getItem("spaceduck.gatewayUrl")) {
      localStorage.setItem("spaceduck.gatewayUrl", "http://localhost:3000");
      localStorage.setItem("spaceduck.gatewayName", "Local Gateway");
    }
  }

  const url = localStorage.getItem("spaceduck.gatewayUrl");
  if (!url) return { view: "onboarding", setupNeeded: false };

  if (isTauri) {
    const onboardingDone = localStorage.getItem("spaceduck.onboardingCompleted");
    if (!onboardingDone) {
      return { view: "onboarding", setupNeeded: true };
    }
  }

  return { view: "chat", setupNeeded: false };
}

export function App() {
  return (
    <ThemeProvider>
      <AppInner />
      <Toaster position="bottom-right" richColors closeButton />
    </ThemeProvider>
  );
}

function AppInner() {
  const [viewState] = useState(resolveInitialView);
  const [view, setView] = useState<AppView>(viewState.view);
  const [setupBanner, setSetupBanner] = useState(false);
  const shouldConnect = view === "chat" || view === "settings";
  const ws = useSpaceduckWs(shouldConnect);
  const chatRecorderRef = useRef<ChatInputRecorderHandle | null>(null);

  const [dictationConfig, setDictationConfig] = useState<{
    enabled: boolean;
    hotkey: string;
    languageHint?: string;
  }>({ enabled: false, hotkey: "CommandOrControl+Shift+Space" });

  const fetchDictationConfig = useCallback(() => {
    const isTauri = typeof window !== "undefined" && "__TAURI__" in window;
    if (!isTauri) return;

    const url = localStorage.getItem("spaceduck.gatewayUrl") ?? "http://localhost:3000";
    fetch(`${url}/api/stt/status`)
      .then((r) => r.json())
      .then((data) => {
        if (data.dictation) {
          setDictationConfig({
            enabled: data.dictation.enabled ?? false,
            hotkey: data.dictation.hotkey ?? "CommandOrControl+Shift+Space",
            languageHint: data.language,
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchDictationConfig();
  }, [fetchDictationConfig]);

  const dictation = useDictation({
    enabled: dictationConfig.enabled,
    hotkey: dictationConfig.hotkey,
    languageHint: dictationConfig.languageHint,
    maxSeconds: 120,
    onError: (err) => console.error("[dictation]", err),
    chatRecorderRef,
  });

  useEffect(() => {
    if (view === "chat") {
      const skipped = localStorage.getItem("spaceduck.onboardingSkipped");
      const completed = localStorage.getItem("spaceduck.onboardingCompleted");
      if (skipped && !completed) {
        setSetupBanner(true);
      }
    }
  }, [view]);

  const handleOnboardingComplete = useCallback(
    (_gatewayUrl: string, _token: string | null, _gatewayName: string) => {
      localStorage.setItem("spaceduck.onboardingCompleted", "1");
      setSetupBanner(false);
      setView("chat");
    },
    [],
  );

  const handleDisconnect = useCallback(() => {
    localStorage.removeItem("spaceduck.gatewayUrl");
    localStorage.removeItem("spaceduck.token");
    localStorage.removeItem("spaceduck.gatewayName");
    localStorage.removeItem("spaceduck.onboardingCompleted");
    localStorage.removeItem("spaceduck.onboardingSkipped");
    setView("onboarding");
  }, []);

  useEffect(() => {
    if (ws.authFailed) {
      handleDisconnect();
    }
  }, [ws.authFailed, handleDisconnect]);

  const handleDismissBanner = useCallback(() => {
    setSetupBanner(false);
  }, []);

  const handleFinishSetup = useCallback(() => {
    setView("onboarding");
  }, []);

  if (view === "onboarding") {
    return (
      <TooltipProvider delayDuration={300}>
        <OnboardingView
          onComplete={handleOnboardingComplete}
          initialStep={viewState.setupNeeded ? "setup-choice" : undefined}
        />
      </TooltipProvider>
    );
  }

  if (view === "settings") {
    return (
      <TooltipProvider delayDuration={300}>
        <SettingsView
          onBack={() => { fetchDictationConfig(); setView("chat"); }}
          onDisconnect={handleDisconnect}
        />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      {setupBanner && (
        <SetupBanner onFinish={handleFinishSetup} onDismiss={handleDismissBanner} />
      )}
      <ChatView ws={ws} onOpenSettings={() => setView("settings")} recorderRef={chatRecorderRef} />
      {dictation.supported && (
        <DictationOverlay state={dictation.state} durationMs={dictation.durationMs} />
      )}
    </TooltipProvider>
  );
}

function SetupBanner({ onFinish, onDismiss }: { onFinish: () => void; onDismiss: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-primary/10 border-b border-primary/20 text-sm">
      <span className="text-primary">
        Spaceduck isn't fully set up yet. Configure a provider to get the best experience.
      </span>
      <div className="flex items-center gap-2 shrink-0 ml-4">
        <Button variant="link" size="sm" className="text-primary font-medium" onClick={onFinish}>
          Finish setup
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
