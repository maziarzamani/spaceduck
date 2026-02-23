import { useState } from "react";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import { Loader2, Eye, EyeOff, Check, X } from "lucide-react";

interface SecretInputProps {
  secretPath: string;
  placeholder: string;
  isSet: boolean;
  onSave: (value: string) => Promise<boolean>;
  onClear: () => Promise<boolean>;
  saving: boolean;
}

export function SecretInput({
  secretPath,
  placeholder,
  isSet,
  onSave,
  onClear,
  saving,
}: SecretInputProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);

  const handleSave = async () => {
    if (!value.trim()) return;
    const ok = await onSave(value.trim());
    if (ok) {
      setValue("");
      setEditing(false);
    }
  };

  const handleCancel = () => {
    setValue("");
    setEditing(false);
    setShowValue(false);
  };

  if (isSet && !editing) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm">
          <Check size={14} className="text-green-500 shrink-0" />
          <span className="text-muted-foreground">Key configured</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Change
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onClear}
          disabled={saving}
        >
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Input
          type={showValue ? "text" : "password"}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => setShowValue(!showValue)}
        >
          {showValue ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <Button size="sm" onClick={handleSave} disabled={!value.trim() || saving}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : "Save"}
      </Button>
      {editing && (
        <Button variant="ghost" size="sm" onClick={handleCancel}>
          <X size={14} />
        </Button>
      )}
    </div>
  );
}
