/**
 * The QR codes on the printed sheets (Roof Care step 4), made by the site itself: no outside
 * service is asked and no picture is fetched from the internet, so a code can never stop
 * working because somebody else's website did. A code holds one thing: a web address.
 */
import { create } from "qrcode";

/** The code as a square of cells: true is a dark cell. No quiet edge. */
export interface QrCells {
  size: number;
  cells: boolean[];
}

/**
 * Error correction Q: a quarter of the code can be damaged (a crease, a coffee ring on a
 * leave-behind) and it still reads.
 */
export function qrCells(text: string): QrCells {
  const q = create(text, { errorCorrectionLevel: "Q" });
  const size = q.modules.size;
  const cells: boolean[] = [];
  for (let i = 0; i < size * size; i++) cells.push(!!q.modules.data[i]);
  return { size, cells };
}

/** The light edge a phone needs round a code, in cells. */
export const QR_QUIET_CELLS = 4;

/** The code as an SVG picture: sharp at any printed size. */
export function qrSvg(text: string, title = "QR code"): string {
  const { size, cells } = qrCells(text);
  const full = size + QR_QUIET_CELLS * 2;
  let path = "";
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (cells[y * size + x]) path += `M${x + QR_QUIET_CELLS} ${y + QR_QUIET_CELLS}h1v1h-1z`;
  const safe = title.replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges" role="img" aria-label="${safe}"><rect width="${full}" height="${full}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/**
 * The code as plain pixels (red, green, blue, opacity for each), `scale` pixels to a cell, with
 * its light edge: what a canvas draws for the downloaded picture, and what a reader is given.
 */
export function qrPixels(
  text: string,
  scale: number,
): { width: number; height: number; data: Uint8ClampedArray } {
  const { size, cells } = qrCells(text);
  const s = Math.max(1, Math.floor(scale));
  const side = (size + QR_QUIET_CELLS * 2) * s;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (!cells[y * size + x]) continue;
      for (let dy = 0; dy < s; dy++)
        for (let dx = 0; dx < s; dx++) {
          const i = (((y + QR_QUIET_CELLS) * s + dy) * side + (x + QR_QUIET_CELLS) * s + dx) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
    }
  return { width: side, height: side, data };
}
