import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";

interface SettingsViewProps {
  onBack: () => void;
  onDisconnect: () => void;
}

export function SettingsView({ onBack, onDisconnect }: SettingsViewProps) {
  const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "unknown";
  const gatewayName = localStorage.getItem("spaceduck.gatewayName") ?? "unknown";

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>Manage your gateway connection</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium">Current Gateway</p>
            <p className="text-sm text-muted-foreground">{gatewayName}</p>
            <p className="text-xs text-muted-foreground mt-1">{gatewayUrl}</p>
          </div>

          <Separator />

          <p className="text-xs text-muted-foreground">
            Device management and token revocation will be available in Slice 4.
          </p>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onBack}>
              Back to Chat
            </Button>
            <Button variant="destructive" className="flex-1" onClick={onDisconnect}>
              Disconnect
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
