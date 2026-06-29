import { useEffect, useState, useRef, useCallback } from 'react';
import { X, Search, ChevronUp, ChevronDown, Plus, Minus } from 'lucide-react';
import { socket } from '../App';
import { useToast } from '../ToastContext';
import { useUser } from '../UserContext';
import { API_BASE } from '../config';

interface Stock {
  id: string;
  ticker: string;
  name: string;
  lastPrice: number;
}

interface FastOrderProps {
  /** If provided, pre-select this stock */
  initialStockId?: string;
  initialTicker?: string;
  /** Called after successful order placement */
  onOrderPlaced?: () => void;
}

function fmt(n: number) {
  return n.toLocaleString('id-ID');
}

export default function FastOrder({ initialStockId, initialTicker, onOrderPlaced }: FastOrderProps) {
  const [open, setOpen] = useState(false);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  // Selected stock
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);

  // Order form
  const [side, setSide] = useState<'BID' | 'OFFER'>('BID');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [price, setPrice] = useState<string>('');
  const [lots, setLots] = useState<number>(1);

  const { user, refreshUser } = useUser();
  const { addToast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Fetch stock list ───────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/stocks`)
      .then(res => res.json())
      .then(setStocks)
      .catch(() => {});
  }, []);

  // ── Pre-select if props given ──────────────────────────────────
  useEffect(() => {
    if (!stocks.length) return;
    if (initialStockId) {
      const found = stocks.find(s => s.id === initialStockId);
      if (found) selectStock(found);
    } else if (initialTicker) {
      const found = stocks.find(s => s.ticker === initialTicker);
      if (found) selectStock(found);
    }
  }, [stocks, initialStockId, initialTicker]);

  // ── Keyboard toggle (F key) ────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        // Don't toggle if user is typing in an input
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus search when dropdown opens
  useEffect(() => {
    if (showDropdown && searchRef.current) {
      searchRef.current.focus();
    }
  }, [showDropdown]);

  const selectStock = (stock: Stock) => {
    setSelectedStock(stock);
    setPrice(stock.lastPrice.toString());
    setShowDropdown(false);
    setSearch('');
  };

  const filteredStocks = search
    ? stocks.filter(
        s =>
          s.ticker.toLowerCase().includes(search.toLowerCase()) ||
          s.name.toLowerCase().includes(search.toLowerCase())
      )
    : stocks;

  // ── Tick size calculation (IHSG tick rules simplified) ─────────
  const tickSize = (p: number): number => {
    if (p < 200) return 1;
    if (p < 500) return 2;
    if (p < 2000) return 5;
    if (p < 5000) return 10;
    return 25;
  };

  const adjustPrice = (delta: number) => {
    const current = Number(price) || selectedStock?.lastPrice || 0;
    const tick = tickSize(current);
    const newPrice = Math.max(50, current + tick * delta);
    setPrice(newPrice.toString());
  };

  const adjustQty = (delta: number) => {
    setLots(prev => Math.max(1, prev + delta));
  };

  // ── Submit order ───────────────────────────────────────────────
  const handlePlaceOrder = async () => {
    if (!selectedStock || !user) {
      addToast('Pilih saham terlebih dahulu.', 'error');
      return;
    }
    const effectivePrice = orderType === 'MARKET' ? selectedStock.lastPrice : Number(price);
    if (!lots || lots <= 0) {
      addToast('Jumlah lot tidak valid (minimum 1 lot).', 'error');
      return;
    }
    const quantity = lots * 100;
    if (orderType === 'LIMIT' && (!effectivePrice || effectivePrice <= 0)) {
      addToast('Harga tidak valid.', 'error');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          stockId: selectedStock.id,
          side,
          price: orderType === 'MARKET' ? selectedStock.lastPrice : effectivePrice,
          quantity,
          type: orderType === 'MARKET' ? (side === 'BID' ? 'HAKA' : 'HAKI') : 'LIMIT',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        addToast(data.error || 'Order gagal.', 'error');
      } else {
        const executed = data.executedQty ?? quantity;
        const execPrice = data.currentLastPrice ?? effectivePrice;
        addToast(
          `${side === 'BID' ? 'BUY' : 'SELL'} ${fmt(Math.round(executed / 100))} lot ${selectedStock.ticker.replace('.JK', '')} @ ${fmt(execPrice)}`,
          'success'
        );
        refreshUser();
        onOrderPlaced?.();
      }
    } catch {
      addToast('Gagal mengirim order.', 'error');
    }
  };

  // ── Render overlay when closed (small floating button) ─────────
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn btn-primary"
        style={{
          position: 'fixed',
          bottom: '1.5rem',
          right: '1.5rem',
          zIndex: 900,
          padding: '0.7rem 1.2rem',
          borderRadius: 'var(--radius-full)',
          boxShadow: '0 4px 20px rgba(79,70,229,0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.85rem',
        }}
        title="Fast Order (F)"
      >
        ⚡ Fast Order
        <span
          style={{
            background: 'rgba(255,255,255,0.15)',
            padding: '0.15rem 0.5rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.7rem',
          }}
        >
          F
        </span>
      </button>
    );
  }

  // ── Render floating panel ──────────────────────────────────────
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1.5rem',
        right: '1.5rem',
        zIndex: 950,
        width: '360px',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}
    >
      <div
        className="glass-panel"
        style={{
          padding: '1.25rem',
          border: '1px solid var(--glass-border)',
          background: 'rgba(19, 20, 28, 0.85)',
          backdropFilter: 'blur(20px)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>⚡ Fast Order</h3>
          <button
            onClick={() => setOpen(false)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0.25rem',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Ticker selector */}
        <div style={{ position: 'relative', marginBottom: '1rem' }}>
          <label className="text-muted text-sm" style={{ display: 'block', marginBottom: '0.4rem' }}>
            Saham
          </label>
          <div
            className="input"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              cursor: 'pointer',
              padding: '0.5rem 0.75rem',
            }}
            onClick={() => {
              setShowDropdown(prev => !prev);
              setSearch('');
            }}
          >
            <Search size={14} style={{ color: 'var(--text-muted)' }} />
            {selectedStock ? (
              <span style={{ flex: 1 }}>
                <strong>{selectedStock.ticker.replace('.JK', '')}</strong>
                <span className="text-muted" style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                  {selectedStock.name}
                </span>
              </span>
            ) : (
              <span className="text-muted">Cari saham...</span>
            )}
          </div>

          {showDropdown && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 999,
                background: 'rgba(28, 29, 41, 0.95)',
                backdropFilter: 'blur(16px)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                marginTop: '0.25rem',
                maxHeight: '220px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <input
                ref={searchRef}
                className="input"
                style={{
                  border: 'none',
                  borderRadius: 0,
                  borderBottom: '1px solid var(--border-color)',
                  padding: '0.6rem 0.75rem',
                }}
                placeholder="Ketik ticker atau nama..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {filteredStocks.map(s => (
                  <div
                    key={s.id}
                    style={{
                      padding: '0.5rem 0.75rem',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: '1px solid var(--border-color)',
                      background: selectedStock?.id === s.id ? 'rgba(79,70,229,0.1)' : 'transparent',
                    }}
                    onClick={() => selectStock(s)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
                    onMouseLeave={e =>
                      (e.currentTarget.style.background =
                        selectedStock?.id === s.id ? 'rgba(79,70,229,0.1)' : 'transparent')
                    }
                  >
                    <div>
                      <strong style={{ fontSize: '0.9rem' }}>{s.ticker.replace('.JK', '')}</strong>
                      <span className="text-muted" style={{ fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                        {s.name}
                      </span>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: 600 }}>
                      {fmt(s.lastPrice)}
                    </span>
                  </div>
                ))}
                {filteredStocks.length === 0 && (
                  <div style={{ padding: '1rem', textAlign: 'center' }} className="text-muted">
                    Tidak ditemukan
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* BUY / SELL toggle */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <button
            className={`btn ${side === 'BID' ? 'btn-success' : 'btn-outline'}`}
            style={{ flex: 1, padding: '0.5rem' }}
            onClick={() => setSide('BID')}
          >
            BELI
          </button>
          <button
            className={`btn ${side === 'OFFER' ? 'btn-danger' : 'btn-outline'}`}
            style={{ flex: 1, padding: '0.5rem' }}
            onClick={() => setSide('OFFER')}
          >
            JUAL
          </button>
        </div>

        {/* LIMIT / MARKET */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button
            className={`btn ${orderType === 'LIMIT' ? 'btn-primary' : 'btn-outline'}`}
            style={{ flex: 1, padding: '0.4rem', fontSize: '0.8rem' }}
            onClick={() => setOrderType('LIMIT')}
          >
            LIMIT
          </button>
          <button
            className={`btn ${orderType === 'MARKET' ? 'btn-primary' : 'btn-outline'}`}
            style={{ flex: 1, padding: '0.4rem', fontSize: '0.8rem' }}
            onClick={() => setOrderType('MARKET')}
          >
            {side === 'BID' ? 'HAKA' : 'HAKI'}
          </button>
        </div>

        {/* Price */}
        <div style={{ marginBottom: '0.75rem' }}>
          <label className="text-muted text-sm" style={{ display: 'block', marginBottom: '0.3rem' }}>
            Harga
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <button
              className="btn btn-outline"
              style={{ padding: '0.4rem 0.6rem' }}
              onClick={() => adjustPrice(-1)}
              disabled={orderType === 'MARKET'}
            >
              <ChevronDown size={14} />
            </button>
            <input
              type="number"
              className="input"
              style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', padding: '0.4rem' }}
              value={orderType === 'MARKET' ? '' : price}
              onChange={e => setPrice(e.target.value)}
              disabled={orderType === 'MARKET'}
              placeholder={orderType === 'MARKET' ? 'Market' : 'Harga'}
            />
            <button
              className="btn btn-outline"
              style={{ padding: '0.4rem 0.6rem' }}
              onClick={() => adjustPrice(1)}
              disabled={orderType === 'MARKET'}
            >
              <ChevronUp size={14} />
            </button>
          </div>
        </div>

        {/* Quantity */}
        <div style={{ marginBottom: '1rem' }}>
          <label className="text-muted text-sm" style={{ display: 'block', marginBottom: '0.3rem' }}>
            Jumlah (Lot, 1 lot = 100 lembar)
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <button
              className="btn btn-outline"
              style={{ padding: '0.4rem 0.6rem' }}
              onClick={() => adjustQty(-1)}
            >
              <Minus size={14} />
            </button>
            <input
              type="number"
              className="input"
              style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', padding: '0.4rem' }}
              value={lots}
              onChange={e => setLots(Math.max(1, Number(e.target.value) || 1))}
              step={1}
              min={1}
            />
            <button
              className="btn btn-outline"
              style={{ padding: '0.4rem 0.6rem' }}
              onClick={() => adjustQty(1)}
            >
              <Plus size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
            {[1, 5, 10].map(q => (
              <button
                key={q}
                className="btn btn-outline"
                style={{ flex: 1, padding: '0.3rem', fontSize: '0.75rem' }}
                onClick={() => setLots(q)}
              >
                {q} Lot
              </button>
            ))}
          </div>
        </div>

        {/* Estimated total */}
        {selectedStock && (
          <div
            style={{
              padding: '0.5rem 0.75rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1rem',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.8rem',
            }}
          >
            <span className="text-muted">Estimasi total</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
              Rp {fmt(lots * 100 * (orderType === 'MARKET' ? selectedStock.lastPrice : Number(price) || 0))}
            </span>
          </div>
        )}

        {/* Submit */}
        <button
          className={`btn ${side === 'BID' ? 'btn-success' : 'btn-danger'}`}
          style={{ width: '100%', padding: '0.75rem', fontSize: '0.95rem', fontWeight: 700 }}
          onClick={handlePlaceOrder}
          disabled={!selectedStock}
        >
          {side === 'BID' ? '🟢 BELI' : '🔴 JUAL'} {selectedStock ? selectedStock.ticker.replace('.JK', '') : ''}{' '}
          {lots > 0 ? `${lots} Lot` : ''}
        </button>
      </div>
    </div>
  );
}
