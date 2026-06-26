interface DiffLine {
  kind: 'eq' | 'add' | 'del'
  text: string
}

/** Word-level LCS diff. Splits on whitespace, keeps whitespace in output. */
export function diffLines(a: string, b: string): DiffLine[] {
  const aw = a.split(/(\s+)/)
  const bw = b.split(/(\s+)/)
  const m = aw.length
  const n = bw.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const ai = aw[i]!
      const bj = bw[j]!
      dp[i]![j] = ai === bj ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  let buf: { kind: DiffLine['kind']; text: string } | null = null as { kind: DiffLine['kind']; text: string } | null
  const flush = (): void => {
    if (buf !== null) {
      out.push({ kind: buf.kind, text: buf.text })
      buf = null
    }
  }
  while (i < m && j < n) {
    if (aw[i] === bw[j]) {
      if (buf?.kind !== 'eq') flush()
      buf = { kind: 'eq', text: (buf?.text ?? '') + aw[i]! }
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      if (buf?.kind !== 'del') flush()
      buf = { kind: 'del', text: (buf?.text ?? '') + aw[i]! }
      i++
    } else {
      if (buf?.kind !== 'add') flush()
      buf = { kind: 'add', text: (buf?.text ?? '') + bw[j]! }
      j++
    }
  }
  while (i < m) {
    if (buf?.kind !== 'del') flush()
    buf = { kind: 'del', text: (buf?.text ?? '') + aw[i]! }
    i++
  }
  while (j < n) {
    if (buf?.kind !== 'add') flush()
    buf = { kind: 'add', text: (buf?.text ?? '') + bw[j]! }
    j++
  }
  flush()
  return out
}
