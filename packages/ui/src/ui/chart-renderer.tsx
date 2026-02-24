import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { ChartSpec, CartesianChartSpec, PieChartSpec } from "./chart-types";
import { chartColor } from "./chart-types";

interface ChartRendererProps {
  spec: ChartSpec;
}

const GRID_STYLE = { strokeDasharray: "3 3", stroke: "hsl(var(--sd-border))" };
const AXIS_STYLE = {
  fontSize: 11,
  tickLine: false,
  axisLine: false,
  stroke: "hsl(var(--sd-muted-foreground))",
} as const;

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "hsl(var(--sd-popover))",
    border: "1px solid hsl(var(--sd-border))",
    borderRadius: 6,
    fontSize: 12,
    color: "hsl(var(--sd-popover-foreground))",
  },
  cursor: { fill: "hsl(var(--sd-muted))" },
};

function CartesianChart({ spec }: { spec: CartesianChartSpec }) {
  const showLegend = spec.series.length > 1;

  const sharedChildren = (
    <>
      <CartesianGrid {...GRID_STYLE} />
      <XAxis dataKey={spec.xKey} {...AXIS_STYLE} />
      <Tooltip {...TOOLTIP_STYLE} />
      {showLegend && (
        <Legend
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
        />
      )}
    </>
  );

  if (spec.type === "bar") {
    return (
      <BarChart data={spec.data}>
        {sharedChildren}
        {spec.series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label ?? s.key}
            fill={chartColor(i)}
            radius={[3, 3, 0, 0]}
            stackId={spec.stacked ? "stack" : undefined}
          />
        ))}
      </BarChart>
    );
  }

  if (spec.type === "line") {
    return (
      <LineChart data={spec.data}>
        {sharedChildren}
        {spec.series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label ?? s.key}
            stroke={chartColor(i)}
            strokeWidth={2}
            dot={spec.data.length <= 20}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    );
  }

  // area
  return (
    <AreaChart data={spec.data}>
      {sharedChildren}
      {spec.series.map((s, i) => (
        <Area
          key={s.key}
          type="monotone"
          dataKey={s.key}
          name={s.label ?? s.key}
          stroke={chartColor(i)}
          fill={chartColor(i)}
          fillOpacity={0.2}
          strokeWidth={2}
          stackId={spec.stacked ? "stack" : undefined}
        />
      ))}
    </AreaChart>
  );
}

function PieChartComponent({ spec }: { spec: PieChartSpec }) {
  return (
    <PieChart>
      <Pie
        data={spec.data}
        dataKey={spec.valueKey}
        nameKey={spec.nameKey}
        cx="50%"
        cy="50%"
        innerRadius={spec.donut ? "40%" : 0}
        outerRadius="75%"
        paddingAngle={spec.data.length > 1 ? 2 : 0}
        label={({ name, percent }) =>
          `${name} ${(percent * 100).toFixed(0)}%`
        }
        labelLine={false}
        fontSize={11}
      >
        {spec.data.map((_, i) => (
          <Cell key={i} fill={chartColor(i)} />
        ))}
      </Pie>
      <Tooltip {...TOOLTIP_STYLE} />
      <Legend iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
    </PieChart>
  );
}

export function ChartRenderer({ spec }: ChartRendererProps) {
  return (
    <div className="my-2">
      {spec.title && (
        <p className="text-sm font-medium mb-0.5">{spec.title}</p>
      )}
      {spec.description && (
        <p className="text-xs text-muted-foreground mb-1">{spec.description}</p>
      )}
      <ResponsiveContainer width="100%" height={spec.height}>
        {spec.type === "pie" ? (
          <PieChartComponent spec={spec} />
        ) : (
          <CartesianChart spec={spec} />
        )}
      </ResponsiveContainer>
    </div>
  );
}
