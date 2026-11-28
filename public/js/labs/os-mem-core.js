/** 操作系统存储与外存交互判分核心（地址变换 / 动态分区 / 位示图，零 DOM 依赖） */

const nearNum = (u, exp, eps = 0.05) => {
  if (u === "" || u == null) return false;
  const n = Number(u);
  return Number.isFinite(n) && Math.abs(n - Number(exp)) <= eps;
};

export const OS_MEM_CASES = [
  {
    id: "mem_page_tlb",
    name: "分页地址变换与快表 EAT 计算（纲要图 3-13 原例）",
    mode: "addr",
    addrType: "page",
    pageSizeBytes: 1024,
    logicAddr: 2500,
    pageTable: [2, 4, 5, 7],
    memNs: 200,
    tlbHitPct: 75,
    tlbNs: 0
  },
  {
    id: "mem_segment",
    name: "分段存储系统地址变换（纲要分段原例）",
    mode: "addr",
    addrType: "seg",
    logicSeg: 2,
    logicOffset: 100,
    segTable: [
      { seg: 0, len: 1024, base: 6144 },
      { seg: 1, len: 600, base: 4096 },
      { seg: 2, len: 500, base: 8192 },
      { seg: 3, len: 200, base: 9200 }
    ]
  },
  {
    id: "mem_alloc_ff",
    name: "动态分区首次适应（FF）与最佳适应（BF）对比",
    mode: "alloc",
    algo: "ff",
    partitions: [
      { id: "块1", base: 20, size: 100 },
      { id: "块2", base: 140, size: 40 },
      { id: "块3", base: 210, size: 200 },
      { id: "块4", base: 440, size: 80 }
    ],
    jobs: [
      { id: "J1", size: 50 },
      { id: "J2", size: 120 },
      { id: "J3", size: 35 }
    ]
  },
  {
    id: "mem_alloc_bf",
    name: "动态分区最佳适应算法（BF）分配演练",
    mode: "alloc",
    algo: "bf",
    partitions: [
      { id: "块1", base: 20, size: 100 },
      { id: "块2", base: 140, size: 40 },
      { id: "块3", base: 210, size: 200 },
      { id: "块4", base: 440, size: 80 }
    ],
    jobs: [
      { id: "J1", size: 50 },
      { id: "J2", size: 35 },
      { id: "J3", size: 120 }
    ]
  },
  {
    id: "mem_bitmap_recycle",
    name: "磁盘位示图回收盘块计算与标记（下标从 1 起）",
    mode: "bitmap",
    op: "recycle",
    rows: 4,
    cols: 8,
    baseIndex: 1,
    occupied: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 19, 20],
    targetBlock: 19
  },
  {
    id: "mem_bitmap_alloc",
    name: "磁盘位示图扫描分配空闲盘块（下标从 1 起）",
    mode: "bitmap",
    op: "alloc",
    rows: 4,
    cols: 8,
    baseIndex: 1,
    occupied: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  }
];

export const solveOsMem = (caseDef) => {
  if (caseDef.mode === "addr") {
    if (caseDef.addrType === "seg") {
      const entry = (caseDef.segTable || []).find((s) => s.seg === caseDef.logicSeg);
      const valid = Boolean(entry) && caseDef.logicOffset >= 0 && caseDef.logicOffset < entry.len;
      return {
        addrType: "seg",
        valid,
        baseAddr: entry?.base ?? -1,
        physAddr: valid ? entry.base + caseDef.logicOffset : -1
      };
    }
    const pageNo = Math.floor(caseDef.logicAddr / caseDef.pageSizeBytes);
    const offset = caseDef.logicAddr % caseDef.pageSizeBytes;
    const valid = pageNo >= 0 && pageNo < (caseDef.pageTable || []).length;
    const frameNo = valid ? caseDef.pageTable[pageNo] : -1;
    const physAddr = valid ? frameNo * caseDef.pageSizeBytes + offset : -1;
    const h = (caseDef.tlbHitPct || 0) / 100;
    const t = Number(caseDef.memNs || 0);
    const tTlb = Number(caseDef.tlbNs || 0);
    const eatNs = Math.round((tTlb + t) * h + (tTlb + 2 * t) * (1 - h));
    return { addrType: "page", valid, pageNo, offset, frameNo, physAddr, eatNs };
  }

  if (caseDef.mode === "alloc") {
    const parts = (caseDef.partitions || []).map((p) => ({ ...p, free: p.size, usedBy: [] }));
    const assignments = [];
    for (const job of caseDef.jobs || []) {
      const cands = parts.filter((p) => p.free >= job.size);
      if (!cands.length) { assignments.push({ jobId: job.id, partId: "", allocBase: -1, remain: -1 }); continue; }
      if (caseDef.algo === "bf") cands.sort((a, b) => a.free - b.free || a.base - b.base);
      else if (caseDef.algo === "wf") cands.sort((a, b) => b.free - a.free || a.base - b.base);
      else cands.sort((a, b) => a.base - b.base);
      const picked = cands[0];
      const allocBase = picked.base + (picked.size - picked.free);
      picked.free -= job.size;
      picked.usedBy.push({ jobId: job.id, size: job.size });
      assignments.push({ jobId: job.id, partId: picked.id, allocBase, remain: picked.free });
    }
    return { assignments, finalParts: parts };
  }

  const cols = caseDef.cols || 8;
  const rows = caseDef.rows || 4;
  const baseIdx = Number(caseDef.baseIndex ?? 1);
  const occSet = new Set(caseDef.occupied || []);
  const grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const b = r * cols + c + baseIdx;
      return occSet.has(b) ? 1 : 0;
    })
  );
  if (caseDef.op === "recycle") {
    const b = Number(caseDef.targetBlock ?? baseIdx);
    const offset = b - baseIdx;
    const row = Math.floor(offset / cols) + baseIdx;
    const col = (offset % cols) + baseIdx;
    return { op: "recycle", blockNo: b, row, col, nextVal: 0, grid };
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c] === 0) {
        const blockNo = r * cols + c + baseIdx;
        return { op: "alloc", blockNo, row: r + baseIdx, col: c + baseIdx, nextVal: 1, grid };
      }
    }
  }
  return { op: "alloc", blockNo: -1, row: -1, col: -1, nextVal: 1, grid };
};

export const gradeOsMem = (caseDef, attempt = {}) => {
  const sol = solveOsMem(caseDef);
  if (caseDef.mode === "addr") {
    if (caseDef.addrType === "seg") {
      const checks = {
        baseAddr: nearNum(attempt.baseAddr, sol.baseAddr, 0.01),
        physAddr: nearNum(attempt.physAddr, sol.physAddr, 0.01)
      };
      const score = Object.values(checks).filter(Boolean).length;
      return { score, total: 2, ratio: score / 2, allCorrect: score === 2, checks, solution: sol };
    }
    const checks = {
      pageNo: nearNum(attempt.pageNo, sol.pageNo, 0.01),
      offset: nearNum(attempt.offset, sol.offset, 0.01),
      frameNo: nearNum(attempt.frameNo, sol.frameNo, 0.01),
      physAddr: nearNum(attempt.physAddr, sol.physAddr, 0.01),
      eatNs: nearNum(attempt.eatNs, sol.eatNs, 0.1)
    };
    const score = Object.values(checks).filter(Boolean).length;
    return { score, total: 5, ratio: score / 5, allCorrect: score === 5, checks, solution: sol };
  }

  if (caseDef.mode === "alloc") {
    const uAssign = attempt.assignments || {};
    let score = 0;
    const total = sol.assignments.length * 2;
    const results = sol.assignments.map((a) => {
      const u = uAssign[a.jobId] || {};
      const pOk = String(u.partId || "") === a.partId;
      const bOk = nearNum(u.allocBase, a.allocBase, 0.01);
      if (pOk) score += 1;
      if (bOk) score += 1;
      return { jobId: a.jobId, pOk, bOk };
    });
    return { score, total, ratio: total ? score / total : 0, allCorrect: score === total, results, solution: sol };
  }

  const checks = {
    row: nearNum(attempt.row, sol.row, 0.01),
    col: nearNum(attempt.col, sol.col, 0.01),
    blockNo: nearNum(attempt.blockNo, sol.blockNo, 0.01),
    nextVal: nearNum(attempt.nextVal, sol.nextVal, 0.01)
  };
  const score = Object.values(checks).filter(Boolean).length;
  return { score, total: 4, ratio: score / 4, allCorrect: score === 4, checks, solution: sol };
};
