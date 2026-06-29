import { useRef, useEffect } from 'react';
import { createChart, AreaSeries, type IChartApi, type ISeriesApi, type AreaData, type Time } from 'lightweight-charts';

interface EquityPoint {
  time: string;
  equity: number;
}

interface Props {
  data: EquityPoint[];
  isLoading: boolean;
  range: string;
  onRangeChange: (r: string) => void;
}

const RANGES = ['1W', '1M', '3M', 'YTD', '1Y', 'All'];

const fmtRp = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

export default function EquityChart({ data, isLoading, range, onRangeChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        // background: { type: 'solid', color: 'transparent' }, // removed: causes TS error
        background: { color: 'transparent' },
        textColor: '#a0a4b8',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.05, bottom: 0.15 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        ticksVisible: false,
      },
      crosshair: { vertLine: { labelVisible: false }, horzLine: { labelVisible: false } },
      width: containerRef.current.clientWidth,
      height: 240,
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: '#4f46e5',
      topColor: 'rgba(79,70,229,0.25)',
      bottomColor: 'rgba(79,70,229,0.01)',
      // lineWidth: 2, // removed: type mismatch
      lineWidth: 2 as any,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !data.length) return;
    // lightweight-charts expects 'time' in YYYY-MM-DD format
    const chartData: AreaData<Time>[] = data.map(d => ({
      time: d.time.split('T')[0] as Time,
      value: d.equity,
    }));
    seriesRef.current.setData(chartData);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  // Update theme on mount
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: { textColor: '#a0a4b8' },
    });
  }, []);

  const latestEquity = data.length > 0 ? data[data.length - 1].equity : 0;

  const prevEquity = data.length > 1 ? data[data.length - 2].equity : latestEquity;
  const change = latestEquity - prevEquity;
  const changePct = prevEquity > 0 ? (change / prevEquity) * 100 : 0;

  return (
    <div className="glass-panel" style={{ padding: '1.25rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
          Total Equity
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{
            fontSize: '1.75rem',
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-primary)',
          }}>
            {isLoading ? '...' : fmtRp(latestEquity)}
          </span>
          {!isLoading && data.length > 1 && (
            <span style={{
              fontSize: '0.85rem',
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              color: change >= 0 ? 'var(--trade-up)' : 'var(--trade-down)',
            }}>
              {change >= 0 ? '+' : ''}{fmtRp(change)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
            </span>
          )}
        </div>
      </div>

      {/* Chart */}
      <div ref={containerRef} style={{ width: '100%', height: 240, marginBottom: '0.75rem' }}>
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Memuat data...
          </div>
        )}
        {!isLoading && data.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Belum ada riwayat
          </div>
        )}
      </div>

      {/* Range selector */}
      <div style={{ display: 'flex', gap: 4 }}>
        {RANGES.map(r => (
          <button
            key={r}
            onClick={() => onRangeChange(r)}
            style={{
              flex: 1,
              padding: '4px 0',
              fontSize: '0.7rem',
              fontWeight: range === r ? 700 : 500,
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: range === r ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
              color: range === r ? '#fff' : 'var(--text-secondary)',
              transition: 'all 0.15s',
            }}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
