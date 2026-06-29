import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Building2 } from 'lucide-react';
import GlassCard from './GlassCard';
import { API_BASE } from '../config';

interface BrokerEntry {
  id: string;
  code: string;
  name: string;
  totalValue: number;
  buyValue: number;
  sellValue: number;
  netValue: number;
}

// ── Consistent broker colours ────────────────────────────
const BROKER_COLORS = [
  '#2962FF', '#FF6D00', '#00C853', '#D500F9', '#00BCD4',
  '#FF1744', '#76FF03', '#FF9100', '#E040FB', '#00E676',
  '#448AFF', '#FFD600', '#18FFFF', '#651FFF', '#69F0AE',
];

function brokerColor(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = code.charCodeAt(i) + ((hash << 5) - hash);
  return BROKER_COLORS[Math.abs(hash) % BROKER_COLORS.length];
}

function formatValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e12) return (v / 1e12).toFixed(1) + 'T';
  if (abs >= 1e9) return (v / 1e9).toFixed(1) + 'M';
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'B';
  return v.toLocaleString('id-ID');
}

export default function TopBrokerPanel() {
  const [brokers, setBrokers] = useState<BrokerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/brokers/top`)
      .then(r => r.json())
      .then(d => {
        setBrokers(d.brokers || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <GlassCard title="Top Broker" icon={<Building2 size={13} />}>
      {/* Date navigation (disabled placeholder) */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '0.5rem', fontSize: '0.6rem', color: '#8B949E',
      }}>
        <button disabled style={{ background: 'none', border: 'none', cursor: 'not-allowed', opacity: 0.35, color: '#8B949E', padding: '0.2rem' }}>
          <ChevronLeft size={14} />
        </button>
        <span style={{ fontWeight: 600, fontSize: '0.65rem', color: '#E6EDF3' }}>Hari ini</span>
        <button disabled style={{ background: 'none', border: 'none', cursor: 'not-allowed', opacity: 0.35, color: '#8B949E', padding: '0.2rem' }}>
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Table header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '20px 36px 1fr 50px 50px',
        gap: '0.2rem', padding: '0.25rem 0.35rem',
        fontSize: '0.55rem', color: '#8B949E', fontWeight: 600,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        textTransform: 'uppercase', letterSpacing: '0.03em',
      }}>
        <span>#</span>
        <span>Code</span>
        <span>Sekuritas</span>
        <span style={{ textAlign: 'right' }}>T.val</span>
        <span style={{ textAlign: 'right' }}>N.val</span>
      </div>

      {/* Rows */}
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '1rem', color: '#8B949E', fontSize: '0.7rem' }}>Memuat...</div>
        ) : brokers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1rem', color: '#8B949E', fontSize: '0.7rem' }}>Belum ada data broker</div>
        ) : brokers.map((b, i) => (
          <div
            key={b.id}
            style={{
              display: 'grid', gridTemplateColumns: '20px 36px 1fr 50px 50px',
              gap: '0.2rem', padding: '0.3rem 0.35rem',
              fontSize: '0.62rem', alignItems: 'center',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ color: '#8B949E', fontSize: '0.55rem' }}>{i + 1}</span>
            <span style={{
              background: brokerColor(b.code),
              borderRadius: '0.2rem', padding: '0.1rem 0.25rem',
              color: '#fff', fontWeight: 700, fontSize: '0.6rem',
              textAlign: 'center', fontFamily: 'var(--font-mono)',
            }}>
              {b.code}
            </span>
            <span style={{ color: '#E6EDF3', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.name}>
              {b.name}
            </span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#E6EDF3', fontSize: '0.6rem' }}>
              {formatValue(b.totalValue)}
            </span>
            <span style={{
              textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.6rem',
              color: b.netValue >= 0 ? 'var(--trade-up)' : 'var(--trade-down)',
            }}>
              {formatValue(b.netValue)}
            </span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
