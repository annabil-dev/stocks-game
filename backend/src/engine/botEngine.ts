/**
 * Bot Engine — re-exports from AlgoEngine
 *
 * The old botEngine.ts (2 simple bots) has been replaced by algoEngine.ts
 * which implements 4 sophisticated personas:
 *  1. MARKET MAKER — fills spread gaps, maintains liquidity
 *  2. SWEEPER (HAKA/HAKI) — detects walls, sweeps aggressively
 *  3. SPOOFER/LAYERING — places fake walls, cancels after X seconds
 *  4. FOMO TRIGGER — large trade → all bots aggressive for 5 seconds
 *
 * All personas subscribe to EventManager events instead of polling.
 * The engine maintains an active_orders registry for cancellation.
 */

export { startAlgoEngine as startBotEngine, stopAlgoEngine as stopBotEngine, getEngineStats } from './algoEngine';