"use client";

/**
 * The 30-day price chart: one line per store (SPEC.md section 9, product page).
 * Prices stay the same between checks, so the lines step rather than slope.
 */
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatCents } from "@/lib/money";

export interface ChartSeries {
  offerId: number;
  storeName: string;
  points: { at: number; priceCents: number }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SERIES = 8;
/** Above this many checks per store, the dots crowd the line, so they show only on hover. */
const MAX_DOTS = 12;

const dateLabel = (ms: number) => new Date(ms).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
const dateTimeLabel = (ms: number) =>
  new Date(ms).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const randLabel = (cents: number) => `R ${Math.round(cents / 100).toLocaleString("en-ZA")}`;

export function PriceChart({ series, fromMs, toMs }: { series: ChartSeries[]; fromMs: number; toMs: number }) {
  // Colours follow the store's offer (oldest first), not its price rank, so they don't swap around.
  const shown = [...series].sort((a, b) => a.offerId - b.offerId).slice(0, MAX_SERIES);
  const colour = new Map(shown.map((s, i) => [s.offerId, `var(--series-${i + 1})`]));

  // One row per check time; a store without a reading at that time is left empty.
  const rows = new Map<number, Record<string, number>>();
  for (const s of shown) {
    for (const p of s.points) {
      const row = rows.get(p.at) ?? { at: p.at };
      row[`o${s.offerId}`] = p.priceCents;
      rows.set(p.at, row);
    }
  }
  const data = [...rows.values()].sort((a, b) => a.at - b.at);
  const ticks: number[] = [];
  for (let t = fromMs; t <= toMs; t += 7 * DAY_MS) ticks.push(t);

  return (
    <div className="flex flex-col gap-3">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="at"
              type="number"
              scale="time"
              domain={[fromMs, toMs]}
              ticks={ticks}
              tickFormatter={dateLabel}
              stroke="var(--muted-foreground)"
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={randLabel}
              width={72}
              domain={["auto", "auto"]}
              stroke="var(--muted-foreground)"
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              labelFormatter={(at) => dateTimeLabel(Number(at))}
              formatter={(value, name) => [formatCents(Number(value)), name]}
              contentStyle={{
                background: "var(--popover)",
                color: "var(--popover-foreground)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 13,
              }}
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
            />
            {shown.length > 1 ? <Legend wrapperStyle={{ fontSize: 13, color: "var(--foreground)" }} /> : null}
            {shown.map((s) => (
              <Line
                key={s.offerId}
                dataKey={`o${s.offerId}`}
                name={s.storeName}
                type="stepAfter"
                connectNulls
                stroke={colour.get(s.offerId)}
                strokeWidth={2}
                dot={
                  s.points.length <= MAX_DOTS
                    ? { r: 4, strokeWidth: 2, stroke: "var(--card)", fill: colour.get(s.offerId) }
                    : false
                }
                activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Show the prices as a table</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Store</th>
              <th className="py-1 pr-3 font-medium">Checked</th>
              <th className="py-1 font-medium">Price</th>
            </tr>
          </thead>
          <tbody>
            {shown.flatMap((s) =>
              [...s.points].reverse().map((p) => (
                <tr key={`${s.offerId}-${p.at}`} className="border-t">
                  <td className="py-1 pr-3">{s.storeName}</td>
                  <td className="py-1 pr-3">{dateTimeLabel(p.at)}</td>
                  <td className="py-1">{formatCents(p.priceCents)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </details>
    </div>
  );
}
