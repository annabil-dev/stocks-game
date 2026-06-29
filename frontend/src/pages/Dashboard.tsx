import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, TrendingUp, RefreshCw, Bot } from 'lucide-react';
import OrderTape from '../components/OrderTape';
import type { TradeTapeEntry } from '../components/OrderTape';
import IndexComposite from '../components/IndexComposite';
import type { CompositeStats } from '../components/IndexComposite';
import MarketCalendar from '../components/MarketCalendar';
import TrendingPanel from '../components/TrendingPanel';
import TopBrokerPanel from '../components/TopBrokerPanel';
import { socket } from '../App';
import { API_BASE } from '../config';
import { useUser } from '../UserContext';
import BotActivity from '../components/BotActivity';
import { Link } from 'react-router-dom';

interface Stock {
  id: string; ticker: string; name: string;
  initialPrice: number; lastPrice: number; previousClose: number;
}

interface TradeVolume {
  volume: number; value: number; tradeCount: number;
}

export interface MoverItem {
  ticker: string; name: string; price: number;
  changePercent: number; volume: number; value: number;
}

const fmtBil = (n: number) => {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString('id-ID');
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [marketStatus, setMarketStatus] = useState('LOADING');
  const [tape, setTape] = useState<TradeTapeEntry[]>([]);
  const [compositeHistory, setCompositeHistory] = useState<{ time: string; value: number }[]>([]);
  const [tradeVolumes, setTradeVolumes] = useState<Record<string, TradeVolume>>({});
  const [botCollapsed, setBotCollapsed] = useState(true);
  const { user } = useUser();

  // ── Refs for socket sync ──
  const stocksRef = useRef(stocks);
  stocksRef.current = stocks;
  const priceRef = useRef<Record<string, number>>({});
  const subscribedRef = useRef(false);
  const compositePushRef = useRef<number[]>([]);
  const timeLabelsRef = useRef<string[]>([]);
  const tapeRef = useRef<TradeTapeEntry[]>([]);
  const persistenceLoaded = useRef({ openSet: false });

  const openRef = useRef(0);
  const highRef = useRef(0);
  const lowRef = useRef(0);
  const totalValRef = useRef(0);
  const totalVolRef = useRef(0);
  const totalFreqRef = useRef(0);
  const volumeRef = useRef<Record<string, TradeVolume>>({});

  // ── Initial fetch ──
  useEffect(() => {
    let mounted = true;

    fetch(`${API_BASE}/stocks`)
      .then(r => r.json())
      .then((data: Stock[]) => {
        if (!mounted) return;
        const arr = Array.isArray(data) ? data : [];
        setStocks(arr);
        const prices: Record<string, number> = {};
        arr.forEach(s => { prices[s.id] = s.lastPrice; });
        priceRef.current = prices;

        // Subscribe each stock
        if (!subscribedRef.current) {
          arr.forEach(s => socket.emit('subscribe', s.id));
          subscribedRef.current = true;
        }
      })
      .catch(() => {});

    fetch(`${API_BASE}/market-status`)
      .then(r => r.json())
      .then(d => mounted && setMarketStatus(d.status || 'CLOSED'))
      .catch(() => {});

    fetch(`${API_BASE}/market/volumes`)
      .then(r => r.json())
      .then(data => {
        if (!mounted) return;
        const vol = (typeof data === 'object' && data !== null) ? data : {};
        volumeRef.current = vol as Record<string, TradeVolume>;
        setTradeVolumes(vol as Record<string, TradeVolume>);
      })
      .catch(() => {});

    // Load persisted data from sessionStorage (survives page refresh)
    const savedRaw = sessionStorage.getItem('stocks_dash_v1');
    if (savedRaw) {
      try {
        const saved = JSON.parse(savedRaw);
        if (saved.compositePush?.length) {
          compositePushRef.current = saved.compositePush;
          setCompositeHistory(saved.compositePush.map((v: number, i: number) => ({
            time: saved.timeLabels?.[i] || `${String(Math.floor(i/2)).padStart(2,'0')}:${String((i%2)*30).padStart(2,'0')}`,
            value: v,
          })));
        }
        if (saved.tape?.length) {
          tapeRef.current = saved.tape;
          setTape(saved.tape);
        }
        if (saved.timeLabels?.length) timeLabelsRef.current = saved.timeLabels;
        if (saved.openRef) openRef.current = saved.openRef;
        if (saved.highRef) highRef.current = saved.highRef;
        if (saved.lowRef) lowRef.current = saved.lowRef;
        if (saved.totalValRef) totalValRef.current = saved.totalValRef;
        if (saved.totalVolRef) totalVolRef.current = saved.totalVolRef;
        if (saved.totalFreqRef) totalFreqRef.current = saved.totalFreqRef;
        if (saved.volumeRef) volumeRef.current = saved.volumeRef;
      } catch {}
    }
    persistenceLoaded.current.openSet = true;

    return () => {
      mounted = false;
      const current = stocksRef.current;
      current.forEach(s => socket.emit('unsubscribe', s.id));
      subscribedRef.current = false;
    };
  }, []);

  // ── Socket listeners + unified sync (500ms) ──
  // Also pushes composite data point on every price change (realtime chart)
  useEffect(() => {
    const handlePrice = (p: { stockId: string; price: number }) => {
      priceRef.current[p.stockId] = p.price;
    };

    // ── Unified sync tick: prices→stocks, composite push, volumes sync, persist ──
    const syncInterval = setInterval(() => {
      const current = stocksRef.current;
      if (current.length === 0) return;

      // 1. Compute latest prices from priceRef
      const updated = current.map(s => ({
        ...s,
        lastPrice: priceRef.current[s.id] ?? s.lastPrice,
      }));

      // 2. Composite calculation
      const sum = updated.reduce((a, s) => a + s.lastPrice, 0);
      const avg = Math.round((sum / updated.length) * 100) / 100;

      if (openRef.current === 0) openRef.current = avg;
      if (avg > highRef.current) highRef.current = avg;
      if (lowRef.current === 0 || avg < lowRef.current) lowRef.current = avg;

      // 3. Push composite data point IF value changed (event-driven feel)
      const prevVal = compositePushRef.current[compositePushRef.current.length - 1];
      if (prevVal !== avg) {
        const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const ts = `${String(nowWib.getHours()).padStart(2, '0')}:${String(nowWib.getMinutes()).padStart(2, '0')}:${String(nowWib.getSeconds()).padStart(2, '0')}`;

        compositePushRef.current.push(avg);
        timeLabelsRef.current.push(ts);
        if (compositePushRef.current.length > 200) {
          compositePushRef.current.shift();
          timeLabelsRef.current.shift();
        }

        setCompositeHistory(compositePushRef.current.map((v, i) => ({
          time: timeLabelsRef.current[i] || ts,
          value: v,
        })));
      }

      // 4. Sync stocks state
      setStocks(updated);

      // 5. Sync trade volumes → state (so movers/trending get live data)
      setTradeVolumes({ ...volumeRef.current });

      // 6. Persist to sessionStorage (survives page refresh)
      try {
        sessionStorage.setItem('stocks_dash_v1', JSON.stringify({
          compositePush: compositePushRef.current,
          timeLabels: timeLabelsRef.current,
          tape: tapeRef.current,
          openRef: openRef.current,
          highRef: highRef.current,
          lowRef: lowRef.current,
          totalValRef: totalValRef.current,
          totalVolRef: totalVolRef.current,
          totalFreqRef: totalFreqRef.current,
          volumeRef: volumeRef.current,
        }));
      } catch {}
    }, 500);

    const handleTrade = (t: { stockId: string; ticker: string; price: number; quantity: number; tradeType: string }) => {
      const stocksNow = stocksRef.current;
      const s = stocksNow.find(x => x.id === t.stockId);
      if (!s) return;

      const dir = t.price > s.initialPrice ? 'up' : t.price < s.initialPrice ? 'down' : 'neutral';
      const now = new Date();
      const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
      const time = `${String(wib.getHours()).padStart(2, '0')}:${String(wib.getMinutes()).padStart(2, '0')}:${String(wib.getSeconds()).padStart(2, '0')} WIB`;

      const entry: TradeTapeEntry = {
        id: `${t.stockId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time, ticker: t.ticker, price: t.price, lot: Math.round(t.quantity / 100),
        value: t.price * t.quantity,
        tradeType: t.tradeType as 'MATCH' | 'HAKA' | 'HAKI',
        direction: dir,
      };

      setTape(prev => {
        const next = [entry, ...prev].slice(0, 50);
        tapeRef.current = next;
        return next;
      });

      // Accumulate volumes (refs, no re-render)
      const v = volumeRef.current;
      if (!v[t.stockId]) v[t.stockId] = { volume: 0, value: 0, tradeCount: 0 };
      v[t.stockId].volume += t.quantity;
      v[t.stockId].value += t.price * t.quantity;
      v[t.stockId].tradeCount += 1;

      totalVolRef.current += t.quantity;
      totalValRef.current += t.price * t.quantity;
      totalFreqRef.current += 1;
    };

    const handleMarketStatus = (s: { status: string }) => {
      setMarketStatus(s.status);
    };

    socket.on('lastPrice', handlePrice);
    socket.on('all:trade', handleTrade);
    socket.on('market_status', handleMarketStatus);

    return () => {
      socket.off('lastPrice', handlePrice);
      socket.off('all:trade', handleTrade);
      socket.off('market_status', handleMarketStatus);
      clearInterval(syncInterval);
    };
  }, []);

  // ── Derived composite stats ──
  const compositeStats: CompositeStats = useMemo(() => {
    const n = stocks.length || 1;
    const sum = stocks.reduce((a, s) => a + s.lastPrice, 0);
    const avg = Math.round((sum / n) * 100) / 100;
    const sumPrev = stocks.reduce((a, s) => a + s.previousClose, 0);
    const prevClose = Math.round((sumPrev / n) * 100) / 100;
    const change = Math.round((avg - prevClose) * 100) / 100;
    const changePercent = prevClose > 0 ? Math.round((change / prevClose) * 10000) / 100 : 0;

    // OHL dari compositePushRef yang sudah diakumulasi (tahan refresh via sessionStorage)
    const data = compositePushRef.current;
    // Load persisted opening once
    if (!persistenceLoaded.current.openSet) {
      const savedOpen = sessionStorage.getItem('ihsg_open');
      if (savedOpen) {
        const parsed = parseFloat(savedOpen);
        if (!isNaN(parsed)) openRef.current = parsed;
      }
      persistenceLoaded.current.openSet = true;
    }
    if (data.length > 0 && !persistenceLoaded.current.openSet) {
      openRef.current = data[0];
      sessionStorage.setItem('ihsg_open', String(data[0]));
    }
    const open = openRef.current;
    const high = data.length > 1 ? Math.round(Math.max(...data, avg) * 100) / 100 : avg;
    const low = data.length > 1 ? Math.round(Math.min(...data, avg) * 100) / 100 : avg;

    return {
      value: avg, change, changePercent,
      open, high, low,
      prevClose,
      totalVolume: totalVolRef.current,
      totalValue: totalValRef.current,
      totalTradeCount: totalFreqRef.current,
    };
  }, [stocks, tape.length % 5 === 0 ? tape.length : null]);

  // ── Movers ──
  const movers = useMemo(() => {
    const items: MoverItem[] = stocks.map(s => ({
      ticker: s.ticker,
      name: s.name,
      price: s.lastPrice,
      changePercent: s.previousClose > 0 ? ((s.lastPrice - s.previousClose) / s.previousClose) * 100 : 0,
      volume: tradeVolumes[s.id]?.volume || 0,
      value: tradeVolumes[s.id]?.value || 0,
    }));

    const gainers = [...items].filter(i => i.changePercent >= 0).sort((a, b) => b.changePercent - a.changePercent);
    const losers = [...items].filter(i => i.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent);
    const byVolume = [...items].sort((a, b) => b.volume - a.volume);
    const byValue = [...items].sort((a, b) => b.value - a.value);

    return { gainers, losers, byVolume, byValue };
  }, [stocks, tradeVolumes]);

  // ── Loading ──
  if (loading && stocks.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#8B949E', gap: '0.5rem' }}>
        <RefreshCw size={28} className="spin-icon" />
        <div style={{ fontSize: '0.85rem' }}>Loading market data...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Styles */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin-icon { animation: spin 1s linear infinite; }
        @keyframes dashSlideIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .dash-row-new { animation: dashSlideIn 0.2s ease-out; }

        /* 3-column grid */
        .dash-grid-3 {
          display: grid;
          grid-template-columns: minmax(240px, 28fr) minmax(300px, 44fr) minmax(220px, 28fr);
          gap: 0.75rem;
          align-items: start;
        }

        @media (max-width: 1024px) {
          .dash-grid-3 {
            grid-template-columns: 1fr;
          }
          .dash-col-right {
            order: 3;
          }
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: '#E6EDF3' }}>Market Overview</h1>
          <span style={{ fontSize: '0.7rem', color: '#8B949E' }}>
            Bursa Simulasi — {stocks.length} saham
          </span>
        </div>
        <div style={{
          padding: '0.25rem 0.6rem', borderRadius: '0.25rem', fontSize: '0.65rem', fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          background: marketStatus === 'OPEN' ? 'rgba(0,200,83,0.15)' : 'rgba(239,83,80,0.15)',
          color: marketStatus === 'OPEN' ? 'var(--trade-up)' : 'var(--trade-down)',
        }}>
          {marketStatus === 'OPEN' ? 'BURSA DIBUKA' : marketStatus === 'CLOSED' ? 'BURSA DITUTUP' : marketStatus}
        </div>
      </div>

      {/* ── 3-Column Grid ── */}
      <div className="dash-grid-3">

        {/* ── LEFT COLUMN (Order Tape) ── */}
        <div className="dash-col-left" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <OrderTape trades={tape} />
        </div>

        {/* ── MIDDLE COLUMN ── */}
        <div className="dash-col-middle" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <IndexComposite composite={compositeStats} chartData={compositeHistory} />
          <MarketCalendar marketStatus={marketStatus} />
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className="dash-col-right" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <TrendingPanel
            gainers={movers.gainers}
            losers={movers.losers}
            byVolume={movers.byVolume}
            byValue={movers.byValue}
          />

          <TopBrokerPanel />

          {/* ── Collapsible Bot Activity ── */}
          <div style={{
            background: 'rgba(20,28,40,0.4)',
            borderRadius: '0.5rem',
            border: '1px solid rgba(255,255,255,0.05)',
          }}>
            <button
              onClick={() => setBotCollapsed(!botCollapsed)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.4rem 0.6rem',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.65rem', fontWeight: 600, color: '#8B949E',
                textTransform: 'uppercase', letterSpacing: '0.03em',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Bot size={12} />
                Bot Activity
              </span>
              <span style={{ fontSize: '0.6rem', opacity: 0.5 }}>
                {botCollapsed ? '+' : '−'}
              </span>
            </button>
            {!botCollapsed && (
              <div style={{ padding: '0 0.6rem 0.6rem' }}>
                <BotActivity />
              </div>
            )}
            {/* Mini summary when collapsed */}
            {botCollapsed && user && (
              <div style={{
                padding: '0 0.6rem 0.5rem',
                fontSize: '0.6rem', color: '#555',
                display: 'flex', alignItems: 'center', gap: '0.35rem',
              }}>
                <span>Beli bot di</span>
                <Link to="/portfolio" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 600 }}>
                  Portfolio
                </Link>
                <span>untuk trading otomatis</span>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
