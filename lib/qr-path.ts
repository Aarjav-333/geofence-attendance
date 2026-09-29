/**
 * One SVG path for all dark modules of a QR matrix (rows of "1"/"0"), in module
 * units. Shared by the server-rendered poster and the client-side SVG download.
 */
export function qrPath(rows: string[], offset = 0): string {
  let d = "";
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === "1") d += `M${c + offset} ${r + offset}h1v1h-1z`;
    }
  });
  return d;
}
