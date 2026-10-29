import { Select } from './Select';

export function Pagination({ total, page, pageSize, setPage, setPageSize }: {
  total: number; page: number; pageSize: number; setPage: (page: number) => void; setPageSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="table-pagination" role="navigation" aria-label="Table pagination">
    <span className="page-range" aria-live="polite">{total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)} of {total}</span>
    <span>Rows per page</span><Select label="Rows per page" value={String(pageSize)} options={['10', '25', '50', '100']} onChange={value => setPageSize(Number(value))} compact />
    <span>Page {page} of {pages}</span><span className="page-nav">
      <button type="button" className="btn btn-ghost btn-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
      <button type="button" className="btn btn-ghost btn-sm" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button>
    </span>
  </div>;
}
