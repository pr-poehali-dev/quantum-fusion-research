import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import PublicRunCard, { PublicRun } from "@/components/PublicRunCard"

// Витрина «последний тест» на публичной странице программы: показываем
// реальный отчёт с наших стендов, чтобы было видно, что даёт программа.

export default function LastPublicRun() {
  const [run, setRun] = useState<PublicRun | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.stress.lastPublicRun()
      .then(d => setRun(d?.run || null))
      .catch(() => setRun(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading || !run) return null

  return (
    <section className="mx-auto max-w-3xl px-6 pb-4 pt-10">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-light sm:text-3xl">Последний тест</h2>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
          вживую с наших стендов
        </span>
      </div>

      <PublicRunCard run={run} />

      <p className="mt-3 text-center text-xs text-foreground/40">
        Такой же отчёт программа соберёт и на вашем компьютере
      </p>
    </section>
  )
}
