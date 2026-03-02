import { DollarSign, Calendar, Activity } from "lucide-react";
import { Card, CardContent } from "../../ui/card";
import type { SchedulerStatus } from "../../hooks/use-tasks";

interface SpendCardsProps {
  daily: number | null;
  monthly: number | null;
  schedulerStatus: SchedulerStatus;
  schedulerPaused: boolean;
}

function formatUsd(value: number | null): string {
  if (value === null) return "--";
  return `$${value.toFixed(4)}`;
}

function statusLabel(status: SchedulerStatus, paused: boolean): string {
  if (paused) return "Paused";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusDotClass(status: SchedulerStatus, paused: boolean): string {
  if (paused) return "bg-yellow-500";
  if (status === "running") return "bg-green-500";
  if (status === "starting" || status === "stopping") return "bg-yellow-500";
  return "bg-muted-foreground/40";
}

export function SpendCards({ daily, monthly, schedulerStatus, schedulerPaused }: SpendCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2">
              <DollarSign size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Today</p>
              <p className="text-lg font-semibold tabular-nums">{formatUsd(daily)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2">
              <Calendar size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">This month</p>
              <p className="text-lg font-semibold tabular-nums">{formatUsd(monthly)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2">
              <Activity size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Scheduler</p>
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(schedulerStatus, schedulerPaused)}`} />
                <p className="text-lg font-semibold">{statusLabel(schedulerStatus, schedulerPaused)}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
