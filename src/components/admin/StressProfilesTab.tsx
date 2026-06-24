import { useEffect, useState, useCallback } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { getAdminKey } from "@/pages/admin/types"

interface TestItem {
  name: string
  program: string
  args: string
  working_dir: string
  duration_sec: number
  timeout_is_success: boolean
  success_exit_code: number
  report_files: string[]
}
interface Profile {
  id?: number
  name: string
  note: string
  tests: TestItem[]
  is_active: boolean
  sort_order: number
}

const emptyTest = (): TestItem => ({
  name: "", program: "", args: "", working_dir: "",
  duration_sec: 60, timeout_is_success: true, success_exit_code: 0, report_files: [],
})
const emptyProfile = (): Profile => ({
  name: "", note: "", tests: [emptyTest()], is_active: true, sort_order: 0,
})

export default function StressProfilesTab() {
  const adminKey = getAdminKey()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.stress.profilesList(adminKey)
      .then(d => setProfiles(d.profiles || []))
      .finally(() => setLoading(false))
  }, [adminKey])

  useEffect(() => { load() }, [load])

  const save = () => {
    if (!edit) return
    if (!edit.name.trim()) { alert("Укажите название профиля"); return }
    setSaving(true)
    api.stress.profileSave(edit, adminKey).then(() => {
      setEdit(null)
      load()
    }).finally(() => setSaving(false))
  }

  const remove = (id?: number) => {
    if (!id) return
    if (!confirm("Удалить профиль?")) return
    api.stress.profileDelete(id, adminKey).then(load)
  }

  // ── Хелперы редактирования тестов ──
  const updTest = (i: number, patch: Partial<TestItem>) => {
    if (!edit) return
    const tests = edit.tests.map((t, idx) => idx === i ? { ...t, ...patch } : t)
    setEdit({ ...edit, tests })
  }
  const addTest = () => edit && setEdit({ ...edit, tests: [...edit.tests, emptyTest()] })
  const delTest = (i: number) => edit && setEdit({ ...edit, tests: edit.tests.filter((_, idx) => idx !== i) })
  const moveTest = (i: number, dir: -1 | 1) => {
    if (!edit) return
    const j = i + dir
    if (j < 0 || j >= edit.tests.length) return
    const tests = [...edit.tests]
    ;[tests[i], tests[j]] = [tests[j], tests[i]]
    setEdit({ ...edit, tests })
  }

  // ─────────────────────────── Редактор профиля ───────────────────────────
  if (edit) {
    return (
      <div className="max-w-3xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{edit.id ? "Редактирование профиля" : "Новый профиль"}</h2>
          <button onClick={() => setEdit(null)} className="text-sm text-foreground/50 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            ← Назад к списку
          </button>
        </div>

        <div className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/50">Название профиля</span>
              <input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })}
                placeholder="Напр.: Проверка игрового ПК"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/50">Комментарий</span>
              <input value={edit.note} onChange={e => setEdit({ ...edit, note: e.target.value })}
                placeholder="Необязательно"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={edit.is_active} onChange={e => setEdit({ ...edit, is_active: e.target.checked })} />
            Активен (приложение скачивает только активные профили)
          </label>
        </div>

        {/* Тесты */}
        <div className="mt-5 space-y-3">
          {edit.tests.map((t, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Тест {i + 1}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => moveTest(i, -1)} disabled={i === 0} className="rounded p-1 text-foreground/40 hover:text-foreground disabled:opacity-30" style={{ cursor: "pointer" }}><Icon name="ChevronUp" size={15} /></button>
                  <button onClick={() => moveTest(i, 1)} disabled={i === edit.tests.length - 1} className="rounded p-1 text-foreground/40 hover:text-foreground disabled:opacity-30" style={{ cursor: "pointer" }}><Icon name="ChevronDown" size={15} /></button>
                  <button onClick={() => delTest(i)} className="rounded p-1 text-red-400/70 hover:text-red-400" style={{ cursor: "pointer" }}><Icon name="Trash2" size={15} /></button>
                </div>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-foreground/50">Название теста</span>
                  <input value={t.name} onChange={e => updTest(i, { name: e.target.value })}
                    placeholder="Напр.: CPU стресс — OCCT"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-foreground/50">Программа или скрипт (путь)</span>
                    <input value={t.program} onChange={e => updTest(i, { program: e.target.value })}
                      placeholder="C:\OCCT\OCCT.exe"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-foreground/50">Аргументы запуска</span>
                    <input value={t.args} onChange={e => updTest(i, { args: e.target.value })}
                      placeholder="/cpu /duration 600"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary" />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-1 block text-xs text-foreground/50">Время теста, сек</span>
                    <input type="number" value={t.duration_sec} onChange={e => updTest(i, { duration_sec: Number(e.target.value) })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-foreground/50">Код успеха</span>
                    <input type="number" value={t.success_exit_code} onChange={e => updTest(i, { success_exit_code: Number(e.target.value) })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                  </label>
                  <label className="flex items-end gap-2 pb-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={t.timeout_is_success} onChange={e => updTest(i, { timeout_is_success: e.target.checked })} />
                    Таймаут = успех
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs text-foreground/50">Файлы-отчёты (через запятую, можно маски *.log)</span>
                  <input value={t.report_files.join(", ")} onChange={e => updTest(i, { report_files: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                    placeholder="C:\OCCT\reports\*.csv"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary" />
                </label>
              </div>
            </div>
          ))}

          <button onClick={addTest} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm text-foreground/60 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={16} /> Добавить тест
          </button>
        </div>

        <div className="mt-5 flex gap-3">
          <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Save" size={16} /> {saving ? "Сохранение..." : "Сохранить профиль"}
          </button>
          <button onClick={() => setEdit(null)} className="rounded-xl border border-border px-6 py-2.5 text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            Отмена
          </button>
        </div>
      </div>
    )
  }

  // ─────────────────────────── Список профилей ────────────────────────────
  return (
    <div className="max-w-3xl">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Профили тестов</h2>
        <button onClick={() => setEdit(emptyProfile())} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
          <Icon name="Plus" size={16} /> Новый профиль
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : profiles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-foreground/40">
          <Icon name="ListChecks" size={28} className="mx-auto mb-2 text-foreground/20" />
          Профилей пока нет. Создайте первый — приложение на ПК скачает его автоматически.
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map(p => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
                  {!p.is_active && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground/40">выключен</span>}
                </div>
                <div className="mt-0.5 text-xs text-foreground/40">{p.tests.length} тестов{p.note ? ` · ${p.note}` : ""}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => setEdit({ ...p, tests: p.tests.map(t => ({ ...emptyTest(), ...t })) })}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                  <Icon name="Pencil" size={13} /> Изменить
                </button>
                <button onClick={() => remove(p.id)} className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors" style={{ cursor: "pointer" }}>
                  <Icon name="Trash2" size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
