import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { API_BASE } from '../config';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3002';
const socket = io(BACKEND_URL);

interface StockItem {
  id: string;
  ticker: string;
  lastPrice: number;
  previousClose: number;
}

export default function TickerTape() {
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [flashMap, setFlashMap] = useState<Record<string, 'up' | 'down'>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch stocks
  useEffect(() => {
    const fetchStocks = () => {
      fetch(`${API_BASE}/stocks`)
        .then(r => r.json())
        .then((data: StockItem[]) => setStocks(data))
        .catch(() => {});
    };
    fetchStocks();
    const interval = setInterval(fetchStocks, 5000);
    return () => clearInterval(interval);
  }, []);

  // Listen for trades → flash
  useEffect(() => {
    const handleTrade = (data: { stockId: string; type: string }) => {
      const dir = data.type === 'HAKA' ? 'up' : data.type === 'HAKI' ? 'down' : null;
      if (!dir) return;
      setFlashMap(prev => ({ ...prev, [data.stockId]: dir }));
      setTimeout(() => {
        setFlashMap(prev => {
          const copy = { ...prev };
          delete copy[data.stockId];
          return copy;
        });
      }, 800);
    };
    socket.on('all:trade', handleTrade);
    return () => { socket.off('all:trade', handleTrade); };
  }, []);

  // Duplicate stocks for seamless loop
  const displayStocks = [...stocks, ...stocks];

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: 28,
      background: 'rgba(15, 15, 15, 0.95)',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      overflow: 'hidden',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
    }}>
      <style>{`
        @keyframes tickerScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-scroll {
          display: flex;
          white-space: nowrap;
          animation: tickerScroll 40s linear infinite;
          will-change: transform;
        }
        .ticker-scroll:hover {
          animation-play-state: paused;
        }
        @keyframes tickerFlashGreen {
          0% { background-color: rgba(0,200,83,0.4); }
          100% { background-color: transparent; }
        }
        @keyframes tickerFlashRed {
          0% { background-color: rgba(255,61,0,0.4); }
          100% { background-color: transparent; }
        }
        .ticker-flash-up { animation: tickerFlashGreen 0.8s ease-out 1; }
        .ticker-flash-down { animation: tickerFlashRed 0.8s ease-out 1; }
      `}</style>
      {stocks.length === 0 ? (
        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', padding: '0 1rem' }}>Loading ticker...</span>
      ) : (
        <div ref={scrollRef} className="ticker-scroll">
          {displayStocks.map((s, i) => {
            const change = s.lastPrice - s.previousClose;
            const changePct = s.previousClose > 0 ? (change / s.previousClose) * 100 : 0;
            const isUp = change >= 0;
            const flash = flashMap[s.id];
            const flashClass = flash === 'up' ? 'ticker-flash-up' : flash === 'down' ? 'ticker-flash-down' : '';
            return (
              <span
                key={`${s.id}-${i}`}
                className={flashClass}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  padding: '0 0.8rem',
                  fontSize: '0.7rem',
                  fontFamily: 'var(--font-mono)',
                  borderRight: '1px solid rgba(255,255,255,0.05)',
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ fontWeight: 700, color: '#fff' }}>{s.ticker.replace('.JK', '')}</span>
                <span style={{ color: isUp ? 'var(--trade-up)' : 'var(--trade-down)' }}>
                  {s.lastPrice.toLocaleString('id-ID')}
                </span>
                <span style={{ color: isUp ? 'var(--trade-up)' : 'var(--trade-down)', fontSize: '0.65rem' }}>
                  {isUp ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
