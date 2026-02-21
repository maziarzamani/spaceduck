import { useState } from "react";
import { useConfig } from "../hooks/use-config";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import {
  ArrowLeft,
  Loader2,
  Brain,
  Wrench,
  Mic,
  MessageSquare,
  Wifi,
  Monitor,
  Info,
} from "lucide-react";
import { AiSection } from "./settings/ai-section";
import { ToolsSection } from "./settings/tools-section";
import { SpeechSection } from "./settings/speech-section";
import { ChannelsSection } from "./settings/channels-section";
import { ConnectionSection } from "./settings/connection-section";
import { DevicesSection } from "./settings/devices-section";
import { AboutSection } from "./settings/about-section";

interface SettingsViewProps {
  onBack: () => void;
  onDisconnect: () => void;
}

type SettingsSection =
  | "ai"
  | "tools"
  | "speech"
  | "channels"
  | "connection"
  | "devices"
  | "about";

const NAV_ITEMS: { id: SettingsSection; label: string; icon: typeof Brain }[] = [
  { id: "connection", label: "Connection", icon: Wifi },
  { id: "ai", label: "AI Provider", icon: Brain },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "speech", label: "Speech", icon: Mic },
  { id: "channels", label: "Channels", icon: MessageSquare },
  { id: "devices", label: "Devices", icon: Monitor },
  { id: "about", label: "About", icon: Info },
];

function resolveDefaultSection(): SettingsSection {
  const token = localStorage.getItem("spaceduck.token");
  return token ? "ai" : "connection";
}

export function SettingsView({ onBack, onDisconnect }: SettingsViewProps) {
  const [section, setSection] = useState<SettingsSection>(resolveDefaultSection);
  const cfg = useConfig();

  if (cfg.loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="w-56 shrink-0 border-r border-border flex flex-col">
        <div className="p-3">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onBack}>
            <ArrowLeft size={16} className="mr-2" />
            Back to Chat
          </Button>
        </div>
        <Separator />
        <nav className="flex-1 p-2 flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                section === id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="max-w-2xl mx-auto p-8">
          {/* Info: some changes need restart */}
          {cfg.needsRestart && (
            <div className="mb-6 flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4">
              <Info size={18} className="text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Settings saved</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Some changes take effect after a gateway restart.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={cfg.dismissRestart}>
                OK
              </Button>
            </div>
          )}

          {/* Error banner */}
          {cfg.error && (
            <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
              <p className="text-sm text-destructive">{cfg.error}</p>
            </div>
          )}

          {section === "ai" && <AiSection cfg={cfg} />}
          {section === "tools" && <ToolsSection cfg={cfg} />}
          {section === "speech" && <SpeechSection cfg={cfg} />}
          {section === "channels" && <ChannelsSection cfg={cfg} />}
          {section === "connection" && <ConnectionSection onDisconnect={onDisconnect} />}
          {section === "devices" && <DevicesSection onDisconnect={onDisconnect} />}
          {section === "about" && <AboutSection />}
        </div>
      </ScrollArea>
    </div>
  );
}
