import GlassCard from './GlassCard';
import { Calendar, Clock } from 'lucide-react';

interface MarketCalendarProps {
  marketStatus: string; // "OPEN" | "CLOSED" | "LOADING"
}

export default function MarketCalendar({ marketStatus }: MarketCalendarProps) {
  const isOpen = marketStatus === 'OPEN';

  return (
    <GlassCard title="Pasar" icon={<Calendar size={13} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {/* Status Badge */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: isOpen ? 'rgba(0,200,83,0.08)' : 'rgba(255,61,0,0.08)',
          borderRadius: '0.5rem', padding: '0.5rem 0.75rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: isOpen ? 'var(--trade-up)' : 'var(--trade-down)',
              boxShadow: isOpen ? '0 0 8px rgba(0,200,83,0.6)' : 'none',
            }} />
            <span style={{ fontWeight: 700, fontSize: '0.8rem', letterSpacing: '0.03em' }}>
              {isOpen ? 'BURSA DIBUKA' : 'BURSA DITUTUP'}
            </span>
          </div>
          <span style={{
            fontSize: '0.7rem', fontFamily: 'var(--font-mono)', fontWeight: 600,
            color: isOpen ? 'var(--trade-up)' : 'var(--trade-down)',
            padding: '0.15rem 0.4rem', borderRadius: '0.2rem',
            background: isOpen ? 'rgba(0,200,83,0.12)' : 'rgba(255,61,0,0.12)',
          }}>
            {isOpen ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>

        {/* Trading Hours */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <div style={{ fontSize: '0.65rem', color: '#8B949E', fontWeight: 600, marginBottom: '0.1rem' }}>
            <Clock size={11} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
            Jam Perdagangan
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem',
          }}>
            {[
              { sesi: 'Sesi I', jam: '09:00 - 12:00', status: 'WIB' },
              { sesi: 'Sesi II', jam: '13:30 - 16:00', status: 'WIB' },
            ].map(s => (
              <div key={s.sesi} style={{
                background: 'rgba(255,255,255,0.03)', borderRadius: '0.3rem',
                padding: '0.35rem 0.5rem', textAlign: 'center',
              }}>
                <div style={{ fontSize: '0.6rem', color: '#8B949E', fontWeight: 600 }}>{s.sesi}</div>
                <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#E6EDF3' }}>
                  {s.jam}
                </div>
                <div style={{ fontSize: '0.55rem', color: '#5E6278' }}>{s.status}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Current time */}
        <div style={{
          fontSize: '0.7rem', color: '#8B949E', textAlign: 'center',
          padding: '0.3rem', borderTop: '1px solid rgba(255,255,255,0.05)',
          fontFamily: 'var(--font-mono)',
        }}>
          {new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' })} WIB
        </div>
      </div>
    </GlassCard>
  );
}
