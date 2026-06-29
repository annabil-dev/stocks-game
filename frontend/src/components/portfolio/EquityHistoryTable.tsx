import { useState, useMemo } from 'react';

interface Snapshot {
  totalEquity: string | number;
  cashBalance: string | number;
  portfolioValue: string | number;
  createdAt: string;
}

interface Props {
  snapshots: Snapshot[];
  isLoading: boolean;
}

const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default function EquityHistoryTable({ snapshots, isLoading }: Props) {
  const [viewMode, setViewMode] = useState<'Daily' | 'Monthly'>('Daily');

  const processed = useMemo(() => {
    const nums = snapshots.map(s => ({
      date: s.createdAt,
      equity: Number(s.totalEquity),
    }));

    if (viewMode === 'Monthly') {
      // Aggregate by month
      const byMonth: Record<string, { equity: number; date: string }> = {};
      for (const d of nums) {
        const dt = new Date(d.date);
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
        // Take the last entry of each month
        byMonth[key] = d;
      }
      return Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([_key, d]) => ({
          date: d.date,
          equity: d.equity,
          label: (() => {
            const dt = new Date(d.date);
            return `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
          })(),
        }));
    }

    return nums.map(d => ({
      date: d.date,
      equity: d.equity,
      label: formatDate(d.date),
    }));
  }, [snapshots, viewMode]);

  const rows = useMemo(() => {
    if (!processed.length) return [];
    // Latest first
    const reversed = [...processed].reverse();
    return reversed.map((d, i) => {
      const prevEquity = i < reversed.length - 1 ? reversed[i + 1].equity : d.equity;
      const pnl = d.equity - prevEquity;
      const pnlPct = prevEquity > 0 ? (pnl / prevEquity) * 100 : 0;
      return { ...d, pnl, pnlPct };
    });
  }, [processed]);

  return (
    <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header + Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Total Equity Return
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['Daily', 'Monthly'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '2px 8px',
                fontSize: '0.7rem',
                fontWeight: viewMode === mode ? 700 : 500,
                borderRadius: 4,
                border: 'none',
                cursor: 'pointer',
                background: viewMode === mode ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
                color: viewMode === mode ? '#fff' : 'var(--text-secondary)',
                transition: 'all 0.15s',
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Table header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 4,
        padding: '6px 8px',
        fontSize: '0.65rem',
        color: 'var(--text-muted)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        borderBottom: '1px solid var(--border-color)',
        marginBottom: 4,
      }}>
        <span>Date</span>
        <span style={{ textAlign: 'right' }}>Equity</span>
        <span style={{ textAlign: 'right' }}>P&amp;L</span>
      </div>

      {/* Scrollable rows */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        minHeight: 0,
      }}>
        {isLoading && (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Memuat data...
          </div>
        )}
        {!isLoading && rows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Belum ada riwayat
          </div>
        )}
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 4,
              padding: '5px 8px',
              fontSize: '0.78rem',
              fontFamily: 'var(--font-mono)',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
              alignItems: 'center',
            }}
          >
            <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{r.label}</span>
            <span style={{ textAlign: 'right', color: 'var(--text-primary)' }}>{fmtRp(r.equity)}</span>
            <span style={{
              textAlign: 'right',
              color: r.pnl >= 0 ? 'var(--trade-up)' : 'var(--trade-down)',
              fontWeight: 600,
            }}>
              {r.pnl >= 0 ? '+' : ''}{fmtRp(r.pnl)}
              <span style={{ fontSize: '0.65rem', opacity: 0.7, marginLeft: 2 }}>
                ({r.pnlPct >= 0 ? '+' : ''}{r.pnlPct.toFixed(2)}%)
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
