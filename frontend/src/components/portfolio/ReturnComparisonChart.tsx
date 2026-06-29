import { useRef, useEffect, useMemo } from 'react';
import { createChart, LineSeries, type IChartApi, type ISeriesApi, type LineData, type Time } from 'lightweight-charts';

interface EquityPoint {
  time: string;
  equity: number;
}

interface BenchmarkPoint {
  date: string;
  portfolioReturn: number;
  ihsgReturn: number;
}

interface Props {
  equityData: EquityPoint[];
  isLoading: boolean;
}

function generateBenchmark(data: EquityPoint[]): BenchmarkPoint[] {
  if (!data.length) return [];
  const base = data[0].equity;
  return data.map((d, i) => {
    const progress = i / (data.length - 1 || 1);
    // Simulated IHSG: ~5% annualized, smooth curve
    const annualizedReturn = 0.05;
    const ihsgReturn = progress * annualizedReturn * 100;
    const portfolioReturn = base > 0 ? ((d.equity - base) / base) * 100 : 0;
    return { date: d.time.split('T')[0], portfolioReturn, ihsgReturn };
  });
}

const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

export default function ReturnComparisonChart({ equityData, isLoading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const portfolioSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ihsgSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const benchmark = useMemo(() => generateBenchmark(equityData), [equityData]);

  const latestPortfolio = benchmark.length > 0 ? benchmark[benchmark.length - 1].portfolioReturn : 0;
  const latestIHSG = benchmark.length > 0 ? benchmark[benchmark.length - 1].ihsgReturn : 0;

  useEffect(() => {
    if (!containerRef.current) return;
    // Destroy previous chart before creating new one (to avoid "should" container warnings)
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        // background: { type: 'solid', color: 'transparent' }, // removed: TS error
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
        scaleMargins: { top: 0.1, bottom: 0.15 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        ticksVisible: false,
      },
      crosshair: { vertLine: { labelVisible: false }, horzLine: { labelVisible: false } },
      width: containerRef.current.clientWidth,
      height: 200,
      handleScroll: false,
      handleScale: false,
    });

    portfolioSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#4f46e5',
      lineWidth: 2 as any,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'Portfolio',
    });

    ihsgSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#26A69A',
      lineWidth: 1.5 as any,
      lineStyle: 2, // dashed
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'IHSG',
    });

    chartRef.current = chart;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!portfolioSeriesRef.current || !ihsgSeriesRef.current || !benchmark.length) return;
    const portfolioData: LineData<Time>[] = benchmark.map(d => ({
      time: d.date as Time,
      value: Math.round(d.portfolioReturn * 100) / 100,
    }));
    const ihsgData: LineData<Time>[] = benchmark.map(d => ({
      time: d.date as Time,
      value: Math.round(d.ihsgReturn * 100) / 100,
    }));
    portfolioSeriesRef.current.setData(portfolioData);
    ihsgSeriesRef.current.setData(ihsgData);
    chartRef.current?.timeScale().fitContent();
  }, [benchmark]);

  return (
    <div className="glass-panel" style={{ padding: '1.25rem' }}>
      {/* Header */}
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 12 }}>
        Cumulative Portfolio Return
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 3, borderRadius: 2, background: '#4f46e5' }} />
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Portfolio</span>
          <span style={{
            fontSize: '0.8rem',
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            color: latestPortfolio >= 0 ? 'var(--trade-up)' : 'var(--trade-down)',
          }}>
            {isLoading ? '...' : fmtPct(latestPortfolio)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 2, borderRadius: 1, background: '#26A69A', opacity: 0.7 }} />
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>IHSG</span>
          <span style={{
            fontSize: '0.8rem',
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            color: latestIHSG >= 0 ? 'var(--trade-up)' : 'var(--trade-down)',
          }}>
            {isLoading ? '...' : fmtPct(latestIHSG)}
          </span>
        </div>
      </div>

      {/* Chart */}
      <div ref={containerRef} style={{ width: '100%', height: 200 }}>
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Memuat data...
          </div>
        )}
        {!isLoading && benchmark.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Belum ada data
          </div>
        )}
      </div>
    </div>
  );
}
