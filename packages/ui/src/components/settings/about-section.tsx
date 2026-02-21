import { Card, CardHeader, CardTitle, CardContent } from "../../ui/card";

export function AboutSection() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">About</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Spaceduck information.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Version</span>
              <span>0.1.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Runtime</span>
              <span className="font-mono text-xs">Bun</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
