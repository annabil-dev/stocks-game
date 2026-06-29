import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import GlassCard from './GlassCard';
import { BarChart3, TrendingUp, Moon } from 'lucide-react';

export interface CompositeStats {
  value: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  totalVolume: number;
  totalValue: number;
  totalTradeCount?: number; // for breakdown
}

interface IndexCompositeProps {
  composite: CompositeStats;
  chartData: { time: string; value: number }[];
}

const fmt = (n: number, dec = 0) => n.toLocaleString('id-ID', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtBil = (n: number) => {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return fmt(n);
};

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

export default function IndexComposite({ composite, chartData }: IndexCompositeProps) {
  const isUp = composite.changePercent >= 0;
  const lineColor = isUp ? 'var(--trade-up)' : 'var(--trade-down)';

  const stableData = useMemo(() => chartData.slice(-120), [chartData.length]);

  const chartTooltipStyle: React.CSSProperties = {
    background: 'rgba(20,28,40,0.9)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '0.5rem', padding: '0.4rem 0.6rem', fontSize: '0.7rem',
  };

  return (
    <GlassCard title="BURSA Composite" icon={<BarChart3 size={13} />}>
      {/* ── Header value ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
          <span style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: isUp ? 'var(--trade-up)' : 'var(--trade-down)' }}>
            {fmt(composite.value, 2)}
          </span>
          <span style={{
            fontSize: '0.85rem', fontWeight: 600, fontFamily: 'var(--font-mono)',
            color: isUp ? 'var(--trade-up)' : 'var(--trade-down)',
            display: 'flex', alignItems: 'center', gap: '0.15rem',
          }}>
            <TrendingUp size={14} style={{ transform: isUp ? 'none' : 'rotate(180deg)' }} />
            {composite.changePercent >= 0 ? '+' : ''}{composite.changePercent.toFixed(2)}%
          </span>
          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: isUp ? 'var(--trade-up)' : 'var(--trade-down)' }}>
            ({composite.change >= 0 ? '+' : ''}{fmt(composite.change, 2)})
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {/* TODO: Dark/light mode toggle — purely decorative for now, no global theme system yet */}
          <button
            title="Toggle dark/light mode"
            style={{
              background: 'rgba(255,255,255,0.04)', border: 'none',
              borderRadius: '0.25rem', padding: '0.2rem 0.35rem',
              color: '#8B949E', cursor: 'default', fontSize: '0.65rem',
              display: 'flex', alignItems: 'center', gap: '0.15rem',
            }}
          >
            <Moon size={12} />
          </button>
          <div style={{
            padding: '0.2rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.65rem', fontWeight: 600,
            fontFamily: 'var(--font-mono)', color: '#8B949E', background: 'rgba(255,255,255,0.04)',
          }}>
            BASE {fmt(composite.prevClose, 2)}
          </div>
        </div>
      </div>

      {/* ── Chart ── */}
      <div style={{ height: 170, width: '100%', marginBottom: '0.4rem' }}>
        {stableData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stableData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 9, fill: '#8B949E' }}
                interval="preserveStartEnd"
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickLine={false}
                minTickGap={60}
              />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 9, fill: '#8B949E' }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(val: any) => [fmt(val as number, 2), 'Composite']}
                labelFormatter={(label) => label as string}
              />
              <defs>
                <linearGradient id="compositeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Line
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: lineColor }}
              />
              <ReferenceLine y={composite.open} stroke="#FFD600" strokeDasharray="4 2" label="Open" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8B949E', fontSize: '0.75rem' }}>
            Mengumpulkan data...
          </div>
        )}
      </div>

      {/* ── Mini stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.35rem', marginBottom: '0.5rem' }}>
        {[
          { label: 'Open', val: fmt(composite.open, 2) },
          { label: 'High', val: fmt(composite.high, 2), color: 'var(--trade-up)' },
          { label: 'Low', val: fmt(composite.low, 2), color: 'var(--trade-down)' },
          { label: 'Volume', val: fmt(composite.totalVolume) },
          { label: 'Value', val: fmtBil(composite.totalValue) },
          { label: 'Stocks', val: '21' },
        ].map(s => (
          <div key={s.label} style={{
            background: 'rgba(255,255,255,0.03)', borderRadius: '0.3rem',
            padding: '0.3rem 0.4rem', textAlign: 'center',
          }}>
            <div style={{ fontSize: '0.6rem', color: '#8B949E', fontWeight: 600, marginBottom: '0.1rem' }}>{s.label}</div>
            <div style={{ ...mono, fontSize: '0.72rem', fontWeight: 700, color: s.color || '#E6EDF3' }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* ── Market breakdown (All Market / Regular / Negotiated / Cash) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.3rem' }}>
        {[
          {
            label: 'All Market',
            lot: Math.round(composite.totalVolume / 100),
            value: composite.totalValue,
            freq: composite.totalTradeCount || 0,
            active: true,
          },
          { label: 'Regular', lot: 0, value: 0, freq: 0, active: false },
          { label: 'Negotiated', lot: 0, value: 0, freq: 0, active: false },
          { label: 'Cash', lot: 0, value: 0, freq: 0, active: false },
        ].map(m => (
          <div key={m.label} style={{
            background: m.active ? 'rgba(41,98,255,0.05)' : 'transparent',
            borderRadius: '0.3rem', padding: '0.25rem 0.3rem',
            textAlign: 'center', opacity: m.active ? 1 : 0.35,
          }}>
            <div style={{ fontSize: '0.55rem', fontWeight: 600, color: m.active ? '#8B949E' : '#555', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              {m.label}
            </div>
            <div style={{ ...mono, fontSize: '0.7rem', fontWeight: 700, color: m.active ? '#E6EDF3' : '#555' }}>
              {m.active ? `${fmt(m.lot)} / ${fmtBil(m.value)} / ${fmt(m.freq)}` : '0 / 0 / 0'}
            </div>
            <div style={{ fontSize: '0.5rem', color: m.active ? '#555' : '#444', marginTop: '0.1rem' }}>
              Lot / Value / Freq
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
