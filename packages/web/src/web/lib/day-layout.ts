export type LayoutInterval = { id: number; start: number; end: number };
export type ColumnAssignment = { col: number; cols: number };

/**
 * Assigns each interval a column (0-based) and the total column count of its overlap
 * cluster, so a day-grid can render side-by-side boxes instead of stacking overlapping
 * bookings on top of each other — the case a group class creates on purpose (several
 * people, the same slot). Two intervals never share a column; a cluster's column count
 * is the largest number simultaneously open at any instant within it (e.g. 6 identical
 * group-class bookings all get their own column, each 1/6 wide).
 */
export function layoutOverlaps(intervals: LayoutInterval[]): Map<number, ColumnAssignment> {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const result = new Map<number, ColumnAssignment>();

  let cluster: LayoutInterval[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const cols = colEnds.length || 1;
    for (const it of cluster) {
      const assigned = result.get(it.id);
      if (assigned) result.set(it.id, { col: assigned.col, cols });
    }
    cluster = [];
    colEnds = [];
    clusterEnd = -Infinity;
  };

  for (const it of sorted) {
    if (cluster.length > 0 && it.start >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.end);
    } else {
      colEnds[col] = it.end;
    }
    result.set(it.id, { col, cols: 1 });
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();

  return result;
}
