import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { socket } from '../App';
import { useUser } from '../UserContext';
import { useToast } from '../ToastContext';
import { API_BASE } from '../config';

interface OrderBookLevel {
  price: number;
  quantity: number;
}

interface StockInfo {
  id: string;
  ticker: string;
  name: string;
  lastPrice: number;
  initialPrice: number;
  araPrice?: number;
  arbPrice?: number;
}

interface TradeTapeItem {
  price: number;
  quantity: number;
  type: string; // HAKA | HAKI | MATCH
  executedAt: string;
}

function fmt(n: number) {
  return n.toLocaleString('id-ID');
}

export default function TradingPlatform() {
  const { ticker } = useParams<{ ticker: string }>();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<{ chart: any; series: any } | null>(null);

  const [stock, setStock] = useState<StockInfo | null>(null);
  const [bids, setBids] = useState<OrderBookLevel[]>([]);
  const [offers, setOffers] = useState<OrderBookLevel[]>([]);
  const [trades, setTrades] = useState<TradeTapeItem[]>([]);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  // Order form state
  const [side, setSide] = useState<'BID' | 'OFFER'>('BID');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [price, setPrice] = useState<string>('');
  const [lots, setLots] = useState<string>('1'); // 1 lot = 100 shares

  const { user, refreshUser } = useUser();
  const { addToast } = useToast();

  const quantity = (Number(lots) || 0) * 100;

  // ── Initial load: resolve ticker -> stock, then fetch book + trades ──────────
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/stocks`)
      .then(res => res.json())
      .then((data: StockInfo[]) => {
        if (cancelled) return;
        const found = data.find(s => s.ticker === ticker);
        if (found) {
          setStock(found);
          setPrice(found.lastPrice.toString());
          fetchOrderBook(found.id);
          fetchTrades(found.id);
        }
      });
    return () => { cancelled = true; };
  }, [ticker]);

  const fetchOrderBook = async (stockId: string) => {
    const res = await fetch(`${API_BASE}/stocks/${stockId}/orderbook`);
    const data = await res.json();
    setBids(data.bids);
    setOffers(data.offers);
  };

  const fetchTrades = async (stockId: string) => {
    const res = await fetch(`${API_BASE}/stocks/${stockId}/trades?limit=50`);
    const data: TradeTapeItem[] = await res.json();
    setTrades(data);
  };

  // ── Real-time subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!stock) return;

    // Join the room for this stock so the server's broadcasts actually reach us.
    socket.emit('subscribe', stock.id);

    const handleOrderbookUpdate = (data: { stockId: string }) => {
      if (data.stockId === stock.id) fetchOrderBook(stock.id);
    };

    const handleLastPrice = (data: { stockId: string; price: number }) => {
      if (data.stockId !== stock.id) return;
      setStock(prev => {
        if (!prev) return prev;
        setFlash(data.price > prev.lastPrice ? 'up' : data.price < prev.lastPrice ? 'down' : null);
        return { ...prev, lastPrice: data.price };
      });
    };

    const handleTrade = (data: { stockId: string; price: number; quantity: number; type: string; executedAt: string }) => {
      if (data.stockId !== stock.id) return;
      setTrades(prev => [{ price: data.price, quantity: data.quantity, type: data.type, executedAt: data.executedAt }, ...prev].slice(0, 50));
    };

    socket.on('orderbook:update', handleOrderbookUpdate);
    socket.on('lastPrice', handleLastPrice);
    socket.on('trade', handleTrade);

    return () => {
      socket.emit('unsubscribe', stock.id);
      socket.off('orderbook:update', handleOrderbookUpdate);
      socket.off('lastPrice', handleLastPrice);
      socket.off('trade', handleTrade);
    };
  }, [stock?.id]);

  // Clear the flash highlight after a moment
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [flash]);

  // ── Chart setup (once) ────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#a0a4b8' },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
      width: chartContainerRef.current.clientWidth,
      height: 400,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00c853',
      downColor: '#ff3d00',
      borderVisible: false,
      wickUpColor: '#00c853',
      wickDownColor: '#ff3d00',
    });

    chartApiRef.current = { chart, series: candleSeries };

    const handleResize = () => {
      chart.applyOptions({ width: chartContainerRef.current?.clientWidth || 0 });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartApiRef.current = null;
    };
  }, []);

  // Feed the chart from REAL trade data, bucketed into 1-minute candles.
  // (Replaces the old random-walk placeholder so the chart reflects what actually happened.)
  useEffect(() => {
    if (!chartApiRef.current || !stock) return;

    if (trades.length === 0) {
      // No trades yet — show a single flat candle at the seeded price so the chart isn't empty.
      const time = Math.floor(Date.now() / 60000) * 60 as any;
      chartApiRef.current.series.setData([
        { time, open: stock.lastPrice, high: stock.lastPrice, low: stock.lastPrice, close: stock.lastPrice }
      ]);
      return;
    }

    // Trades come newest-first; reverse to chronological order for bucketing.
    const chrono = [...trades].reverse();
    const buckets = new Map<number, { open: number; high: number; low: number; close: number }>();

    for (const t of chrono) {
      const bucketTime = Math.floor(new Date(t.executedAt).getTime() / 60000) * 60;
      const existing = buckets.get(bucketTime);
      if (!existing) {
        buckets.set(bucketTime, { open: t.price, high: t.price, low: t.price, close: t.price });
      } else {
        existing.high = Math.max(existing.high, t.price);
        existing.low = Math.min(existing.low, t.price);
        existing.close = t.price;
      }
    }

    const candleData = Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([time, v]) => ({ time: time as any, ...v }));

    chartApiRef.current.series.setData(candleData);
  }, [trades, stock?.id]);

  // ── Order placement ───────────────────────────────────────────────────────
  const handlePlaceOrder = async (orderSide: 'BID' | 'OFFER', overridePrice?: number) => {
    if (!stock || !user) return;
    const effectivePrice = overridePrice ?? Number(price);
    const effectiveQty = quantity;

    if (!effectiveQty || effectiveQty <= 0) {
      addToast('Masukkan jumlah lot terlebih dahulu.', 'error');
      return;
    }
    if (orderType === 'LIMIT' && (!effectivePrice || effectivePrice <= 0)) {
      addToast('Masukkan harga terlebih dahulu.', 'error');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          stockId: stock.id,
          side: orderSide,
          // For MARKET orders the price is only used by the backend as a fallback reference;
          // the matching engine re-derives the real lock price from the live book for HAKA.
          price: orderType === 'MARKET' ? stock.lastPrice : effectivePrice,
          quantity: effectiveQty,
          type: orderType === 'MARKET' ? (orderSide === 'BID' ? 'HAKA' : 'HAKI') : 'LIMIT'
        })
      });
      const data = await res.json();
      if (!res.ok) {
        addToast(data.error || 'Order gagal.', 'error');
      } else {
        addToast(`Order berhasil! ${Math.round(data.executedQty / 100)} lot di harga ${data.currentLastPrice?.toLocaleString('id-ID') || ''}`, 'success');
        refreshUser();
        fetchOrderBook(stock.id);
      }
    } catch {
      addToast('Gagal mengirim order. Cek koneksi ke server.', 'error');
    }
  };

  // Fast Order: clicking a price level in the book fills the form AND fires immediately,
  // mirroring Stockbit's tap-to-order behavior on the depth ladder.
  const handleFastOrder = (level: OrderBookLevel, bookSide: 'BID' | 'OFFER') => {
    // Clicking a BID level means you want to sell into that bid (HAKI).
    // Clicking an OFFER level means you want to buy into that offer (HAKA).
    const actionSide: 'BID' | 'OFFER' = bookSide === 'BID' ? 'OFFER' : 'BID';
    setSide(actionSide);
    setPrice(level.price.toString());
    if (!lots || Number(lots) <= 0) setLots('1');
    handlePlaceOrder(actionSide, level.price);
  };

  const maxDepthQty = useMemo(() => {
    return Math.max(1, ...bids.map(b => b.quantity), ...offers.map(o => o.quantity));
  }, [bids, offers]);

  if (!stock) return <div style={{ padding: '2rem' }}>Loading {ticker}...</div>;

  const change = stock.lastPrice - stock.initialPrice;
  const changePct = stock.initialPrice ? (change / stock.initialPrice) * 100 : 0;
  const isUp = change > 0;
  const isDown = change < 0;
  const priceColorClass = isUp ? 'text-up' : isDown ? 'text-down' : 'text-neutral';

  const depthRowCount = Math.max(bids.length, offers.length, 8);
  const depthRows = Array.from({ length: depthRowCount }, (_, i) => ({
    bid: bids[i] as OrderBookLevel | undefined,
    offer: offers[i] as OrderBookLevel | undefined,
  }));

  const bestBid = bids[0]?.price;
  const bestOffer = offers[0]?.price;

  return (
    <div className="grid grid-cols-3" style={{ gap: '2rem' }}>
      {/* Left Column: Chart + Trade Tape */}
      <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ fontSize: '2rem', margin: 0 }}>{stock.ticker.replace('.JK', '')}</h1>
              <div className="text-muted">{stock.name}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div
                className={priceColorClass}
                style={{
                  fontSize: '2rem', fontWeight: 700, fontFamily: 'var(--font-mono)',
                  transition: 'color 0.2s',
                  ...(flash === 'up' ? { textShadow: '0 0 12px rgba(0,200,83,0.6)' } : {}),
                  ...(flash === 'down' ? { textShadow: '0 0 12px rgba(255,61,0,0.6)' } : {}),
                }}
              >
                {fmt(stock.lastPrice)}
              </div>
              <div className={priceColorClass} style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                {isUp ? '▲' : isDown ? '▼' : '–'} {fmt(Math.abs(change))} ({changePct.toFixed(2)}%)
              </div>
            </div>
          </div>

          <div ref={chartContainerRef} style={{ width: '100%', height: '400px' }} />
        </div>

        {/* Trade Tape (running trades) */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Running Trade</h3>
          <div style={{ maxHeight: '260px', overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem', padding: '0.3rem 0', color: 'var(--text-muted)', fontWeight: 600, position: 'sticky', top: 0, background: 'var(--bg-secondary)' }}>
              <span>Waktu</span><span>Harga</span><span>Lot</span><span>Tipe</span>
            </div>
            {trades.length === 0 && <div className="text-muted" style={{ padding: '0.5rem 0' }}>Belum ada transaksi.</div>}
            {trades.map((t, i) => {
              const isBuyAggr = t.type === 'HAKA';
              const isSellAggr = t.type === 'HAKI';
              const color = isBuyAggr ? 'text-up' : isSellAggr ? 'text-down' : 'text-neutral';
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem', padding: '0.25rem 0', borderTop: '1px solid var(--border-color)' }}>
                  <span className="text-muted">{new Date(t.executedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  <span className={`${color} font-bold`}>{fmt(t.price)}</span>
                  <span>{fmt(t.quantity / 100)}</span>
                  <span className={color}>{t.type}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right Column: Order Form + Order Book */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {/* Order Form */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Pasang Order</h3>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button
              className={`btn ${side === 'BID' ? 'btn-success' : 'btn-outline'}`}
              style={{ flex: 1 }}
              onClick={() => setSide('BID')}
            >BELI</button>
            <button
              className={`btn ${side === 'OFFER' ? 'btn-danger' : 'btn-outline'}`}
              style={{ flex: 1 }}
              onClick={() => setSide('OFFER')}
            >JUAL</button>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
            <button
              className={`btn ${orderType === 'LIMIT' ? 'btn-primary' : 'btn-outline'}`}
              style={{ flex: 1, fontSize: '0.85rem' }}
              onClick={() => setOrderType('LIMIT')}
            >LIMIT</button>
            <button
              className={`btn ${orderType === 'MARKET' ? 'btn-primary' : 'btn-outline'}`}
              style={{ flex: 1, fontSize: '0.85rem' }}
              onClick={() => setOrderType('MARKET')}
              title={side === 'BID' ? 'HAKA — sapu harga offer terbaik' : 'HAKI — sapu harga bid terbaik'}
            >MARKET ({side === 'BID' ? 'HAKA' : 'HAKI'})</button>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label className="text-muted text-sm" style={{ display: 'block', marginBottom: '0.5rem' }}>Harga</label>
            <input
              type="number"
              className="input"
              value={orderType === 'MARKET' ? '' : price}
              onChange={e => setPrice(e.target.value)}
              disabled={orderType === 'MARKET'}
              placeholder={orderType === 'MARKET' ? `Mengikuti ${side === 'BID' ? 'offer' : 'bid'} terbaik` : 'Harga'}
            />
            {orderType === 'MARKET' && (
              <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>
                {side === 'BID'
                  ? `Akan menyapu offer mulai dari ${bestOffer ? fmt(bestOffer) : '-'}`
                  : `Akan menyapu bid mulai dari ${bestBid ? fmt(bestBid) : '-'}`}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label className="text-muted text-sm" style={{ display: 'block', marginBottom: '0.5rem' }}>Jumlah (Lot, 1 lot = 100 lembar)</label>
            <input
              type="number"
              className="input"
              value={lots}
              onChange={e => setLots(e.target.value)}
              placeholder="1"
            />
          </div>

          <button
            className={`btn ${side === 'BID' ? 'btn-success' : 'btn-danger'}`}
            style={{ width: '100%', padding: '0.9rem', fontSize: '1rem' }}
            onClick={() => handlePlaceOrder(side)}
          >
            {side === 'BID' ? 'BELI' : 'JUAL'} {quantity > 0 ? `${Math.round(quantity / 100)} Lot` : ''}
          </button>
        </div>

        {/* Order Book — Stockbit-style depth ladder */}
        {stock && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ padding: '4px 10px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)', background: 'rgba(255,152,0,0.15)', border: '1px solid #ff9800', color: '#ff9800' }}>
              ARA: {stock.araPrice != null ? fmt(stock.araPrice) : '-'}
            </span>
            <span style={{ padding: '4px 10px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)', background: 'rgba(239,83,80,0.15)', border: '1px solid #EF5350', color: '#EF5350' }}>
              ARB: {stock.arbPrice != null ? fmt(stock.arbPrice) : '-'}
            </span>
          </div>
        )}
        <div className="glass-panel" style={{ padding: '1.5rem', flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0 }}>Order Book</h3>
            <span className="text-muted text-sm">Klik harga = Fast Order</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.25rem', textAlign: 'center', fontSize: '0.75rem', marginBottom: '0.4rem' }}>
            <div className="text-muted font-bold">LOT</div>
            <div className="text-up font-bold">BID</div>
            <div className="text-down font-bold">OFFER</div>
            <div className="text-muted font-bold">LOT</div>
          </div>

          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
            {depthRows.map((row, i) => {
              const bidDepthPct = row.bid ? Math.round((row.bid.quantity / maxDepthQty) * 100) : 0;
              const offerDepthPct = row.offer ? Math.round((row.offer.quantity / maxDepthQty) * 100) : 0;
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.25rem', marginBottom: '2px' }}>
                  {/* Bid lot */}
                  <div style={{ textAlign: 'right', padding: '0.3rem 0.4rem', color: 'var(--text-secondary)' }}>
                    {row.bid ? fmt(row.bid.quantity / 100) : ''}
                  </div>
                  {/* Bid price — clickable (sell into this bid = HAKI) */}
                  <button
                    disabled={!row.bid}
                    onClick={() => row.bid && handleFastOrder(row.bid, 'BID')}
                    style={{
                      position: 'relative', overflow: 'hidden',
                      background: row.bid ? 'rgba(0, 200, 83, 0.08)' : 'transparent',
                      border: 'none', borderRadius: 'var(--radius-sm)',
                      color: row.bid ? 'var(--trade-up)' : 'var(--text-muted)',
                      fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '0.85rem',
                      padding: '0.3rem 0.4rem', cursor: row.bid ? 'pointer' : 'default',
                      textAlign: 'right'
                    }}
                    title={row.bid ? `Jual (HAKI) di ${fmt(row.bid.price)}` : ''}
                  >
                    <span style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${bidDepthPct}%`, background: 'rgba(0, 200, 83, 0.18)', zIndex: 0 }} />
                    <span style={{ position: 'relative', zIndex: 1 }}>{row.bid ? fmt(row.bid.price) : '-'}</span>
                  </button>
                  {/* Offer price — clickable (buy into this offer = HAKA) */}
                  <button
                    disabled={!row.offer}
                    onClick={() => row.offer && handleFastOrder(row.offer, 'OFFER')}
                    style={{
                      position: 'relative', overflow: 'hidden',
                      background: row.offer ? 'rgba(255, 61, 0, 0.08)' : 'transparent',
                      border: 'none', borderRadius: 'var(--radius-sm)',
                      color: row.offer ? 'var(--trade-down)' : 'var(--text-muted)',
                      fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '0.85rem',
                      padding: '0.3rem 0.4rem', cursor: row.offer ? 'pointer' : 'default',
                      textAlign: 'left'
                    }}
                    title={row.offer ? `Beli (HAKA) di ${fmt(row.offer.price)}` : ''}
                  >
                    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${offerDepthPct}%`, background: 'rgba(255, 61, 0, 0.18)', zIndex: 0 }} />
                    <span style={{ position: 'relative', zIndex: 1 }}>{row.offer ? fmt(row.offer.price) : '-'}</span>
                  </button>
                  {/* Offer lot */}
                  <div style={{ textAlign: 'left', padding: '0.3rem 0.4rem', color: 'var(--text-secondary)' }}>
                    {row.offer ? fmt(row.offer.quantity / 100) : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
