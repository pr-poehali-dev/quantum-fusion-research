// Пакетная обработка массива с ограничением параллелизма.
// Отправляем по `size` задач параллельно, ждём их завершения, пауза `pauseMs`,
// затем следующий пакет. Нужно, чтобы не бомбить бэкенд «залпом» запросов.

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function runBatched<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: { size?: number; pauseMs?: number; onResult?: (item: T, result: R, index: number) => void } = {},
): Promise<R[]> {
  const size = opts.size ?? 3
  const pauseMs = opts.pauseMs ?? 300
  const results: R[] = []
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size)
    const chunkRes = await Promise.all(
      chunk.map(async (it, j) => {
        const idx = i + j
        const r = await worker(it, idx)
        opts.onResult?.(it, r, idx)
        return r
      }),
    )
    results.push(...chunkRes)
    if (i + size < items.length && pauseMs > 0) await delay(pauseMs)
  }
  return results
}
