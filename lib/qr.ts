import "server-only";
import qrcode from "qrcode-generator";

/**
 * Encode text as a QR matrix. Rows are strings of "1" (dark) / "0" (light) so the
 * result is serializable and can be passed from a Server to a Client Component.
 * Error correction "Q" (~25%) keeps a printed code scannable when scuffed or at an angle.
 */
export function qrMatrix(text: string): string[] {
  const qr = qrcode(0, "Q");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const rows: string[] = [];
  for (let r = 0; r < n; r++) {
    let row = "";
    for (let c = 0; c < n; c++) row += qr.isDark(r, c) ? "1" : "0";
    rows.push(row);
  }
  return rows;
}
