/**
 * IDX Tick Size rules (Fraksi Harga)
 * https://www.idx.co.id/id/data-pasar/panduan-perdagangan/fraksi-harga/
 * 
 * Harga (Rp)       Fraksi (Rp)  Maksimum Perubahan
 * < 200            1            Rp 10
 * 200 - < 500      2            Rp 20
 * 500 - < 2000     5            Rp 50
 * 2000 - < 5000    10           Rp 100
 * >= 5000          25           Rp 250
 */

export function getTickSize(price: number): number {
  if (price < 200) return 1;
  if (price < 500) return 2;
  if (price < 2000) return 5;
  if (price < 5000) return 10;
  return 25;
}

export function isValidTick(price: number): boolean {
  if (!Number.isInteger(price) || price <= 0) return false;
  
  // To validate if a price is valid on the tick scale, it should be a multiple of the tick size for its bracket.
  // Note: True validation means starting from the base of the bracket. 
  // For simplicity and common IDX behavior, price % tickSize === 0 is generally sufficient.
  
  const tickSize = getTickSize(price);
  return price % tickSize === 0;
}
