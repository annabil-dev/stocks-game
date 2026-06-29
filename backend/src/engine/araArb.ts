// ── ARA/ARB (Auto Rejection Atas/Bawah) ─────────────────────
// BEI-style daily price limits. Calculated from referencePrice
// (previousClose = harga penutupan kemarin sebagai acuan).

import { getTickSize } from './tickSize';

/**
 * Round a price UP to the nearest valid tick size.
 */
export function roundUpToTick(price: number): number {
  const tick = getTickSize(price);
  return Math.ceil(price / tick) * tick;
}

/**
 * Round a price DOWN to the nearest valid tick size, minimum Rp1.
 */
export function roundDownToTick(price: number): number {
  const tick = getTickSize(price);
  const rounded = Math.floor(price / tick) * tick;
  return Math.max(rounded, 1);
}

/**
 * Get ARA/ARB percentage based on price band (IDX rules).
 * Harga acuan (previousClose):
 *   <= 200    → 35%
 *   <= 5.000  → 25%
 *   >  5.000  → 20%
 */
export function getARAARBPercentage(price: number): number {
  if (price <= 200) return 0.35;
  if (price <= 5000) return 0.25;
  return 0.20;
}

/**
 * Calculate ARA (Auto Rejection Atas) — upper daily limit.
 * referencePrice × (1 + percentage), rounded UP to nearest tick.
 */
export function calculateARA(referencePrice: number): number {
  const pct = getARAARBPercentage(referencePrice);
  const raw = referencePrice * (1 + pct);
  return roundUpToTick(raw);
}

/**
 * Calculate ARB (Auto Rejection Bawah) — lower daily limit.
 * referencePrice × (1 − percentage), rounded DOWN to nearest tick.
 * Minimum Rp1 (tidak boleh negatif/nol).
 */
export function calculateARB(referencePrice: number): number {
  const pct = getARAARBPercentage(referencePrice);
  const raw = referencePrice * (1 - pct);
  return roundDownToTick(raw);
}

/**
 * Compute all ARA/ARB values from a reference price.
 */
export function computeAraArb(referencePrice: number) {
  return {
    referencePrice,
    araPrice: calculateARA(referencePrice),
    arbPrice: calculateARB(referencePrice),
  };
}

/**
 * Check if a price is within ARA/ARB limits.
 * Returns { valid: boolean, reason?: string }
 */
export function checkAraArb(price: number, araPrice: number, arbPrice: number) {
  if (price > araPrice) {
    return { valid: false, reason: `Harga melebihi batas ARA (Auto Reject Atas) Rp${araPrice.toLocaleString('id-ID')}` };
  }
  if (price < arbPrice) {
    return { valid: false, reason: `Harga di bawah batas ARB (Auto Reject Bawah) Rp${arbPrice.toLocaleString('id-ID')}` };
  }
  return { valid: true };
}

/**
 * Clamp a price within ARA/ARB bounds.
 * Used by HAKA/HAKI sweep to stop at limits.
 */
export function clampToAraArb(price: number, araPrice: number, arbPrice: number): number {
  return Math.min(Math.max(price, arbPrice), araPrice);
}
