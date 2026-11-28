/** 操作系统核心算法与交互判分引擎（调度 / 银行家 / 页面置换 / 磁盘调度，零 DOM 依赖） */

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;
const nearNum = (u, exp, eps = 0.06) => {
  if (u === "" || u == null) return false;
  const n = Number(u);
  return Number.isFinite(n) && Math.abs(n - Number(exp)) <= eps;
};

export const OS_SCHED_CASES = [
  {
    id: "sched_fcfs_4",
    name: "FCFS 先来先服务 · 4 进程调度",
    algo: "fcfs",
    quantum: 4,
    processes: [
      { id: "P1", arrival: 0, burst: 8 },
      { id: "P2", arrival: 1, burst: 4 },
      { id: "P3", arrival: 2, burst: 9 },
      { id: "P4", arrival: 3, burst: 5 }
    ]
  },
  {
    id: "sched_sjf_4",
    name: "SJF 短作业优先（非抢占）· 4 进程调度",
    algo: "sjf",
    quantum: 4,
    processes: [
      { id: "P1", arrival: 0, burst: 7 },
      { id: "P2", arrival: 2, burst: 4 },
      { id: "P3", arrival: 4, burst: 1 },
      { id: "P4", arrival: 5, burst: 4 }
    ]
  },
  {
    id: "sched_hrrn_4",
    name: "HRRN 高响应比优先 · 4 进程调度",
    algo: "hrrn",
    quantum: 4,
    processes: [
      { id: "P1", arrival: 0, burst: 3 },
      { id: "P2", arrival: 2, burst: 6 },
      { id: "P3", arrival: 4, burst: 4 },
      { id: "P4", arrival: 6, burst: 5 }
    ]
  },
  {
    id: "sched_rr_4",
    name: "RR 时间片轮转（q=2）· 4 进程调度",
    algo: "rr",
    quantum: 2,
    processes: [
      { id: "P1", arrival: 0, burst: 5 },
      { id: "P2", arrival: 1, burst: 3 },
      { id: "P3", arrival: 2, burst: 4 },
      { id: "P4", arrival: 3, burst: 2 }
    ]
  }
];

export const solveOsScheduling = (caseDef) => {
  const procs = (caseDef?.processes || []).map((p, idx) => ({ ...p, order: idx, remain: Number(p.burst) }));
  const algo = caseDef?.algo || "fcfs";
  const quantum = Math.max(1, Number(caseDef?.quantum || 2));
  const gantt = [];
  const finishMap = new Map();
  let time = 0;

  if (algo === "rr") {
    const sorted = [...procs].sort((a, b) => a.arrival - b.arrival || a.order - b.order);
    const ready = [];
    let ptr = 0;
    const enqueueArrivals = (limit) => {
      while (ptr < sorted.length && sorted[ptr].arrival <= limit) ready.push(sorted[ptr++]);
    };
    enqueueArrivals(time);
    while (ready.length || ptr < sorted.length) {
      if (!ready.length) {
        time = sorted[ptr].arrival;
        enqueueArrivals(time);
      }
      const cur = ready.shift();
      const run = Math.min(quantum, cur.remain);
      const start = time;
      time += run;
      cur.remain -= run;
      gantt.push({ id: cur.id, start, end: time });
      enqueueArrivals(time);
      if (cur.remain > 0) ready.push(cur);
      else finishMap.set(cur.id, time);
    }
  } else {
    const done = new Set();
    while (done.size < procs.length) {
      const avail = procs.filter((p) => !done.has(p.id) && p.arrival <= time);
      if (!avail.length) {
        time = Math.min(...procs.filter((p) => !done.has(p.id)).map((p) => p.arrival));
        continue;
      }
      avail.sort((a, b) => {
        if (algo === "sjf") return a.burst - b.burst || a.arrival - b.arrival;
        if (algo === "hrrn") {
          const rA = 1 + (time - a.arrival) / a.burst;
          const rB = 1 + (time - b.arrival) / b.burst;
          return rB - rA || a.arrival - b.arrival;
        }
        return a.arrival - b.arrival || a.order - b.order;
      });
      const cur = avail[0];
      const start = time;
      time += cur.burst;
      gantt.push({ id: cur.id, start, end: time });
      finishMap.set(cur.id, time);
      done.add(cur.id);
    }
  }

  const rows = procs.map((p) => {
    const finish = finishMap.get(p.id) ?? 0;
    const turnaround = finish - p.arrival;
    const weighted = round2(turnaround / p.burst);
    return { id: p.id, arrival: p.arrival, burst: p.burst, finish, turnaround, weighted };
  });
  const n = rows.length || 1;
  return {
    gantt,
    rows,
    avgTurnaround: round2(rows.reduce((s, r) => s + r.turnaround, 0) / n),
    avgWeighted: round2(rows.reduce((s, r) => s + r.weighted, 0) / n)
  };
};

export const gradeOsScheduling = (caseDef, attempt = {}) => {
  const sol = solveOsScheduling(caseDef);
  const uRows = attempt.rows || {};
  const rowResults = {};
  let score = 0;
  let total = sol.rows.length * 3 + 2;

  for (const r of sol.rows) {
    const u = uRows[r.id] || {};
    const fOk = nearNum(u.finish, r.finish, 0.01);
    const tOk = nearNum(u.turnaround, r.turnaround, 0.01);
    const wOk = nearNum(u.weighted, r.weighted, 0.05);
    rowResults[r.id] = { fOk, tOk, wOk };
    if (fOk) score += 1;
    if (tOk) score += 1;
    if (wOk) score += 1;
  }
  const avgTOk = nearNum(attempt.avgTurnaround, sol.avgTurnaround, 0.05);
  const avgWOk = nearNum(attempt.avgWeighted, sol.avgWeighted, 0.05);
  if (avgTOk) score += 1;
  if (avgWOk) score += 1;
  const allCorrect = score === total;
  return { score, total, ratio: total ? score / total : 0, allCorrect, avgTOk, avgWOk, rowResults, solution: sol };
};

export const OS_BANKER_CASES = [
  {
    id: "banker_safe_5",
    name: "银行家算法 · T0 时刻安全序列检查（5 进程 3 类资源）",
    resources: ["A", "B", "C"],
    available: [3, 3, 2],
    processes: [
      { id: "P0", alloc: [0, 1, 0], max: [7, 5, 3] },
      { id: "P1", alloc: [2, 0, 0], max: [3, 2, 2] },
      { id: "P2", alloc: [3, 0, 2], max: [9, 0, 2] },
      { id: "P3", alloc: [2, 1, 1], max: [2, 2, 2] },
      { id: "P4", alloc: [0, 0, 2], max: [4, 3, 3] }
    ],
    request: null
  },
  {
    id: "banker_req_p1",
    name: "银行家算法 · 请求试探 P1 申请 (1, 0, 2)",
    resources: ["A", "B", "C"],
    available: [3, 3, 2],
    processes: [
      { id: "P0", alloc: [0, 1, 0], max: [7, 5, 3] },
      { id: "P1", alloc: [2, 0, 0], max: [3, 2, 2] },
      { id: "P2", alloc: [3, 0, 2], max: [9, 0, 2] },
      { id: "P3", alloc: [2, 1, 1], max: [2, 2, 2] },
      { id: "P4", alloc: [0, 0, 2], max: [4, 3, 3] }
    ],
    request: { pid: "P1", vec: [1, 0, 2] }
  }
];

const findSafeSeq = (procs, avail) => {
  const work = [...avail];
  const finish = new Set();
  const seq = [];
  let progressed = true;
  while (finish.size < procs.length && progressed) {
    progressed = false;
    for (const p of procs) {
      if (finish.has(p.id)) continue;
      if (p.need.every((v, j) => v <= work[j])) {
        p.alloc.forEach((v, j) => { work[j] += v; });
        finish.add(p.id);
        seq.push(p.id);
        progressed = true;
      }
    }
  }
  return { safe: finish.size === procs.length, seq };
};

export const solveBankerCase = (caseDef) => {
  const procs = (caseDef?.processes || []).map((p) => ({
    ...p,
    need: p.max.map((m, j) => m - p.alloc[j])
  }));
  let postAvail = [...(caseDef?.available || [])];
  let canGrant = true;
  let postProcs = procs.map((p) => ({ ...p, alloc: [...p.alloc], need: [...p.need] }));

  if (caseDef?.request) {
    const { pid, vec } = caseDef.request;
    const target = postProcs.find((p) => p.id === pid);
    const leNeed = target && vec.every((v, j) => v <= target.need[j]);
    const leAvail = vec.every((v, j) => v <= postAvail[j]);
    if (!leNeed || !leAvail) {
      canGrant = false;
    } else {
      postAvail = postAvail.map((a, j) => a - vec[j]);
      target.alloc = target.alloc.map((a, j) => a + vec[j]);
      target.need = target.need.map((n, j) => n - vec[j]);
    }
  }

  const check = canGrant ? findSafeSeq(postProcs, postAvail) : { safe: false, seq: [] };
  return { needRows: Object.fromEntries(procs.map((p) => [p.id, p.need])), safe: check.safe, safeSeq: check.seq, postAvail, postProcs };
};

export const gradeBankerAttempt = (caseDef, attempt = {}) => {
  const sol = solveBankerCase(caseDef);
  const procs = caseDef?.processes || [];
  const resCount = (caseDef?.resources || []).length;
  const uNeed = attempt.need || {};
  let score = 0;
  let total = procs.length * resCount + 2;
  const needOk = {};

  for (const p of procs) {
    const expRow = sol.needRows[p.id];
    const uRow = uNeed[p.id] || [];
    needOk[p.id] = expRow.map((val, j) => {
      const ok = uRow[j] !== "" && uRow[j] != null && Number(uRow[j]) === val;
      if (ok) score += 1;
      return ok;
    });
  }

  const decOk = Boolean(attempt.safe) === sol.safe;
  if (decOk) score += 1;

  let seqOk = false;
  if (!sol.safe) {
    seqOk = decOk && (!attempt.sequence || attempt.sequence.length === 0);
  } else if (Array.isArray(attempt.sequence) && attempt.sequence.length === procs.length) {
    const work = [...sol.postAvail];
    const seen = new Set();
    const map = new Map(sol.postProcs.map((p) => [p.id, p]));
    seqOk = attempt.sequence.every((pid) => {
      const p = map.get(pid);
      if (!p || seen.has(pid) || !p.need.every((v, j) => v <= work[j])) return false;
      p.alloc.forEach((v, j) => { work[j] += v; });
      seen.add(pid);
      return true;
    });
  }
  if (seqOk) score += 1;
  return { score, total, ratio: total ? score / total : 0, allCorrect: score === total, needOk, decOk, seqOk, solution: sol };
};

export const OS_PAGING_CASES = [
  {
    id: "paging_fifo_3",
    name: "FIFO 先进先出置换 · 3 物理块（12 次访问）",
    algo: "fifo",
    frames: 3,
    refs: [4, 3, 2, 1, 4, 3, 5, 4, 3, 2, 1, 5]
  },
  {
    id: "paging_lru_3",
    name: "LRU 最近最久未使用 · 3 物理块（12 次访问）",
    algo: "lru",
    frames: 3,
    refs: [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3]
  },
  {
    id: "paging_opt_3",
    name: "OPT 最佳置换 · 3 物理块（12 次访问）",
    algo: "opt",
    frames: 3,
    refs: [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3]
  }
];

export const solveOsPaging = (caseDef) => {
  const cap = Math.max(1, Number(caseDef?.frames || 3));
  const refs = caseDef?.refs || [];
  const algo = caseDef?.algo || "fifo";
  const slots = Array(cap).fill(null);
  const queue = [];
  const lastUsed = new Map();
  const steps = [];
  let faultCount = 0;

  refs.forEach((page, idx) => {
    let fault = false;
    if (!slots.includes(page)) {
      fault = true;
      faultCount += 1;
      const emptyIdx = slots.indexOf(null);
      if (emptyIdx >= 0) {
        slots[emptyIdx] = page;
        queue.push(emptyIdx);
      } else if (algo === "fifo") {
        const vicSlot = queue.shift();
        slots[vicSlot] = page;
        queue.push(vicSlot);
      } else if (algo === "lru") {
        let vicSlot = 0;
        let minStep = Infinity;
        slots.forEach((p, si) => {
          const t = lastUsed.get(p) ?? -1;
          if (t < minStep) { minStep = t; vicSlot = si; }
        });
        slots[vicSlot] = page;
      } else {
        let vicSlot = 0;
        let maxNext = -1;
        slots.forEach((p, si) => {
          const nxt = refs.indexOf(p, idx + 1);
          const dist = nxt === -1 ? Infinity : nxt;
          if (dist > maxNext) { maxNext = dist; vicSlot = si; }
        });
        slots[vicSlot] = page;
      }
    }
    lastUsed.set(page, idx);
    steps.push({ step: idx, page, frames: [...slots], fault });
  });

  return { steps, faultCount, faultRate: round1((faultCount / (refs.length || 1)) * 100) };
};

export const gradeOsPaging = (caseDef, attempt = {}) => {
  const sol = solveOsPaging(caseDef);
  const uFaults = Array.isArray(attempt.faults) ? attempt.faults : [];
  const uFrames = Array.isArray(attempt.frames) ? attempt.frames : [];
  let score = 0;
  const total = sol.steps.length * 2 + 2;
  const stepResults = sol.steps.map((st, idx) => {
    const fOk = Boolean(uFaults[idx]) === st.fault;
    const uSet = [...new Set((uFrames[idx] || []).map((v) => (v === "" || v == null ? null : Number(v))).filter((v) => v != null))].sort((a, b) => a - b);
    const eSet = [...new Set(st.frames.filter((v) => v != null))].sort((a, b) => a - b);
    const memOk = uSet.length === eSet.length && uSet.every((v, i) => v === eSet[i]);
    if (fOk) score += 1;
    if (memOk) score += 1;
    return { fOk, memOk };
  });
  const cntOk = nearNum(attempt.faultCount, sol.faultCount, 0.01);
  const rateOk = nearNum(attempt.faultRate, sol.faultRate, 0.5);
  if (cntOk) score += 1;
  if (rateOk) score += 1;
  return { score, total, ratio: total ? score / total : 0, allCorrect: score === total, cntOk, rateOk, stepResults, solution: sol };
};

export const OS_DISK_CASES = [
  {
    id: "disk_sstf_53",
    name: "SSTF 最短寻道时间优先（当前磁头 53）",
    algo: "sstf",
    head: 53,
    direction: "up",
    minTrack: 0,
    maxTrack: 199,
    requests: [98, 183, 37, 122, 14, 124, 65, 67]
  },
  {
    id: "disk_scan_100",
    name: "SCAN 电梯调度（当前磁头 100，向磁道号增大方向移动）",
    algo: "scan",
    head: 100,
    direction: "up",
    minTrack: 0,
    maxTrack: 199,
    requests: [55, 58, 39, 18, 90, 160, 150, 38, 184]
  },
  {
    id: "disk_cscan_53",
    name: "CSCAN 循环扫描（当前磁头 53，向磁道号增大方向单向扫描）",
    algo: "cscan",
    head: 53,
    direction: "up",
    minTrack: 0,
    maxTrack: 199,
    requests: [98, 183, 37, 122, 14, 124, 65, 67]
  }
];

export const solveOsDisk = (caseDef) => {
  const algo = caseDef?.algo || "fcfs";
  const head = Number(caseDef?.head || 0);
  const reqs = [...(caseDef?.requests || [])].map(Number);
  const up = (caseDef?.direction || "up") !== "down";
  let sequence = [];

  if (algo === "fcfs") {
    sequence = reqs;
  } else if (algo === "sstf") {
    const pool = [...reqs];
    let cur = head;
    while (pool.length) {
      let bestIdx = 0;
      pool.forEach((t, i) => { if (Math.abs(t - cur) < Math.abs(pool[bestIdx] - cur)) bestIdx = i; });
      cur = pool.splice(bestIdx, 1)[0];
      sequence.push(cur);
    }
  } else {
    const high = reqs.filter((t) => t >= head).sort((a, b) => a - b);
    const low = reqs.filter((t) => t < head).sort((a, b) => a - b);
    if (algo === "scan") sequence = up ? [...high, ...low.reverse()] : [...low.reverse(), ...high];
    else sequence = up ? [...high, ...low] : [...low.reverse(), ...high.reverse()];
  }

  let cur = head;
  let totalSeek = 0;
  for (const t of sequence) { totalSeek += Math.abs(t - cur); cur = t; }
  return { sequence, totalSeek, avgSeek: round2(totalSeek / (sequence.length || 1)) };
};

export const gradeOsDisk = (caseDef, attempt = {}) => {
  const sol = solveOsDisk(caseDef);
  const rawSeq = Array.isArray(attempt.sequence)
    ? attempt.sequence
    : String(attempt.seqStr || "").split(/(?:->|[\s,，;；→])+/).filter(Boolean);
  const uSeq = rawSeq.map(Number).filter(Number.isFinite);
  let score = 0;
  const total = sol.sequence.length + 2;
  const seqResults = sol.sequence.map((t, i) => {
    const ok = uSeq[i] === t;
    if (ok) score += 1;
    return ok;
  });
  const totalOk = nearNum(attempt.totalSeek, sol.totalSeek, 0.01);
  const avgOk = nearNum(attempt.avgSeek, sol.avgSeek, 0.06);
  if (totalOk) score += 1;
  if (avgOk) score += 1;
  return { score, total, ratio: total ? score / total : 0, allCorrect: score === total && uSeq.length === sol.sequence.length, totalOk, avgOk, seqResults, solution: sol };
};
