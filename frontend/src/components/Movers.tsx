import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import GlassCard from './GlassCard';
import { TrendingUp } from 'lucide-react';

export interface MoverItem {
  ticker: string;       // "BBCA"
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  value: number;
}

interface MoversProps {
  gainers: MoverItem[];
  losers: MoverItem[];
  byVolume: MoverItem[];
  byValue: MoverItem[];
}

type Tab = 'GAINER' | 'LOSER' | 'VOLUME' | 'VALUE';

const fmt = (n: number) => n.toLocaleString('id-ID');
const fmtBil = (n: number) => {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return fmt(n);
};

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

export default function Movers({ gainers, losers, byVolume, byValue }: MoversProps) {
  const [tab, setTab] = useState<Tab>('GAINER');
  const navigate = useNavigate();

  const tabs: { key: Tab; label: string }[] = [
    { key: 'GAINER', label: 'Top Gainer' },
    { key: 'LOSER', label: 'Top Loser' },
    { key: 'VOLUME', label: 'Volume' },
    { key: 'VALUE', label: 'Value' },
  ];

  const data = useMemo(() => {
    const limit = 10;
    switch (tab) {
      case 'GAINER': return gainers.slice(0, limit);
      case 'LOSER': return losers.slice(0, limit);
      case 'VOLUME': return byVolume.slice(0, limit);
      case 'VALUE': return byValue.slice(0, limit);
    }
  }, [tab, gainers, losers, byVolume, byValue]);

  const tabStyle = (k: Tab): React.CSSProperties => ({
    padding: '0.3rem 0.5rem',
    fontSize: '0.65rem',
    fontWeight: 600,
    border: 'none',
    borderRadius: '0.3rem',
    cursor: 'pointer',
    background: tab === k ? 'rgba(79,70,229,0.25)' : 'transparent',
    color: tab === k ? '#fff' : '#8B949E',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',
  });

  const tableHeader: React.CSSProperties = {
    fontSize: '0.6rem', fontWeight: 600, color: '#8B949E',
    letterSpacing: '0.04em', textTransform: 'uppercase', padding: '0.3rem 0.4rem',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  };
  const tableRow: React.CSSProperties = {
    fontSize: '0.72rem', padding: '0.25rem 0.4rem', borderBottom: '1px solid rgba(255,255,255,0.03)',
    cursor: 'pointer', transition: 'background 0.1s',
  };

  return (
    <GlassCard title="Penggerak Pasar" icon={<TrendingUp size={13} />}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={tabStyle(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...tableHeader, width: '48px' }}>Kode</th>
              <th style={{ ...tableHeader, textAlign: 'right' }}>Harga</th>
              <th style={{ ...tableHeader, textAlign: 'right' }}>+/-%</th>
              {tab === 'VOLUME' && <th style={{ ...tableHeader, textAlign: 'right' }}>Volume</th>}
              {tab === 'VALUE' && <th style={{ ...tableHeader, textAlign: 'right' }}>Value</th>}
              {(tab === 'GAINER' || tab === 'LOSER') && (
                <>
                  <th style={{ ...tableHeader, textAlign: 'right' }}>Volume</th>
                  <th style={{ ...tableHeader, textAlign: 'right' }}>Value</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: '#8B949E', padding: '1.5rem 0.5rem', fontSize: '0.7rem' }}>
                  Belum ada data
                </td>
              </tr>
            )}
            {data.map((item, i) => {
              const isUp = item.changePercent >= 0;
              return (
                <tr
                  key={item.ticker}
                  style={tableRow}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  onClick={() => navigate(`/trade/${item.ticker}.JK`)}
                >
                  <td style={{ fontWeight: 600, fontSize: '0.72rem', color: i < 3 && tab === 'GAINER' ? 'var(--trade-up)' : i < 3 && tab === 'LOSER' ? 'var(--trade-down)' : '#E6EDF3' }}>
                    {item.ticker}
                  </td>
                  <td style={{ ...mono, textAlign: 'right', fontSize: '0.68rem' }}>{fmt(item.price)}</td>
                  <td style={{
                    ...mono, textAlign: 'right', fontSize: '0.68rem', fontWeight: 600,
                    color: isUp ? 'var(--trade-up)' : 'var(--trade-down)',
                  }}>
                    {isUp ? '+' : ''}{item.changePercent.toFixed(2)}%
                  </td>
                  <td style={{ ...mono, textAlign: 'right', fontSize: '0.65rem', color: '#E6EDF3' }}>
                    {fmtBil(item.volume)}
                  </td>
                  <td style={{ ...mono, textAlign: 'right', fontSize: '0.65rem', color: '#E6EDF3' }}>
                    {fmtBil(item.value)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}
