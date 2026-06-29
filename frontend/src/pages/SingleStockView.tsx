import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useUser } from '../UserContext';
import GlassCard from '../components/GlassCard';
import { API_BASE } from '../config';

interface Stock {
  ticker: string;
  name: string;
  lastPrice: number;
  previousClose: number;
  araPrice: number;
  arbPrice: number;
}

interface OrderLevel {
  price: number;
  quantity: number;
}

interface DepthRow {
  bid?: OrderLevel;
  offer?: OrderLevel;
}

interface Portfolio {
  avgPrice: number;
  totalQty: number;
  availableQty: number;
}

const fmt = (n: number) => n?.toLocaleString('id-ID') ?? '-';
const fmtRp = (n: number) => 'Rp ' + n?.toLocaleString('id-ID');

function getTick(price: number): number {
  if (price < 200) return 1;
  if (price < 500) return 2;
  if (price < 2000) return 5;
  if (price < 5000) return 10;
  return 25;
}

const Panel = ({ title, children, style }: { title?: string; children: React.ReactNode; style?: React.CSSProperties }) => (
  <GlassCard title={title} style={style} bodyStyle={{ padding: '0.75rem' }}>
    {children}
  </GlassCard>
);

function InfoCell({ label, value, isMono, color }: { label: string; value: string; isMono?: boolean; color?: string }) {
  return (
    <div>
      <div style={{ color: '#8B949E', fontSize: '0.55rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.1rem' }}>{label}</div>
      <div style={{ fontFamily: isMono ? 'var(--font-mono)' : undefined, color: color ?? '#E6EDF3', fontWeight: 600, fontSize: '0.68rem' }}>{value}</div>
    </div>
  );
}

const stepperBtnStyle: React.CSSProperties = {
  padding: '0.35rem 0.5rem',
  borderRadius: '0.3rem',
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  color: '#E6EDF3',
  fontWeight: 700,
  fontSize: '0.9rem',
  cursor: 'pointer',
  lineHeight: 1,
};

export default function SingleStockView() {
  const { ticker } = useParams<{ ticker: string }>();
  const navigate = useNavigate();
  const { user } = useUser();

  const [stock, setStock] = useState<Stock | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [depthRows, setDepthRows] = useState<DepthRow[]>([]);
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [side, setSide] = useState<'BID' | 'OFFER'>('BID');
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const leverage = 1;

  const prevPriceRef = useRef<number | null>(null);
  const fullTicker = ticker?.includes('.JK') ? ticker : `${ticker}.JK`;

  const fetchStock = useCallback(() => {
    fetch(`${API_BASE}/api/stocks/${fullTicker}`)
      .then(r => r.json())
      .then((data: Stock) => {
        setStock(prev => {
          if (prev && data.lastPrice !== prev.lastPrice) {
            setFlash(data.lastPrice > prev.lastPrice ? 'up' : 'down');
            setTimeout(() => setFlash(null), 600);
          }
          return data;
        });
        if (!price) setPrice(data.lastPrice.toString());
        prevPriceRef.current = data.lastPrice;
      })
      .catch(() => {});
  }, [fullTicker, price]);

  const fetchOrderBook = useCallback(() => {
    fetch(`${API_BASE}/api/orderbook/${fullTicker}`)
      .then(r => r.json())
      .then((data: { bids: OrderLevel[]; offers: OrderLevel[] }) => {
        const bids = data.bids ?? [];
        const offers = data.offers ?? [];
        const len = Math.max(bids.length, offers.length);
        const rows: DepthRow[] = Array.from({ length: len }, (_, i) => ({
          bid: bids[i],
          offer: offers[i],
        }));
        setDepthRows(rows);
      })
      .catch(() => {});
  }, [fullTicker]);

  const fetchPortfolio = useCallback(() => {
    if (!user?.id) return;
    fetch(`${API_BASE}/api/portfolio/${user.id}/${fullTicker}`)
      .then(r => r.json())
      .then((data: Portfolio) => setPortfolio(data))
      .catch(() => setPortfolio(null));
  }, [fullTicker, user?.id]);

  useEffect(() => {
    fetchStock();
    fetchOrderBook();
    fetchPortfolio();
    const interval = setInterval(() => {
      fetchStock();
      fetchOrderBook();
      fetchPortfolio();
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchStock, fetchOrderBook, fetchPortfolio]);

  const handlePlaceOrder = async () => {
    if (!user || !stock || submitting) return;
    setSubmitting(true);
    try {
      await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: fullTicker, side, price: Number(price), quantity, userId: user.id }),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  if (!stock) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8B949E' }}>
        Memuat data saham...
      </div>
    );
  }

  const change = stock.lastPrice - stock.previousClose;
  const changePct = stock.previousClose > 0 ? (change / stock.previousClose) * 100 : 0;
  const isUp = change > 0;
  const isDown = change < 0;
  const tick = getTick(stock.lastPrice);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <Panel>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="text"
                defaultValue={stock.ticker.replace('.JK', '')}
                onKeyPress={e => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value.trim().toUpperCase();
                    if (val) navigate(`/stock/${val}`);
                  }
                }}
                style={{ fontSize: '1.4rem', fontWeight: 800, color: '#E6EDF3', background: 'transparent', border: 'none', outline: 'none', fontFamily: 'var(--font-mono)', padding: '0.1rem 0.3rem' }}
              />
              <span style={{ padding: '0.15rem 0.45rem', borderRadius: '0.3rem', fontSize: '0.6rem', fontWeight: 700, fontFamily: 'var(--font-mono)', background: 'rgba(41,98,255,0.15)', border: '1px solid rgba(41,98,255,0.3)', color: '#448AFF' }}>
                {leverage}x
              </span>
            </div>
            <div style={{ color: '#8B949E', fontSize: '0.7rem' }}>{stock.name}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: isUp ? '#00E676' : isDown ? '#FF5252' : '#E6EDF3', transition: 'color 0.2s', ...(flash === 'up' ? { textShadow: '0 0 12px rgba(0,200,83,0.6)' } : {}), ...(flash === 'down' ? { textShadow: '0 0 12px rgba(255,61,0,0.6)' } : {}) }}>
              {fmt(stock.lastPrice)}
            </div>
            <div style={{ color: isUp ? '#00E676' : isDown ? '#FF5252' : '#8B949E', fontWeight: 600, fontSize: '0.8rem' }}>
              {isUp ? '▲' : isDown ? '▼' : '–'} {fmt(Math.abs(change))} ({changePct.toFixed(2)}%)
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.4rem', marginTop: '0.6rem', fontSize: '0.65rem' }}>
          <InfoCell label="Open" value={fmt(stock.lastPrice)} isMono />
          <InfoCell label="Prev" value={fmt(stock.previousClose)} isMono />
          <InfoCell label="High" value={fmt(stock.lastPrice)} isMono />
          <InfoCell label="ARA" value={stock.araPrice > 0 ? fmt(stock.araPrice) : '-'} isMono color={stock.araPrice > 0 ? '#FF9800' : '#8B949E'} />
          <InfoCell label="Low" value={fmt(stock.lastPrice)} isMono />
          <InfoCell label="ARB" value={stock.arbPrice > 0 ? fmt(stock.arbPrice) : '-'} isMono color={stock.arbPrice > 0 ? '#EF5350' : '#8B949E'} />
          <InfoCell label="Lot" value={fmt(quantity / 100) + ' lot'} isMono={false} />
          <InfoCell label="Val" value={quantity * (Number(price) || stock.lastPrice) > 0 ? fmtRp(quantity * (Number(price) || stock.lastPrice)) : '-'} isMono />
        </div>
      </Panel>

      <Panel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', fontSize: '0.68rem' }}>
          <div>
            <div style={{ color: '#8B949E', fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.15rem' }}>Avg</div>
            <div style={{ fontFamily: 'var(--font-mono)', color: '#E6EDF3', fontWeight: 700 }}>{portfolio ? fmt(portfolio.avgPrice) : '-'}</div>
          </div>
          <div>
            <div style={{ color: '#8B949E', fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.15rem' }}>Lot</div>
            <div style={{ fontFamily: 'var(--font-mono)', color: '#E6EDF3', fontWeight: 700 }}>{portfolio ? fmt(portfolio.totalQty / 100) : '-'}</div>
          </div>
          <div>
            <div style={{ color: '#8B949E', fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.15rem' }}>Avail</div>
            <div style={{ fontFamily: 'var(--font-mono)', color: '#E6EDF3', fontWeight: 700 }}>{portfolio ? fmt(portfolio.availableQty / 100) : '-'}</div>
          </div>
        </div>
      </Panel>

      <Panel title="Order Book" style={{ flex: 1 }}>
        <div style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
          {depthRows.map((row, i) => {
            const bidColor = row.bid ? (row.bid.price === stock.lastPrice ? '#00E676' : '#E6EDF3') : '#8B949E';
            const offerColor = row.offer ? (row.offer.price === stock.lastPrice ? '#FF5252' : '#E6EDF3') : '#8B949E';
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px', padding: '0.15rem 0', borderBottom: i < depthRows.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none', cursor: 'pointer', transition: 'background 0.15s' }}
                onClick={() => { if (row.bid) setPrice(row.bid.price.toString()); else if (row.offer) setPrice(row.offer.price.toString()); }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <div style={{ textAlign: 'right', color: bidColor, fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>{row.bid ? fmt(row.bid.price) : ''}</div>
                <div style={{ textAlign: 'center', color: '#8B949E', fontSize: '0.55rem' }}>{row.bid && row.offer ? fmt((row.bid.quantity + row.offer.quantity) / 100) : row.bid ? fmt(row.bid.quantity / 100) : row.offer ? fmt(row.offer.quantity / 100) : ''}</div>
                <div style={{ textAlign: 'left', color: offerColor, fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>{row.offer ? fmt(row.offer.price) : ''}</div>
              </div>
            );
          })}
          {depthRows.length === 0 && <div style={{ color: '#8B949E', padding: '0.5rem 0', textAlign: 'center', fontSize: '0.65rem' }}>Belum ada order.</div>}
        </div>
      </Panel>

      <Panel title="Order">
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
          <button onClick={() => setSide('BID')} style={{ flex: 1, padding: '0.35rem', borderRadius: '0.3rem', border: 'none', fontWeight: 700, fontSize: '0.7rem', background: side === 'BID' ? 'var(--trade-up)' : 'rgba(255,255,255,0.04)', color: side === 'BID' ? '#fff' : '#8B949E', cursor: 'pointer', transition: 'background 0.15s', textTransform: 'uppercase' }}>BELI</button>
          <button onClick={() => setSide('OFFER')} style={{ flex: 1, padding: '0.35rem', borderRadius: '0.3rem', border: 'none', fontWeight: 700, fontSize: '0.7rem', background: side === 'OFFER' ? 'var(--trade-down)' : 'rgba(255,255,255,0.04)', color: side === 'OFFER' ? '#fff' : '#8B949E', cursor: 'pointer', transition: 'background 0.15s', textTransform: 'uppercase' }}>JUAL</button>
        </div>
        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
          <button onClick={() => setPrice((Number(price) - tick).toString())} style={stepperBtnStyle}>-</button>
          <input type="text" value={price} onChange={e => setPrice(e.target.value)} onKeyPress={e => e.key === 'Enter' && handlePlaceOrder()} style={{ flex: 1, padding: '0.35rem', borderRadius: '0.3rem', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#E6EDF3', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.75rem', textAlign: 'center' }} />
          <button onClick={() => setPrice((Number(price) + tick).toString())} style={stepperBtnStyle}>+</button>
        </div>
        <div style={{ marginTop: '0.4rem' }}>
          <input type="range" min="0" max={user?.cashBalance || 1} value={quantity} onChange={e => setQuantity(Number(e.target.value))} style={{ width: '100%' }} />
          <div style={{ fontSize: '0.6rem', color: '#8B949E', marginTop: '0.2rem' }}>Lot: {fmt(quantity / 100)} / {fmt((user?.cashBalance || 1) / 100)}</div>
        </div>
        <button onClick={handlePlaceOrder} disabled={submitting} style={{ width: '100%', marginTop: '0.5rem', padding: '0.45rem', borderRadius: '0.3rem', border: 'none', fontWeight: 700, fontSize: '0.75rem', background: side === 'BID' ? 'var(--trade-up)' : 'var(--trade-down)', color: '#fff', cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}>Place Order</button>
      </Panel>
    </div>
  );
}
