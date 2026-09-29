import { redirect } from "next/navigation";

// The workplace QR code points at /attendance; the bare domain goes there too.
export default function Home() {
  redirect("/attendance");
}
