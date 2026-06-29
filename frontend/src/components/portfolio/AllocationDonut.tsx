import { useMemo, useState } from 'react';

interface Holding {
  ticker: string;
  name?: string;
  value: number;
  quantity: number;
  avgPrice?: number;
  lastPrice?: number;
  changePct?: number;
  profitLoss?: number;
  percentage?: number;
}

interface Props {
  holdings: Holding[];
  isLoading: boolean;
}

const PIE_COLORS = [
  '#26A69A', '#4f46e5', '#F5C542', '#EF5350', '#7c4dff',
  '#00bcd4', '#ff9800', '#e91e63', '#8bc34a', '#607d8b',
  '#9c27b0', '#009688', '#ff5722', '#03a9f4', '#cddc39',
  '#795548', '#37474f', '#e040fb', '#76ff03', '#ffab00',
  '#00e676',
];

const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
const fmtNum = (n: number) => n.toLocaleString('id-ID');

export default function AllocationDonut({ holdings, isLoading }: Props) {
  const [tab, setTab] = useState<'Stocks'>('Stocks');

  const totalValue = useMemo(() => holdings.reduce((s, h) => s + h.value, 0), [holdings]);
  const stockCount = holdings.length;

  // SVG Donut
  const cx = 100;
  const cy = 100;
  const radius = 80;
  const strokeWidth = 22;

  const arcs = useMemo(() => {
    if (!totalValue || !holdings.length) return [];
    let startAngle = -90;
    return holdings.map((h, i) => {
      const pct = (h.value / totalValue) * 100;
      const angle = (pct / 100) * 360;
      const endAngle = startAngle + angle;
      const sRad = (startAngle * Math.PI) / 180;
      const eRad = (endAngle * Math.PI) / 180;
      const x1 = cx + radius * Math.cos(sRad);
      const y1 = cy + radius * Math.sin(sRad);
      const x2 = cx + radius * Math.cos(eRad);
      const y2 = cy + radius * Math.sin(eRad);
      const largeArc = angle > 180 ? 1 : 0;
      const arc = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
      startAngle = endAngle;
      return { arc, color: PIE_COLORS[i % PIE_COLORS.length], pct };
    });
  }, [holdings, totalValue]);

  const totalPct = arcs.reduce((s, a) => s + a.pct, 0);

  if (isLoading) {
    return (
      <div className="glass-panel" style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Memuat data...
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Portfolio Allocation
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['Stocks', 'Sub-Sector'] as const).map(t => (
            <button
              key={t}
              onClick={() => t === 'Stocks' && setTab(t)}
              style={{
                padding: '2px 8px',
                fontSize: '0.65rem',
                fontWeight: tab === t ? 700 : 500,
                borderRadius: 4,
                border: 'none',
                cursor: t === 'Stocks' ? 'pointer' : 'not-allowed',
                background: tab === t ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
                color: tab === t ? '#fff' : 'var(--text-muted)',
                opacity: t !== 'Stocks' ? 0.4 : 1,
                transition: 'all 0.15s',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {holdings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Belum ada portofolio
        </div>
      ) : (
        <>
          {/* Donut */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
            <svg width={200} height={200} viewBox="0 0 200 200">
              {arcs.map((a, i) => (
                <path
                  key={i}
                  d={a.arc}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                />
              ))}
              {/* Center text */}
              <text x={100} y={92} textAnchor="middle" fill="var(--text-primary)" fontSize={18} fontWeight={700} fontFamily="var(--font-mono)">
                {fmtRp(totalValue)}
              </text>
              <text x={100} y={112} textAnchor="middle" fill="var(--text-muted)" fontSize={11}>
                {stockCount} Stock{stockCount !== 1 ? 's' : ''}
              </text>
            </svg>
          </div>

          {/* Per-ticker list with progress bars */}
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {holdings.map((h, i) => {
              const pct = totalValue > 0 ? (h.value / totalValue) * 100 : 0;
              return (
                <div key={h.ticker} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {h.ticker}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {fmtRp(h.value)}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div style={{
                    height: 4,
                    background: 'rgba(255,255,255,0.08)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${Math.min(pct, 100)}%`,
                      height: '100%',
                      background: PIE_COLORS[i % PIE_COLORS.length],
                      borderRadius: 2,
                      transition: 'width 0.3s',
                    }} />
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1 }}>
                    {pct.toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
