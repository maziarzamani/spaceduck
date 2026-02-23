import { useTheme, type Theme } from "../../hooks/use-theme";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "../../lib/utils";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Customize how Spaceduck looks on your device.
        </p>
      </div>

      <div className="space-y-3">
        <Label>Theme</Label>
        <div className="grid grid-cols-3 gap-3">
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant="outline"
              onClick={() => setTheme(value)}
              className={cn(
                "flex flex-col items-center gap-2 h-auto rounded-lg p-4",
                theme === value
                  ? "border-primary bg-primary/5 text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <Icon size={20} />
              <span className="text-sm font-medium">{label}</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
