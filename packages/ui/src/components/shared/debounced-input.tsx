import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "../../ui/input";
import { Textarea } from "../../ui/textarea";
import { Check } from "lucide-react";

function useSaveFlash() {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = useCallback(() => {
    setSaved(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 1500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { saved, flash };
}

export function SavedBadge({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-green-500 animate-in fade-in">
      <Check size={12} /> Saved
    </span>
  );
}

export { useSaveFlash };

export function DebouncedInput({
  value: externalValue,
  onCommit,
  error,
  onLocalChange,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value"> & {
  value: string;
  onCommit: (value: string) => Promise<boolean>;
  error?: string | null;
  onLocalChange?: (value: string) => void;
}) {
  const [local, setLocal] = useState(externalValue);
  const { saved, flash } = useSaveFlash();
  useEffect(() => setLocal(externalValue), [externalValue]);

  const commit = async () => {
    if (local !== externalValue) {
      const ok = await onCommit(local);
      if (ok) flash();
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <Input
          {...props}
          value={local}
          onChange={(e) => {
            setLocal(e.target.value);
            onLocalChange?.(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={`flex-1 ${error ? "border-destructive" : ""} ${props.className ?? ""}`}
        />
        <SavedBadge visible={saved} />
      </div>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}

export function DebouncedTextarea({
  value: externalValue,
  onCommit,
  ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
  value: string;
  onCommit: (value: string) => Promise<boolean>;
}) {
  const [local, setLocal] = useState(externalValue);
  const { saved, flash } = useSaveFlash();
  useEffect(() => setLocal(externalValue), [externalValue]);

  const commit = async () => {
    if (local !== externalValue) {
      const ok = await onCommit(local);
      if (ok) flash();
    }
  };

  return (
    <div>
      <Textarea
        {...props}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
      />
      <div className="mt-1 h-4">
        <SavedBadge visible={saved} />
      </div>
    </div>
  );
}
