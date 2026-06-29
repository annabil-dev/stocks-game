import { useEffect, useState } from 'react';
import GlassCard from './GlassCard';
import { useUser } from '../UserContext';
import { API_BASE } from '../config';
import { Bot, Activity, Target } from 'lucide-react';

interface BotData {
  id: string;
  type: string;
  stockFocus: string | null;
  active: boolean;
  createdAt: string;
}

export default function BotActivity() {
  const { user } = useUser();
  const [bots, setBots] = useState<BotData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    fetch(`${API_BASE}/bots/${user.id}`)
      .then(r => r.json())
      .then(data => {
        setBots(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [user?.id]);

  const activeBots = bots.filter(b => b.active);
  const normalCount = activeBots.filter(b => b.type === 'NORMAL').length;
  const institutionCount = activeBots.filter(b => b.type === 'INSTITUTION').length;
  const focusedStocks = activeBots.filter(b => b.stockFocus).map(b => b.stockFocus);

  return (
    <GlassCard title="Bot Activity" icon={<Bot size={13} />}>
      {!user ? (
        <div style={{ textAlign: 'center', padding: '1rem', color: '#8B949E', fontSize: '0.75rem' }}>
          Login dulu untuk melihat bot
        </div>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: '1rem', color: '#8B949E', fontSize: '0.75rem' }}>
          Memuat data bot...
        </div>
      ) : bots.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '1rem', color: '#8B949E', fontSize: '0.75rem' }}>
          <Bot size={24} style={{ opacity: 0.3, marginBottom: '0.4rem' }} />
          <div>Belum punya bot</div>
          <div style={{ fontSize: '0.65rem', marginTop: '0.25rem' }}>
            Beli bot di halaman Portfolio
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {/* Counts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
            <div style={{ background: 'rgba(79,70,229,0.08)', borderRadius: '0.4rem', padding: '0.4rem 0.5rem' }}>
              <div style={{ fontSize: '0.6rem', color: '#8B949E', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Activity size={11} /> Total Aktif
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#E6EDF3' }}>
                {activeBots.length}
              </div>
            </div>
            <div style={{ background: 'rgba(0,200,83,0.08)', borderRadius: '0.4rem', padding: '0.4rem 0.5rem' }}>
              <div style={{ fontSize: '0.6rem', color: '#8B949E', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Target size={11} /> Fokus Saham
              </div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#E6EDF3' }}>
                {focusedStocks.length > 0 ? focusedStocks.join(', ') : 'Semua'}
              </div>
            </div>
          </div>

          {/* Type breakdown */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div style={{
              flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: '0.3rem',
              padding: '0.35rem 0.5rem', textAlign: 'center',
            }}>
              <div style={{ fontSize: '0.6rem', color: '#8B949E', fontWeight: 600 }}>NORMAL</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#2962FF' }}>{normalCount}</div>
            </div>
            <div style={{
              flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: '0.3rem',
              padding: '0.35rem 0.5rem', textAlign: 'center',
            }}>
              <div style={{ fontSize: '0.6rem', color: '#8B949E', fontWeight: 600 }}>INSTITUTION</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#FF6D00' }}>{institutionCount}</div>
            </div>
          </div>

          {/* Bot list */}
          <div style={{ maxHeight: 120, overflowY: 'auto' }}>
            {activeBots.map(b => (
              <div key={b.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.25rem 0.4rem', borderRadius: '0.25rem',
                fontSize: '0.68rem', borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}>
                <span style={{
                  fontWeight: 600,
                  color: b.type === 'INSTITUTION' ? '#FF6D00' : '#2962FF',
                }}>
                  {b.type === 'INSTITUTION' ? '🏦' : '🤖'} {b.type}
                </span>
                <span style={{ color: '#8B949E', fontSize: '0.62rem' }}>
                  {b.stockFocus || 'Semua saham'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  );
}
