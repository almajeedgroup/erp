import { moneyCompact, type MoneyLike } from '@/lib/format';

interface Point {
  period: string;
  revenue: MoneyLike;
  expenses: MoneyLike;
  net: MoneyLike;
}

/**
 * A grouped bar chart, drawn as plain SVG.
 *
 * No charting library: this is a dozen bars and an axis, and a 60 kB dependency
 * to draw rectangles is a bad trade. It renders on the server with no
 * hydration, which also means it appears in the first paint rather than after
 * a client bundle loads.
 *
 * Accessibility: the SVG carries a summary label, and the same numbers are
 * available in a visually hidden table beneath it, so the chart is not the only
 * way to reach the data.
 */
export function RevenueChart({ points }: { points: Point[] }) {
  const max = Math.max(
    ...points.flatMap((point) => [Number(point.revenue.amount), Number(point.expenses.amount)]),
    1,
  );

  const height = 180;
  const barGroupWidth = 100 / Math.max(points.length, 1);
  const labelEvery = points.length > 8 ? 3 : points.length > 4 ? 2 : 1;

  return (
    <div>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="h-44 w-full"
        role="img"
        aria-label={`Revenue and expenses across ${points.length} periods, peaking at ${moneyCompact(
          { amount: String(max), currency: points[0]?.revenue.currency ?? 'SAR' },
        )}`}
      >
        {/* Baseline */}
        <line
          x1="0"
          y1={height - 1}
          x2="100"
          y2={height - 1}
          stroke="currentColor"
          strokeWidth="0.5"
          className="text-border-subtle"
        />
        {points.map((point, index) => {
          const revenue = Number(point.revenue.amount);
          const expenses = Number(point.expenses.amount);
          const groupX = index * barGroupWidth;
          const barWidth = barGroupWidth * 0.32;

          return (
            <g key={point.period}>
              <rect
                x={groupX + barGroupWidth * 0.14}
                y={height - 1 - (revenue / max) * (height - 12)}
                width={barWidth}
                height={Math.max((revenue / max) * (height - 12), 0)}
                className="fill-accent"
              />
              <rect
                x={groupX + barGroupWidth * 0.52}
                y={height - 1 - (expenses / max) * (height - 12)}
                width={barWidth}
                height={Math.max((expenses / max) * (height - 12), 0)}
                className="fill-caution"
              />
            </g>
          );
        })}
      </svg>

      {/*
        Axis labels live outside the SVG: the chart uses
        `preserveAspectRatio="none"` so the bars stretch to the container, which
        would stretch any text inside it too. Every third label is shown so they
        never collide at twelve months.
      */}
      <div className="mt-1 flex" aria-hidden="true">
        {points.map((point, index) => (
          <span
            key={point.period}
            className="min-w-0 flex-1 text-center text-[0.625rem] text-ink-faint"
          >
            {index % labelEvery === 0 ? point.period.slice(2) : ''}
          </span>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-accent" aria-hidden="true" /> Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-caution" aria-hidden="true" /> Expenses
        </span>
        <span className="ml-auto">
          {points[0]?.period} — {points.at(-1)?.period}
        </span>
      </div>

      <table className="sr-only">
        <caption>Revenue and expenses by period</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Revenue</th>
            <th scope="col">Expenses</th>
            <th scope="col">Net</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.period}>
              <th scope="row">{point.period}</th>
              <td>{moneyCompact(point.revenue)}</td>
              <td>{moneyCompact(point.expenses)}</td>
              <td>{moneyCompact(point.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
