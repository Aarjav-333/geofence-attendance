"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/** Search / filter / sort controls. State lives in the URL so views are shareable and server-rendered. */
export function AdminFilters({ departments }: { departments: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page"); // any filter change returns to page 1
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  // Debounce free-text search
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => update("q", q.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = ["q", "department", "status", "sort"].some((k) => params.get(k));

  return (
    <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]" aria-busy={pending}>
      <input
        type="search"
        className="input py-2"
        placeholder="Search name, ID or department…"
        aria-label="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        className="input py-2"
        aria-label="Department"
        value={params.get("department") ?? ""}
        onChange={(e) => update("department", e.target.value)}
      >
        <option value="">All departments</option>
        {departments.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        className="input py-2"
        aria-label="Location status"
        value={params.get("status") ?? ""}
        onChange={(e) => update("status", e.target.value)}
      >
        <option value="">All statuses</option>
        <option value="WITHIN_RANGE">Within range</option>
        <option value="OUTSIDE_RANGE">Outside range</option>
      </select>
      <select
        className="input py-2"
        aria-label="Sort"
        value={params.get("sort") ?? "newest"}
        onChange={(e) => update("sort", e.target.value === "newest" ? "" : e.target.value)}
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
      <button
        type="button"
        className="btn-secondary py-2 text-sm"
        disabled={!hasFilters}
        onClick={() => {
          setQ("");
          startTransition(() => router.replace(pathname, { scroll: false }));
        }}
      >
        Clear
      </button>
    </div>
  );
}
