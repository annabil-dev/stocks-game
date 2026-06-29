import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Clock, Search, TrendingUp, TrendingDown } from 'lucide-react';
import { useUser } from './UserContext';
import { ToastProvider } from './ToastContext';
import './App.css';
import Dashboard from './pages/Dashboard';
import TradingPlatform from './pages/TradingPlatform';
import Portfolio from './pages/Portfolio';
import SingleStockView from './pages/SingleStockView';
import FastOrder from './components/FastOrder';
import TickerTape from './components/TickerTape';
import Sidebar from './components/Sidebar';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3002';
export const socket = io(BACKEND_URL);

// ── Stock selector modal (for BUY/SELL quick order) ──────
function StockSelector({
  stocks, side, onClose,
}: {
  stocks: { ticker: string; name: string; lastPrice: number; changePercent?: number }[];
  side: 'BUY' | 'SELL';
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '4rem' }}>
      <div
        ref={ref}
        style={{
          background: 'rgba(20,28,40,0.97)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '0.75rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          width: 320,
          maxHeight: 420,
          overflow: 'hidden',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div style={{
          padding: '0.6rem 1rem',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          fontSize: '0.8rem', fontWeight: 700,
          color: side === 'BUY' ? 'var(--trade-up)' : 'var(--trade-down)',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {side} — Pilih Saham
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {stocks.map(s => (
            <div
              key={s.ticker}
              onClick={() => { navigate(`/trade/${s.ticker}.JK`); onClose(); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.5rem 1rem', cursor: 'pointer',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                fontSize: '0.75rem', transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div>
                <div style={{ fontWeight: 700, color: '#E6EDF3' }}>{s.ticker}</div>
                <div style={{ fontSize: '0.62rem', color: '#8B949E' }}>{s.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-mono)', color: '#E6EDF3' }}>
                  Rp{s.lastPrice.toLocaleString('id-ID')}
                </div>
                {s.changePercent !== undefined && (
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.62rem',
                    color: s.changePercent >= 0 ? 'var(--trade-up)' : 'var(--trade-down)',
                  }}>
                    {s.changePercent >= 0 ? '+' : ''}{s.changePercent.toFixed(2)}%
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── App Content ──────────────────────────────────────────
function AppContent() {
  const [marketStatus, setMarketStatus] = useState('LOADING');
  const [liquidityMode, setLiquidityMode] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM');
  const [stockList, setStockList] = useState<{ ticker: string; name: string; lastPrice: number }[]>([]);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [showSellModal, setShowSellModal] = useState(false);
  const navigate = useNavigate();
  const { user } = useUser();

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/market-status`)
      .then(res => res.json())
      .then(data => setMarketStatus(data.status))
      .catch(() => {});

    fetch(`${BACKEND_URL}/api/liquidity-mode`)
      .then(res => res.json())
      .then(data => setLiquidityMode(data.mode))
      .catch(() => {});

    // Fetch stock list for BUY/SELL modal
    fetch(`${BACKEND_URL}/api/stocks`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setStockList(data);
      })
      .catch(() => {});

    socket.on('market_status', (data) => {
      setMarketStatus(data.status);
    });

    socket.on('LIQUIDITY_CHANGED', (data) => {
      setLiquidityMode(data.mode);
    });

    return () => {
      socket.off('market_status');
      socket.off('liquidity_mode_changed');
    };
  }, []);

  // Compute changePercent for stock selector display
  const stocksWithChange = stockList.map(s => ({
    ...s,
    changePercent: 0, // simplified — real calc needs previousClose
  }));

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-area">
        {/* Top Bar */}
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-search">
              <Search size={16} className="text-muted" />
              <input
                type="text"
                placeholder="Cari saham..."
                onKeyPress={e => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      const clean = val.includes('.JK') ? val : `${val}.JK`;
                      navigate(`/stock/${clean.replace('.JK', '')}`);
                    }
                  }
                }}
              />
            </div>
          </div>
          <div className="topbar-right">
            {/* BUY / SELL buttons */}
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <button
                onClick={() => setShowBuyModal(true)}
                style={{
                  padding: '0.3rem 0.75rem', borderRadius: '0.3rem',
                  border: 'none', fontWeight: 700, fontSize: '0.75rem',
                  background: 'var(--trade-up)', color: '#fff',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
                  transition: 'opacity 0.15s',
                  fontFamily: 'var(--font-sans)',
                  textTransform: 'uppercase', letterSpacing: '0.03em',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                <TrendingUp size={14} />
                BUY
              </button>
              <button
                onClick={() => setShowSellModal(true)}
                style={{
                  padding: '0.3rem 0.75rem', borderRadius: '0.3rem',
                  border: 'none', fontWeight: 700, fontSize: '0.75rem',
                  background: 'var(--trade-down)', color: '#fff',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
                  transition: 'opacity 0.15s',
                  fontFamily: 'var(--font-sans)',
                  textTransform: 'uppercase', letterSpacing: '0.03em',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                <TrendingDown size={14} />
                SELL
              </button>
            </div>

            <div className="glass-panel topbar-badge">
              <Clock size={16} className="text-muted" />
              <span
                className="topbar-market-status"
                style={{ color: marketStatus === 'OPEN' ? 'var(--trade-up)' : 'var(--text-secondary)' }}
              >
                MARKET {marketStatus}
              </span>
            </div>

            <div className="glass-panel topbar-badge">
              <span
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: liquidityMode === 'HIGH' ? 'var(--trade-up)' : liquidityMode === 'LOW' ? 'var(--trade-down)' : 'var(--text-secondary)',
                }}
              >
                LIQUIDITY {liquidityMode}
              </span>
            </div>

            <div className="topbar-user">
              <div className="topbar-cash">
                <div className="text-sm text-muted" style={{ fontWeight: 600 }}>CASH</div>
                <div className="topbar-cash-value">
                  Rp {user ? user.cashBalance.toLocaleString('id-ID') : '...'}
                </div>
              </div>
              <div className="topbar-avatar">PL</div>
            </div>
          </div>
        </header>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/trade/:ticker" element={<TradingPlatform />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/stock/:ticker" element={<SingleStockView />} />
          </Routes>
        </main>
      </div>

      {/* Stock selector modals */}
      {showBuyModal && (
        <StockSelector stocks={stockList} side="BUY" onClose={() => setShowBuyModal(false)} />
      )}
      {showSellModal && (
        <StockSelector stocks={stockList} side="SELL" onClose={() => setShowSellModal(false)} />
      )}

      {/* Global Fast Order / Ticker */}
      {user && <FastOrder />}
      <TickerTape />
    </div>
  );
}

// ── App Root ─────────────────────────────────────────────
function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
