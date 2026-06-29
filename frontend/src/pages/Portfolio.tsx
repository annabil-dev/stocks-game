import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Bot } from 'lucide-react';
import { useUser } from '../UserContext';
import { API_BASE } from '../config';
import { useToast } from '../ToastContext';
import EquityChart from '../components/portfolio/EquityChart';
import ReturnComparisonChart from '../components/portfolio/ReturnComparisonChart';
import EquityHistoryTable from '../components/portfolio/EquityHistoryTable';
import AllocationDonut from '../components/portfolio/AllocationDonut';
import TradeSummaryPanel from '../components/portfolio/TradeSummaryPanel';

// ── Helpers ────────────────────────────────────────────────
const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
const fmtNum = (n: number) => n.toLocaleString('id-ID');

interface Holding {
  stockId?: string;
  ticker: string;
  name?: string;
  quantity: number;
  avgPrice: number;
  lastPrice: number;
  value: number;
  profitLoss: number;
  changePct: number;
  percentage?: number;
}

interface OpenOrder {
  id: string;
  side: 'BID' | 'OFFER';
  price: number;
  remainingQty: number;
  status: string;
  createdAt: string;
  stock?: { ticker: string };
  ticker?: string;
}

interface BotInfo {
  id: string;
  type: string;
  stockFocus: string | null;
  active: boolean;
  createdAt: string;
}

const normOrders = (data: any): OpenOrder[] => {
  const arr = Array.isArray(data) ? data : (data?.orders ?? []);
  return arr.map((o: any) => ({
    id: o.id,
    side: o.side,
    price: Number(o.price),
    remainingQty: o.remainingQty ?? o.remainingQuantity ?? (o.quantity != null ? o.quantity - (o.filledQty ?? 0) : 0),
    status: o.status,
    createdAt: o.createdAt,
    stock: o.stock,
    ticker: o.ticker,
  }));
};

// ── Tab bar ────────────────────────────────────────────────
const PORTFOLIO_TABS = [
  { key: 'stocks', label: 'Stocks', pct: '100%', description: 'Equities' },
  { key: 'bonds', label: 'Bonds', pct: '0%', description: 'Coming soon', disabled: true },
  { key: 'all', label: 'All Portfolio', pct: '100%', description: 'Combined view' },
];

// ── Main Component ─────────────────────────────────────────
export default function Portfolio() {
  const { user, refreshUser } = useUser();
  const toast = useToast();

  // Tab state
  const [activeTab, setActiveTab] = useState('stocks');

  // Data states
  const [equitySnapshots, setEquitySnapshots] = useState<any[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // Equity chart range
  const [eqRange, setEqRange] = useState('1M');

  // Fetch all data
  useEffect(() => {
    if (!user) return;
    const uid = user.id;
    let done = 0;
    const checkDone = () => { if (++done >= 3) setLoading(false); };

    // Equity history (new endpoint)
    fetch(`${API_BASE}/portfolio/${uid}/equity-history?range=${eqRange}`)
      .then(r => r.json())
      .then(d => setEquitySnapshots(d?.snapshots ?? []))
      .catch(console.error)
      .finally(checkDone);

    // Holdings
    fetch(`${API_BASE}/portfolio/${uid}`)
      .then(r => r.json())
      .then(setHoldings)
      .catch(console.error)
      .finally(checkDone);

    // Bots
    fetch(`${API_BASE}/bots/${uid}`)
      .then(r => r.json())
      .then(setBots)
      .catch(console.error)
      .finally(checkDone);
  }, [user, eqRange]);

  // Open orders (poll every 5s)
  useEffect(() => {
    if (!user) return;
    const uid = user.id;
    const load = () => {
      fetch(`${API_BASE}/orders?userId=${uid}&status=OPEN,PARTIAL`)
        .then(r => r.json())
        .then((data: any) => setOpenOrders(normOrders(data)))
        .catch(console.error);
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [user]);

  const cancelOrder = useCallback(async (orderId: string) => {
    if (!user) return;
    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.addToast(data.error || 'Gagal membatalkan order', 'error');
        return;
      }
      toast.addToast('Order berhasil dibatalkan', 'success');
      refreshUser();
      setOpenOrders(prev => prev.filter(o => o.id !== orderId));
      if (user) {
        fetch(`${API_BASE}/portfolio/${user.id}`)
          .then(r => r.json())
          .then(setHoldings)
          .catch(console.error);
      }
    } catch {
      toast.addToast('Gagal membatalkan order. Cek koneksi.', 'error');
    }
  }, [user, toast, refreshUser]);

  // Bot purchase
  const buyBot = async (type: 'NORMAL' | 'INSTITUTION') => {
    if (!user) return;
    const price = type === 'INSTITUTION' ? 50000000 : 5000000;
    if (user.cashBalance < price) {
      toast.addToast(`Saldo tidak cukup. Butuh ${fmtRp(price)}`, 'error');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/bots/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, type, stockFocus: null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.addToast(data.error || 'Gagal membeli bot', 'error');
        return;
      }
      toast.addToast(`Bot ${type} berhasil dibeli!`, 'success');
      // Refresh bots
      fetch(`${API_BASE}/bots/${user.id}`)
        .then(r => r.json())
        .then(setBots)
        .catch(console.error);
    } catch {
      toast.addToast('Error buying bot', 'error');
    }
  };

  // Derived totals
  const totalEquity = equitySnapshots.length > 0
    ? Number(equitySnapshots[equitySnapshots.length - 1].totalEquity)
    : (user?.cashBalance ?? 0);

  const equityChartData = useMemo(() =>
    equitySnapshots.map((s: any) => ({ time: s.createdAt, equity: Number(s.totalEquity) })),
    [equitySnapshots]
  );

  // Loading
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--accent-primary)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
        <span className="text-muted">Loading portfolio...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ═══ HEADER + TOTAL EQUITY ═══ */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-display)', marginBottom: 4 }}>
              Portfolio
            </h1>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {fmtRp(totalEquity)}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ TAB BAR ═══ */}
      <div style={{
        display: 'flex',
        gap: 4,
        marginBottom: 16,
        padding: 4,
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 10,
      }}>
        {PORTFOLIO_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => !tab.disabled && setActiveTab(tab.key)}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '10px 16px',
              borderRadius: 8,
              border: 'none',
              cursor: tab.disabled ? 'not-allowed' : 'pointer',
              background: activeTab === tab.key ? 'rgba(79,70,229,0.15)' : 'transparent',
              color: activeTab === tab.key ? 'var(--accent-primary)' : tab.disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
              fontWeight: activeTab === tab.key ? 700 : 500,
              fontSize: '0.85rem',
              opacity: tab.disabled ? 0.4 : 1,
              transition: 'all 0.15s',
            }}
            title={tab.description}
          >
            <span>{tab.label}</span>
            <span style={{
              fontSize: '0.7rem',
              padding: '1px 6px',
              borderRadius: 4,
              background: activeTab === tab.key ? 'var(--accent-primary)' : 'rgba(255,255,255,0.08)',
              color: activeTab === tab.key ? '#fff' : 'var(--text-muted)',
              fontWeight: 700,
            }}>
              {tab.pct}
            </span>
          </button>
        ))}
      </div>

      {/* ═══ SUB TAB: Performance (default active) ═══ */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginBottom: 16,
        borderBottom: '1px solid var(--border-color)',
        paddingBottom: 8,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          borderRadius: 8,
          background: 'rgba(79,70,229,0.12)',
          color: 'var(--accent-primary)',
          fontWeight: 600,
          fontSize: '0.85rem',
          cursor: 'default',
        }}>
          <TrendingUp size={16} />
          <span>Performance</span>
        </div>
      </div>

      {/* ═══ 3-COLUMN GRID ═══ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '3fr 1.5fr 1fr',
        gap: 16,
        marginBottom: 16,
      }}>
        {/* LEFT COLUMN (~55%) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <EquityChart
            data={equityChartData}
            isLoading={loading}
            range={eqRange}
            onRangeChange={setEqRange}
          />
          <ReturnComparisonChart
            equityData={equityChartData}
            isLoading={loading}
          />
        </div>

        {/* MIDDLE COLUMN (~27%) */}
        <div>
          <EquityHistoryTable
            snapshots={equitySnapshots}
            isLoading={loading}
          />
        </div>

        {/* RIGHT COLUMN (~18%) */}
        <div>
          <AllocationDonut
            holdings={holdings.map(h => ({
              ticker: h.ticker,
              value: h.value,
              quantity: h.quantity,
            }))}
            isLoading={loading}
          />
        </div>
      </div>

      {/* ═══ FULL WIDTH: TRADE SUMMARY ═══ */}
      {user && <TradeSummaryPanel userId={user.id} />}

      {/* ═══ FULL WIDTH: HOLDINGS TABLE ═══ */}
      <div className="glass-panel" style={{ padding: '1.25rem', marginTop: 16 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
          Holdings
        </div>
        {holdings.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  {['Ticker', 'Qty', 'Avg Price', 'Last Price', 'Value', 'P/L', 'P/L %'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: h === 'P/L' || h === 'P/L %' ? 'right' : 'left', fontWeight: 700, color: 'var(--text-muted)', fontSize: '0.75rem' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map(h => {
                  const pl = h.profitLoss ?? 0;
                  const plPct = h.changePct ?? 0;
                  const plColor = pl >= 0 ? 'var(--trade-up)' : 'var(--trade-down)';
                  return (
                    <tr key={h.ticker} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '8px 10px' }}><Link to={`/trade/${h.ticker}`} style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{h.ticker}</Link></td>
                      <td style={{ padding: '8px 10px' }}>{fmtNum(h.quantity)}</td>
                      <td style={{ padding: '8px 10px' }}>{fmtRp(h.avgPrice)}</td>
                      <td style={{ padding: '8px 10px' }}>{fmtRp(h.lastPrice)}</td>
                      <td style={{ padding: '8px 10px' }}>{fmtRp(h.value)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: plColor, fontWeight: 700 }}>{pl >= 0 ? '+' : ''}{fmtRp(pl)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: plColor, fontWeight: 700 }}>{plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-muted" style={{ padding: '2rem 0', textAlign: 'center', fontSize: '0.85rem' }}>
            Belum ada saham di portfolio.
          </div>
        )}
      </div>

      {/* ═══ FULL WIDTH: OPEN ORDERS ═══ */}
      <div className="glass-panel" style={{ padding: '1.25rem', marginTop: 16 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
          Open Orders
        </div>
        {openOrders.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  {['Ticker', 'Side', 'Price', 'Remaining', 'Status', 'Created', ''].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', fontSize: '0.75rem' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openOrders.map(o => {
                  const ticker = o.stock?.ticker ?? o.ticker ?? '-';
                  return (
                    <tr key={o.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '8px 10px' }}><Link to={`/trade/${ticker}`} style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{ticker}</Link></td>
                      <td style={{ padding: '8px 10px' }}><span style={{ color: o.side === 'BID' ? 'var(--trade-up)' : 'var(--trade-down)', fontWeight: 700 }}>{o.side}</span></td>
                      <td style={{ padding: '8px 10px' }}>{fmtRp(o.price)}</td>
                      <td style={{ padding: '8px 10px' }}>{fmtNum(o.remainingQty)}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{o.status}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{new Date(o.createdAt).toLocaleString('id-ID')}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <button onClick={() => cancelOrder(o.id)} style={{ padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 6, border: '1px solid var(--trade-down)', background: 'rgba(255,61,0,0.12)', color: 'var(--trade-down)', cursor: 'pointer' }}>Cancel</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-muted" style={{ padding: '2rem 0', textAlign: 'center', fontSize: '0.85rem' }}>
            Tidak ada open order.
          </div>
        )}
      </div>

      {/* ═══ BOT SHOP ═══ */}
      <div className="glass-panel" style={{ padding: '1.25rem', marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Bot size={20} style={{ color: 'var(--accent-primary)' }} />
          <div style={{ fontSize: '1rem', fontWeight: 700 }}>Bot Shop</div>
          <span className="text-muted" style={{ fontSize: '0.75rem', marginLeft: 8 }}>
            Auto-trading bots for passive profit
          </span>
        </div>

        {bots.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {bots.map(b => (
              <div key={b.id} style={{
                padding: '6px 12px',
                borderRadius: 8,
                background: b.active ? 'rgba(0,200,83,0.1)' : 'rgba(255,61,0,0.1)',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: b.active ? 'var(--trade-up)' : 'var(--trade-down)',
                border: `1px solid ${b.active ? 'rgba(0,200,83,0.2)' : 'rgba(255,61,0,0.2)'}`,
              }}>
                {b.type} · {b.stockFocus || 'All'}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{
            flex: '1 1 200px',
            padding: 12,
            borderRadius: 8,
            background: 'rgba(79,70,229,0.08)',
            border: '1px solid rgba(79,70,229,0.2)',
          }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>Normal Bot</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              Conservative market maker
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
              {fmtRp(5000000)}
            </div>
            <button className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '6px 12px' }} onClick={() => buyBot('NORMAL')}>
              Buy
            </button>
          </div>
          <div style={{
            flex: '1 1 200px',
            padding: 12,
            borderRadius: 8,
            background: 'rgba(0,200,83,0.08)',
            border: '1px solid rgba(0,200,83,0.2)',
          }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>Institution Bot</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              Big block trader, high volume
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
              {fmtRp(50000000)}
            </div>
            <button className="btn btn-success" style={{ fontSize: '0.8rem', padding: '6px 12px' }} onClick={() => buyBot('INSTITUTION')}>
              Buy
            </button>
          </div>
        </div>
      </div>

      {/* ═══ Responsive override ═══ */}
      <style>{`
        @media (max-width: 1024px) {
          [style*="grid-template-columns: 3fr 1.5fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
