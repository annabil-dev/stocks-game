/**
 * Dynamic Liquidity Manager
 *
 * Modes: HIGH / MEDIUM / LOW
 * - HIGH:  active market, tight spreads, frequent bot activity
 * - MEDIUM: normal activity (default)
 * - LOW:   bots rest, orderbook static
 *
 * Mode auto-switches every 30-60 seconds.
 * Emits LIQUIDITY_CHANGED event via EventManager.
 */

import { io } from '../index';
import { marketEvents, MarketEventType } from './eventManager';

// ── Types ──────────────────────────────────────────────────────────────────

export type LiquidityMode = 'HIGH' | 'MEDIUM' | 'LOW';

export interface LiquidityConfig {
  activityChance: number;      // probability a bot fires per tick
  spreadThreshold: number;     // max ticks for spread (MM bots stay within this)
  wallThreshold: number;       // lots considered a "wall" in orderbook
  mmMinQty: number;            // min lots for market-maker orders
  mmMaxQty: number;            // max lots for market-maker orders
  spoofMinQty: number;         // min lots for spoof/institution orders
  spoofMaxQty: number;         // max lots for spoof/institution orders
  baseVolatility: number;      // volatility multiplier (0.5-2.0)
}

// ── Mode configs ──────────────────────────────────────────────────────────

const MODE_CONFIGS: Record<LiquidityMode, LiquidityConfig> = {
  HIGH: {
    activityChance: 0.40,
    spreadThreshold: 1,
    wallThreshold: 3000,
    mmMinQty: 5,
    mmMaxQty: 20,
    spoofMinQty: 300,
    spoofMaxQty: 2000,
    baseVolatility: 1.8,
  },
  MEDIUM: {
    activityChance: 0.10,
    spreadThreshold: 2,
    wallThreshold: 5000,
    mmMinQty: 3,
    mmMaxQty: 10,
    spoofMinQty: 200,
    spoofMaxQty: 1000,
    baseVolatility: 1.0,
  },
  LOW: {
    activityChance: 0.05,
    spreadThreshold: 3,
    wallThreshold: 8000,
    mmMinQty: 1,
    mmMaxQty: 5,
    spoofMinQty: 100,
    spoofMaxQty: 500,
    baseVolatility: 0.5,
  },
};

// ── State ─────────────────────────────────────────────────────────────────

let currentMode: LiquidityMode = 'MEDIUM';
let switchTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

// ── Public API ────────────────────────────────────────────────────────────

export function getLiquidityMode(): LiquidityMode {
  return currentMode;
}

export function getLiquidityConfig(): LiquidityConfig {
  return MODE_CONFIGS[currentMode];
}

export function setLiquidityMode(mode: LiquidityMode): void {
  if (mode === currentMode) return;
  const prev = currentMode;
  currentMode = mode;
  console.log(`[LiquidityManager] Mode changed: ${prev} → ${mode}`);
  emitLiquidityChanged(prev, mode);
}

export function startLiquidityManager(): void {
  if (running) return;
  running = true;
  console.log('[LiquidityManager] Starting auto-switch loop...');
  scheduleNextSwitch();
}

export function stopLiquidityManager(): void {
  running = false;
  if (switchTimer) {
    clearTimeout(switchTimer);
    switchTimer = null;
  }
}

// ── Auto-switch logic ────────────────────────────────────────────────────

function scheduleNextSwitch(): void {
  if (!running) return;
  // Random interval between 30-60 seconds
  const delay = 30000 + Math.random() * 30000;
  switchTimer = setTimeout(() => {
    if (!running) return;
    const newMode = pickRandomMode();
    setLiquidityMode(newMode);
    scheduleNextSwitch();
  }, delay);
}

function pickRandomMode(): LiquidityMode {
  // Weighted random: MEDIUM most common, HIGH and LOW less frequent
  const weights: Record<LiquidityMode, number> = {
    HIGH: 0.25,
    MEDIUM: 0.50,
    LOW: 0.25,
  };
  const r = Math.random();
  if (r < weights.HIGH) return 'HIGH';
  if (r < weights.HIGH + weights.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

// ── Event emission ────────────────────────────────────────────────────────

function emitLiquidityChanged(prev: LiquidityMode, next: LiquidityMode): void {
  const config = MODE_CONFIGS[next];
  const timestamp = new Date().toISOString();

  // Emit via event bus
  marketEvents.emit({
    type: MarketEventType.LIQUIDITY_CHANGED,
    stockId: '__global__',
    previousMode: prev,
    currentMode: next,
    config,
    timestamp,
  } as any);

  // Also emit directly via Socket.IO
  io.emit('LIQUIDITY_CHANGED', {
    previousMode: prev,
    currentMode: next,
    config,
    timestamp,
  });
}
