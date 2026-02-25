import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from "react";
import { cn } from "../lib/utils";

interface HotkeyRecorderProps {
  value: string;
  onChange: (tauriShortcut: string) => void;
  placeholder?: string;
  className?: string;
}

const MOD_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "Fn"]);

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

function keyToTauri(key: string): string {
  switch (key) {
    case "Meta": return "CommandOrControl";
    case "Control": return "CommandOrControl";
    case "Alt": return isMac ? "Option" : "Alt";
    case "Shift": return "Shift";
    case "Fn": return "Fn";
    case " ": return "Space";
    case "ArrowUp": return "Up";
    case "ArrowDown": return "Down";
    case "ArrowLeft": return "Left";
    case "ArrowRight": return "Right";
    case "Escape": return "Escape";
    case "Enter": return "Enter";
    case "Backspace": return "Backspace";
    case "Delete": return "Delete";
    case "Tab": return "Tab";
    default:
      if (key.length === 1) return key.toUpperCase();
      return key;
  }
}

function tauriToDisplay(part: string): string {
  switch (part) {
    case "CommandOrControl": return isMac ? "⌘" : "Ctrl";
    case "Shift": return isMac ? "⇧" : "Shift";
    case "Alt":
    case "Option": return isMac ? "⌥" : "Alt";
    case "Fn": return "🌐";
    case "Super": return isMac ? "⌘" : "Win";
    case "Space": return "Space";
    case "Up": return "↑";
    case "Down": return "↓";
    case "Left": return "←";
    case "Right": return "→";
    default: return part;
  }
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-1.5 rounded-md border border-border bg-muted text-xs font-mono font-medium shadow-[0_1px_0_1px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_0_1px_rgba(255,255,255,0.04)]">
      {children}
    </kbd>
  );
}

export function HotkeyRecorder({ value, onChange, placeholder, className }: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [heldMods, setHeldMods] = useState<Set<string>>(new Set());
  const heldModsRef = useRef<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  const parts = value ? value.split("+") : [];

  const startRecording = useCallback(() => {
    setRecording(true);
    setHeldMods(new Set());
    heldModsRef.current = new Set();
  }, []);

  const cancel = useCallback(() => {
    setRecording(false);
    setHeldMods(new Set());
    heldModsRef.current = new Set();
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      cancel();
      return;
    }

    if (MOD_KEYS.has(e.key)) {
      const tauriKey = keyToTauri(e.key);
      heldModsRef.current = new Set(heldModsRef.current).add(tauriKey);
      setHeldMods(new Set(heldModsRef.current));
      return;
    }

    const mods: string[] = [];
    if (e.metaKey || e.ctrlKey) mods.push("CommandOrControl");
    if (e.shiftKey) mods.push("Shift");
    if (e.altKey) mods.push(isMac ? "Option" : "Alt");
    if (heldModsRef.current.has("Fn")) mods.push("Fn");

    const mainKey = keyToTauri(e.key);
    const combo = [...new Set(mods), mainKey].join("+");
    onChange(combo);
    setRecording(false);
    setHeldMods(new Set());
    heldModsRef.current = new Set();
  }, [recording, cancel, onChange]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (!recording) return;
    if (MOD_KEYS.has(e.key)) {
      const tauriKey = keyToTauri(e.key);
      const next = new Set(heldModsRef.current);
      next.delete(tauriKey);
      heldModsRef.current = next;
      setHeldMods(new Set(next));
    }
  }, [recording]);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        cancel();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [recording, cancel]);

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="button"
      onClick={startRecording}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      className={cn(
        "flex items-center gap-1.5 min-h-[2.25rem] px-3 py-1.5 rounded-md border cursor-pointer transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        recording
          ? "border-primary bg-primary/5 ring-2 ring-primary/30"
          : "border-input bg-background hover:bg-accent/50",
        className,
      )}
    >
      {recording ? (
        heldMods.size > 0 ? (
          <>
            {[...heldMods].map((m) => (
              <Kbd key={m}>{tauriToDisplay(m)}</Kbd>
            ))}
            <span className="text-xs text-muted-foreground ml-1">+ press a key…</span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground animate-pulse">Press a key combination…</span>
        )
      ) : parts.length > 0 ? (
        parts.map((part, i) => <Kbd key={`${part}-${i}`}>{tauriToDisplay(part)}</Kbd>)
      ) : (
        <span className="text-xs text-muted-foreground">{placeholder ?? "Click to set shortcut"}</span>
      )}
    </div>
  );
}
