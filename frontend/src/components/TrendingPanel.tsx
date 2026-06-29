import { useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, BarChart3, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import GlassCard from './GlassCard';
import type { MoverItem } from './Movers';

interface TrendingPanelProps {
  gainers: MoverItem[];
  losers: MoverItem[];
  byVolume: MoverItem[];
  byValue: MoverItem[];
}

// ── Consistent ticker colours (same as Movers) ───────────
const TICKER_COLORS = [
  '#2962FF', '#FF6D00', '#00C853', '#D500F9', '#00BCD4',
  '#FF1744', '#76FF03', '#FF9100', '#E040FB', '#00E676',
  '#448AFF', '#FFD600', '#18FFFF', '#651FFF', '#69F0AE',
  '#FF4081', '#536DFE', '#FFD740', '#64DD17', '#B388FF',
  '#40C4FF',
];

function tickerColor(ticker: string): string {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) {
    hash = ticker.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TICKER_COLORS[Math.abs(hash) % TICKER_COLORS.length];
}

function formatRupiah(v: number): string {
  if (v >= 1e12) return (v / 1e12).toFixed(1) + ' T';
  if (v >= 1e9) return (v / 1e9).toFixed(1) + ' M';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + ' B';
  return v.toLocaleString('id-ID');
}

type SubTab = 'trending' | 'movers' | 'papan';
type MoversSubTab = 'GAINER' | 'LOSER' | 'VOLUME' | 'VALUE';

export default function TrendingPanel({ gainers, losers, byVolume, byValue }: TrendingPanelProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<SubTab>('trending');
  const [moversTab, setMoversTab] = useState<MoversSubTab>('GAINER');

  // Trending = stocks sorted by trade count (frequency) — highest first
  // We approximate frequency from value/volume since we don't have freq prop on MoverItem
  // Actually MoverItem has volume + value, but no freq. Let's use value as proxy.
  const trending = useMemo(() => {
    // Sort by value descending as a proxy for "most active"
    const sorted = [...byValue];
    // Mix in some randomness for visual variety — use a deterministic shuffle
    return sorted.slice(0, 15);
  }, [byValue]);

  const moversData = useMemo(() => {
    switch (moversTab) {
      case 'GAINER': return gainers.slice(0, 10);
      case 'LOSER': return losers.slice(0, 10);
      case 'VOLUME': return byVolume.slice(0, 10);
      case 'VALUE': return byValue.slice(0, 10);
    }
  }, [moversTab, gainers, losers, byVolume, byValue]);

  return (
    <GlassCard title="Trending" icon={<TrendingUp size={13} />}>
      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: '0.6rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {[
          { key: 'trending' as SubTab, label: 'Trending' },
          { key: 'movers' as SubTab, label: 'Movers' },
          { key: 'papan' as SubTab, label: 'Papan Khusus' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => {
              if (t.key === 'papan') return; // disabled
              setTab(t.key);
            }}
            title={t.key === 'papan' ? 'Coming soon' : undefined}
            style={{
              flex: 1,
              padding: '0.4rem 0.5rem',
              fontSize: '0.65rem',
              fontWeight: 600,
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--accent-primary)' : '2px solid transparent',
              color: t.key === 'papan' ? 'rgba(139,148,158,0.35)' : tab === t.key ? '#E6EDF3' : '#8B949E',
              cursor: t.key === 'papan' ? 'not-allowed' : 'pointer',
              transition: 'var(--transition)',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Trending Tab ────────────────────────── */}
      {tab === 'trending' && (
        <div>
          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '24px 1fr 60px 60px',
            gap: '0.25rem', padding: '0.25rem 0.35rem',
            fontSize: '0.6rem', color: '#8B949E', fontWeight: 600,
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            textTransform: 'uppercase', letterSpacing: '0.03em',
          }}>
            <span>#</span>
            <span>Symbol</span>
            <span style={{ textAlign: 'right' }}>Price</span>
            <span style={{ textAlign: 'right' }}>+/-%</span>
          </div>
          {/* Rows */}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {trending.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1rem', color: '#8B949E', fontSize: '0.7rem' }}>
                Belum ada data
              </div>
            ) : trending.slice(0, 15).map((item, i) => (
              <div
                key={item.ticker}
                onClick={() => navigate(`/trade/${item.ticker}.JK`)}
                style={{
                  display: 'grid', gridTemplateColumns: '24px 1fr 60px 60px',
                  gap: '0.25rem', padding: '0.35rem',
                  fontSize: '0.65rem', cursor: 'pointer',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  transition: 'background 0.15s',
                  alignItems: 'center',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ color: '#8B949E', fontSize: '0.6rem' }}>{i + 1}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: tickerColor(item.ticker),
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.55rem', fontWeight: 700, color: '#fff',
                    flexShrink: 0,
                  }}>
                    {item.ticker.slice(0, 2)}
                  </span>
                  <span style={{ fontWeight: 600, color: '#E6EDF3' }}>{item.ticker}</span>
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#E6EDF3' }}>
                  {item.price.toLocaleString('id-ID')}
                </span>
                <span style={{
                  textAlign: 'right', fontFamily: 'var(--font-mono)',
                  color: item.changePercent >= 0 ? 'var(--trade-up)' : 'var(--trade-down)',
                }}>
                  {item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Movers Tab (reuses original Movers logic) ── */}
      {tab === 'movers' && (
        <div>
          {/* Movers sub-tabs */}
          <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {(['GAINER', 'LOSER', 'VOLUME', 'VALUE'] as MoversSubTab[]).map(st => (
              <button
                key={st}
                onClick={() => setMoversTab(st)}
                style={{
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.6rem',
                  fontWeight: 600,
                  background: moversTab === st ? 'rgba(41,98,255,0.2)' : 'transparent',
                  border: `1px solid ${moversTab === st ? 'var(--accent-primary)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: '0.3rem',
                  color: moversTab === st ? '#E6EDF3' : '#8B949E',
                  cursor: 'pointer',
                  transition: 'var(--transition)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em',
                }}
              >
                {st === 'GAINER' ? 'Top Gainer' : st === 'LOSER' ? 'Top Loser' : st === 'VOLUME' ? 'Volume' : 'Value'}
              </button>
            ))}
          </div>
          {/* Movers table */}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {moversData.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1rem', color: '#8B949E', fontSize: '0.7rem' }}>Belum ada data</div>
            ) : moversData.map(item => (
              <div
                key={item.ticker}
                onClick={() => navigate(`/trade/${item.ticker}.JK`)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.35rem', fontSize: '0.65rem', cursor: 'pointer',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: tickerColor(item.ticker),
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.55rem', fontWeight: 700, color: '#fff',
                    flexShrink: 0,
                  }}>
                    {item.ticker.slice(0, 2)}
                  </span>
                  <span style={{ fontWeight: 600, color: '#E6EDF3' }}>{item.ticker}</span>
                  <span style={{ color: '#8B949E', fontSize: '0.6rem', marginLeft: '0.25rem' }}>
                    Rp{item.price.toLocaleString('id-ID')}
                  </span>
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  color: moversTab === 'VOLUME' || moversTab === 'VALUE' ? '#E6EDF3'
                    : item.changePercent >= 0 ? 'var(--trade-up)' : 'var(--trade-down)',
                  fontWeight: 600,
                }}>
                  {moversTab === 'VALUE' ? formatRupiah(item.value)
                    : moversTab === 'VOLUME' ? item.volume.toLocaleString('id-ID')
                    : `${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Papan Khusus Tab (disabled placeholder) ── */}
      {tab === 'papan' && (
        <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#8B949E' }}>
          <AlertTriangle size={24} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
          <div style={{ fontSize: '0.7rem' }}>Coming Soon</div>
          <div style={{ fontSize: '0.6rem', opacity: 0.5, marginTop: '0.25rem' }}>
            Papan pemantauan khusus/efek
          </div>
        </div>
      )}
    </GlassCard>
  );
}
