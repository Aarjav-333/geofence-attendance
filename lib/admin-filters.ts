import type { SubmissionFilters } from "@/types/submission";

type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** Parse untrusted URL search params into safe, bounded query filters. */
export function parseFilters(params: RawParams): SubmissionFilters {
  const status = first(params.status);
  const page = Number(first(params.page));
  return {
    q: first(params.q)?.slice(0, 100),
    department: first(params.department)?.slice(0, 100),
    status: status === "WITHIN_RANGE" || status === "OUTSIDE_RANGE" ? status : undefined,
    sort: first(params.sort) === "oldest" ? "oldest" : "newest",
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 100_000) : 1,
    pageSize: 25,
  };
}

export function filtersToSearch(f: SubmissionFilters, overrides: Partial<SubmissionFilters> = {}): string {
  const merged = { ...f, ...overrides };
  const sp = new URLSearchParams();
  if (merged.q) sp.set("q", merged.q);
  if (merged.department) sp.set("department", merged.department);
  if (merged.status) sp.set("status", merged.status);
  if (merged.sort === "oldest") sp.set("sort", "oldest");
  if (merged.page && merged.page > 1) sp.set("page", String(merged.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
