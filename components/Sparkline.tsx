'use client';
/**
 * Portfolio value over time.
 *
 * The prototype had a sparkline that was a hardcoded array of eleven points --
 * decoration shaped like evidence. This draws only days that were actually
 * recorded, and refuses to draw at all until there are two of them, because a
 * line through a single point is a trend line for a trend nobody has observed.
 *
 * Colour choices, deliberately:
 *
 * - ONE colour for one series. The prototype ran a coral-to-mint gradient
 *   along the line, which encoded nothing -- the hue changed with position on
 *   the x-axis, implying a meaning it did not have.
 * - The hue reflects direction, up or down, but NEVER carries it alone. The
 *   arrow and the words above the chart say which it is, because mint-versus-
 *   coral is the red/green pair that a colour-blind reader cannot separate.
 *   Colour here reinforces; it does not inform.
 */
import { useId, useState } from 'react';

export interface Point { day: string; value: number }

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function Sparkline({ points, rising }: { points: Point[]; rising: boolean }) {
  const gradId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '14px 0 0' }}>
        Value tracking starts today. Open this page on another day and the change will show here.
      </p>
    );
  }

  const W = 300;
  const H = 46;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series must render as a flat line, not a full-height one.
  const span = max - min || Math.max(1, max * 0.02);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - 3 - ((v - min) / span) * (H - 6);

  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `0,${H} ${line} ${W},${H}`;
  const stroke = rising ? 'var(--mint)' : 'var(--accent)';
  const active = hover ?? points.length - 1;

  return (
    <div style={{ marginTop: 12 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ width: '100%', height: 46, display: 'block', touchAction: 'none' }}
        role="img"
        aria-label={`Collection value over ${points.length} recorded days, from ${money(points[0].value)} to ${money(points[points.length - 1].value)}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
          setHover(Math.round(frac * (points.length - 1)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradId})`} />
        <polyline
          points={line} fill="none" stroke={stroke}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* A ring in the surface colour keeps the marker legible where it sits
            on top of the line. */}
        <circle
          cx={x(active)} cy={y(points[active].value)} r="3.5"
          fill={stroke} stroke="var(--panel)" strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>
        {shortDay(points[active].day)} · {money(points[active].value)}
        {hover === null && points.length > 1 && (
          <span style={{ opacity: 0.6 }}> · drag across for any day</span>
        )}
      </div>
    </div>
  );
}
