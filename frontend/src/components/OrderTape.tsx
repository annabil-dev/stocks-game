import { useRef, useEffect } from 'react';
import GlassCard from './GlassCard';
import { Activity, Clock } from 'lucide-react';

export interface TradeTapeEntry {
  id: string;
  time: string;
  ticker: string;       // "BBCA"
  price: number;
  lot: number;           // in lots (1 lot = 100 lembar)
  value: number;         // price * quantity
  tradeType: 'MATCH' | 'HAKA' | 'HAKI';
  direction: 'up' | 'down' | 'neutral';
}

interface OrderTapeProps {
  trades: TradeTapeEntry[];
}

const fmt = (n: number) => n.toLocaleString('id-ID');
const fmtBil = (n: number) => {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return fmt(n);
};

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

const tableHeader: React.CSSProperties = {
  fontSize: '0.6rem', fontWeight: 600, color: '#8B949E',
  letterSpacing: '0.04em', textTransform: 'uppercase', padding: '0.3rem 0.4rem',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  position: 'sticky', top: 0, background: 'rgba(20,28,40,0.95)', zIndex: 1,
};

const tableRow: React.CSSProperties = {
  fontSize: '0.72rem', padding: '0.25rem 0.4rem', borderBottom: '1px solid rgba(255,255,255,0.03)',
};

export default function OrderTape({ trades }: OrderTapeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [trades]);

  return (
    <GlassCard title="Order Tape" icon={<Activity size={13} />} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }} bodyStyle={{ padding: 0 }}>
      <div ref={scrollRef} style={{ overflowY: 'auto', flex: 1, maxHeight: 'calc(100vh - 320px)', minHeight: 280 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ ...tableHeader, width: '56px' }}>Waktu</th>
              <th style={{ ...tableHeader, width: '52px' }}>Kode</th>
              <th style={{ ...tableHeader, width: '80px' }}>Harga (+/-)</th>
              <th style={{ ...tableHeader, width: '40px', textAlign: 'right' }}>Lot</th>
              <th style={{ ...tableHeader, width: '60px', textAlign: 'right' }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: '#8B949E', padding: '2rem 0.5rem', fontSize: '0.75rem' }}>
                  <Clock size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                  Menunggu transaksi...
                </td>
              </tr>
            )}
            {trades.map((t, i) => {
              const isUp = t.direction === 'up';
              const isDown = t.direction === 'down';
              const isHaka = t.tradeType === 'HAKA';
              const isHaki = t.tradeType === 'HAKI';
              const priceColor = isHaka ? '#00E676' : isHaki ? '#EF5350' : isUp ? 'var(--trade-up)' : isDown ? 'var(--trade-down)' : 'var(--text-secondary)';
              return (
                <tr
                  key={t.id}
                  style={{
                    ...tableRow,
                    animation: i === 0 ? 'slideIn 0.25s ease' : 'none',
                    background: i === 0
                      ? isUp || isHaka ? 'rgba(0,200,83,0.06)' : isDown || isHaki ? 'rgba(255,61,0,0.06)' : 'transparent'
                      : 'transparent',
                  }}
                >
                  <td style={{ ...mono, color: '#8B949E', fontSize: '0.65rem' }}>{t.time}</td>
                  <td style={{ fontWeight: 600, fontSize: '0.72rem', color: '#E6EDF3' }}>{t.ticker}</td>
                  <td style={{ ...mono, color: priceColor, fontWeight: 600 }}>
                    {fmt(t.price)}
                    <span style={{ fontSize: '0.6rem', marginLeft: '0.15rem' }}>
                      {isHaka ? '▲' : isHaki ? '▼' : ''}
                    </span>
                  </td>
                  <td style={{ ...mono, textAlign: 'right', fontSize: '0.68rem', color: '#E6EDF3' }}>{t.lot.toLocaleString('id-ID')}</td>
                  <td style={{ ...mono, textAlign: 'right', fontSize: '0.68rem', color: '#E6EDF3' }}>{fmtBil(t.value)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{
        padding: '0.35rem 0.75rem', borderTop: '1px solid rgba(255,255,255,0.06)',
        fontSize: '0.65rem', color: '#8B949E', display: 'flex', justifyContent: 'space-between',
      }}>
        <span>{trades.length} transaksi terakhir</span>
        <span style={{ display: 'flex', gap: '0.75rem' }}>
          <span><span style={{ color: 'var(--trade-up)' }}>▲</span> HAKA</span>
          <span><span style={{ color: 'var(--trade-down)' }}>▼</span> HAKI</span>
          <span style={{ color: '#8B949E' }}>◆</span> MATCH</span>
      </div>
    </GlassCard>
  );
}
