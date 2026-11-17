import { clsx } from "clsx";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Checkbox } from "./Form";

export interface Column<T> {
  key: string;
  header: ReactNode;
  width?: string | number;
  align?: "left" | "right" | "center";
  mono?: boolean;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null;
  render?: (row: T) => ReactNode;
  className?: string;
  /** Hide this column under the given breakpoint. */
  hideBelow?: "md" | "lg" | "xl";
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  selected?: Set<string | number>;
  onSelectedChange?: (next: Set<string | number>) => void;
  onRowClick?: (row: T) => void;
  activeKey?: string | number | null;
  empty?: ReactNode;
  dense?: boolean;
  maxHeight?: string;
  ariaLabel: string;
  rowTone?: (row: T) => "error" | "warning" | "success" | null;
  footer?: ReactNode;
  className?: string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  /** Fixed table layout: columns honour their width, the rest shares what is left. */
  fixedLayout?: boolean;
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;
const HIDE = { md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" } as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  selected,
  onSelectedChange,
  onRowClick,
  activeKey,
  empty,
  dense = true,
  maxHeight,
  ariaLabel,
  rowTone,
  footer,
  className,
  initialSort,
  fixedLayout = false,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(initialSort ?? null);
  void className;

  const ordered = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [rows, sort, columns]);

  const selectable = Boolean(selected && onSelectedChange);
  const allKeys = ordered.map((r, i) => rowKey(r, i));
  const allSelected = selectable && allKeys.length > 0 && allKeys.every((k) => selected!.has(k));
  const someSelected = selectable && !allSelected && allKeys.some((k) => selected!.has(k));

  const toggleAll = () => {
    if (!selectable) return;
    onSelectedChange!(allSelected ? new Set() : new Set(allKeys));
  };

  const toggleRow = (key: string | number) => {
    if (!selectable) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedChange!(next);
  };

  const thPad = dense ? "h-7 px-2" : "h-8 px-3";
  const tdPad = dense ? "h-7 px-2" : "h-9 px-3";

  return (
    <div className={clsx("w-full overflow-auto", maxHeight && "overflow-y-auto")} style={maxHeight ? { maxHeight } : undefined}>
      <table
        className="w-full border-collapse text-[12px]"
        style={fixedLayout ? { tableLayout: "fixed" } : undefined}
        aria-label={ariaLabel}
      >
        <thead className="dt-head">
          <tr>
            {selectable && (
              <th className={clsx(thPad, "w-8")}>
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                  className="justify-center"
                />
              </th>
            )}
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: typeof c.width === "number" ? `${c.width}px` : c.width } : undefined}
                className={clsx(
                  thPad,
                  "text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline whitespace-nowrap",
                  ALIGN[c.align ?? "left"],
                  c.hideBelow && HIDE[c.hideBelow],
                  c.sortable && "cursor-pointer select-none hover:text-on-surface",
                )}
                onClick={
                  c.sortable
                    ? () =>
                        setSort((prev) =>
                          prev?.key === c.key
                            ? prev.dir === "asc"
                              ? { key: c.key, dir: "desc" }
                              : null
                            : { key: c.key, dir: "asc" },
                        )
                    : undefined
                }
                aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
              >
                <span className={clsx("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                  {c.header}
                  {c.sortable &&
                    (sort?.key === c.key ? (
                      sort.dir === "asc" ? (
                        <ArrowUp size={10} className="text-primary-soft" />
                      ) : (
                        <ArrowDown size={10} className="text-primary-soft" />
                      )
                    ) : (
                      <ChevronsUpDown size={10} className="opacity-40" />
                    ))}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.length === 0 && (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-3 py-10">
                {empty}
              </td>
            </tr>
          )}
          {ordered.map((row, i) => {
            const key = rowKey(row, i);
            const isSelected = selectable ? selected!.has(key) : false;
            const tone = rowTone?.(row) ?? null;
            return (
              <tr
                key={key}
                data-selected={isSelected}
                onClick={() => onRowClick?.(row)}
                className={clsx(
                  "dt-row group",
                  (onRowClick || selectable) && "cursor-pointer",
                  activeKey !== null && activeKey !== undefined && activeKey === key && "bg-primary/[0.09]",
                  i % 2 === 1 && !isSelected && "bg-white/[0.014]",
                )}
              >
                {selectable && (
                  <td className={clsx(tdPad, "w-8")} onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={isSelected} onChange={() => toggleRow(key)} className="justify-center" />
                  </td>
                )}
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={clsx(
                      tdPad,
                      "align-middle",
                      ALIGN[c.align ?? "left"],
                      c.mono && "font-mono text-[11.5px] tnum",
                      c.hideBelow && HIDE[c.hideBelow],
                      tone === "error" && "text-error/90",
                      tone === "warning" && "text-warning/90",
                      tone === "success" && "text-secondary/90",
                      c.className,
                    )}
                  >
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {footer && <tfoot className="border-t border-white/[0.07] bg-black/20">{footer}</tfoot>}
      </table>
    </div>
  );
}
