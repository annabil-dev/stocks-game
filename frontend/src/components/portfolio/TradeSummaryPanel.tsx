import { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../../config';
import { useUser } from '../../UserContext';

// ── Semi-circle Gauge ──────────────────────────────────────
function SemiGauge({ percent, wins, losses }: { percent: number; wins: number; losses: number }) {
  const r = 72;
  const cx = 90;
  const cy = 86;
  const total = wins + losses;
  const winAngle = total > 0 ? (wins / total) * 180 : 0;
  const startAngle = 180;
  const greenEnd = startAngle - winAngle;

  const arcPath = (start: number, end: number, color: string) => {
    const s = (start * Math.PI) / 180;
    const e = (end * Math.PI) / 180;
    const x1 = cx + r * Math.cos(s);
    const y1 = cy - r * Math.sin(s);
    const x2 = cx + r * Math.cos(e);
    const y2 = cy - r * Math.sin(e);
    const large = Math.abs(start - end) > 180 ? 1 : 0;
    return (
      <path
        d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
        fill="none"
        stroke={color}
        strokeWidth={20}
        strokeLinecap="butt"
      />
    );
  };

  return (
    <svg width={180} height={110} viewBox="0 0 180 120">
      {/* Background arc (gray) */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={20}
      />
      {/* Losses arc (red, left side) */}
      {losses > 0 && arcPath(180, 180 + winAngle, '#EF5350')}
      {/* Wins arc (green, right side) */}
      {wins > 0 && arcPath(greenEnd, 0, '#26A69A')}
      {/* Center text */}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--text-primary)" fontSize={22} fontWeight={700} fontFamily="var(--font-mono)">
        {percent.toFixed(0)}%
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="var(--text-muted)" fontSize={11}>
        Win Rate
      </text>
      {/* Labels */}
      {losses > 0 && <text x={cx - r - 10} y={cy - r + 25} textAnchor="middle" fill="#EF5350" fontSize={10} fontWeight={600}>{losses}</text>}
      {wins > 0 && <text x={cx + r + 10} y={cy - r + 25} textAnchor="middle" fill="#26A69A" fontSize={10} fontWeight={600}>{wins}</text>}
    </svg>
  );
}

// ── Interfaces ─────────────────────────────────────────────
interface TradeStat {
  totalTrades: number;
  totalProfitLoss: number;
  winRate: number;
  profitFactor: number;
  totalWins: number;
  totalLosses: number;
  period: string;
  trades: Array<{
    profitLoss: number;
    closedAt: string;
    stock: { ticker: string; name: string };
  }>;
}

interface Props {
  userId: string;
}

const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function TradeSummaryPanel({ userId }: Props) {
  const [period, setPeriod] = useState<'all' | 'mtd'>('all');
  const [data, setData] = useState<TradeStat | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetch(`${API_BASE}/portfolio/${userId}/trade-stats?period=${period}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [userId, period]);

  // Daily realized loss trend from individual trades
  const realizedLossChart = useMemo(() => {
    if (!data?.trades?.length) return [];
    const byDay: Record<string, number> = {};
    for (const t of data.trades) {
      const day = t.closedAt.split('T')[0];
      byDay[day] = (byDay[day] || 0) + Math.max(0, -t.profitLoss); // only losses
    }
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30);
  }, [data]);

  const display = data || { totalTrades: 0, totalProfitLoss: 0, winRate: 0, profitFactor: 0, totalWins: 0, totalLosses: 0, period, trades: [] };

  return (
    <div className="glass-panel" style={{ padding: '1.25rem' }}>
      {/* Header + Period Selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Trade Summary
        </div>
        <select
          value={period}
          onChange={e => setPeriod(e.target.value as 'all' | 'mtd')}
          style={{
            padding: '4px 8px',
            fontSize: '0.7rem',
            borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'rgba(255,255,255,0.06)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="all">All Time</option>
          <option value="mtd">Month to Date</option>
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Memuat data...
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16, alignItems: 'start' }}>
          {/* Gauge */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>
              {display.totalTrades} Trade{display.totalTrades !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <SemiGauge percent={display.winRate} wins={display.totalWins} losses={display.totalLosses} />
            </div>
          </div>

          {/* Win Rate & Profit Factor */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
            <div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 2 }}>Win Rate</div>
              <div style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: display.winRate >= 50 ? 'var(--trade-up)' : 'var(--trade-down)',
              }}>
                {display.winRate.toFixed(1)}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 2 }}>Profit Factor</div>
              <div style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: display.profitFactor >= 1 ? 'var(--trade-up)' : 'var(--trade-down)',
              }}>
                {display.profitFactor === 999 ? '∞' : display.profitFactor.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Total Realized Loss */}
          <div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 2 }}>Total Realized {display.totalProfitLoss >= 0 ? 'Gain' : 'Loss'}</div>
            <div style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: display.totalProfitLoss >= 0 ? 'var(--trade-up)' : 'var(--trade-down)',
            }}>
              {display.totalProfitLoss >= 0 ? '+' : ''}{fmtRp(Math.abs(display.totalProfitLoss))}
            </div>
          </div>

          {/* Micro realized loss trend chart */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4 }}>
              Loss Trend (per hari)
            </div>
            <div style={{ height: 60, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
              {realizedLossChart.length === 0 && (
                <div style={{ width: '100%', textAlign: 'center', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  -
                </div>
              )}
              {realizedLossChart.map(([day, loss], i) => {
                const maxLoss = Math.max(...realizedLossChart.map(([, v]) => v), 1);
                const h = (loss / maxLoss) * 50;
                return (
                  <div
                    key={day}
                    title={`${day}: ${fmtRp(loss)}`}
                    style={{
                      flex: 1,
                      height: Math.max(h, 2),
                      background: 'var(--trade-down)',
                      borderRadius: '2px 2px 0 0',
                      opacity: 0.7,
                      minWidth: 3,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
