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
  min_run_sec: number
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
  min_run_sec: 0,
})
const emptyProfile = (): Profile => ({
  name: "", note: "", tests: [emptyTest()], is_active: true, sort_order: 0,
})

// Готовые пресеты тестов. program оставляем пустым — путь юзер впишет под свой ПК.
interface Preset { key: string; label: string; hint: string; make: () => TestItem }
const PRESETS: Preset[] = [
  {
    key: "occt",
    label: "OCCT (CPU)",
    hint: "Запускает OCCT.exe, само крутит CPU-тест 10 мин и закрывается. Путь обычно C:\\Program Files\\OCCT\\OCCT.exe. Отчёт — в Документы\\OCCT.",
    make: () => ({
      ...emptyTest(),
      name: "OCCT — CPU стресс",
      args: "-run -test=CPU -duration=00:10:00 -auto -report=Documents",
      duration_sec: 660, timeout_is_success: true, success_exit_code: 0, min_run_sec: 30,
      report_files: ["%USERPROFILE%\\Documents\\OCCT\\*.html", "%USERPROFILE%\\Documents\\OCCT\\*\\*.csv"],
    }),
  },
  {
    key: "occt_gpu",
    label: "OCCT (GPU)",
    hint: "OCCT в режиме 3D/VRAM на видеокарту. Путь к OCCT.exe тот же. Отчёт — в Документы\\OCCT.",
    make: () => ({
      ...emptyTest(),
      name: "OCCT — GPU стресс (3D)",
      args: "-run -test=3D -duration=00:10:00 -auto -report=Documents",
      duration_sec: 660, timeout_is_success: true, success_exit_code: 0, min_run_sec: 30,
      report_files: ["%USERPROFILE%\\Documents\\OCCT\\*.html"],
    }),
  },
  {
    key: "cinebench",
    label: "Cinebench R23",
    hint: "CPU-бенчмарк Maxon. Путь к Cinebench.exe. Крутит мультиядро ~10 мин. Результат смотри в окне Cinebench.",
    make: () => ({
      ...emptyTest(),
      name: "Cinebench R23 — Multi Core",
      args: "g_CinebenchCpuXTest=true g_CinebenchMinimumTestDuration=600",
      duration_sec: 660, timeout_is_success: true, success_exit_code: 0,
      report_files: [],
    }),
  },
  {
    key: "prime95",
    label: "Prime95",
    hint: "Прогрев CPU. Путь к prime95.exe. Режим Torture задаётся в local.txt/prime.txt рядом с программой.",
    make: () => ({
      ...emptyTest(),
      name: "Prime95 — Torture Test",
      args: "-t",
      duration_sec: 900, timeout_is_success: true, success_exit_code: 0,
      report_files: ["results.txt"],
    }),
  },
  {
    key: "superposition",
    label: "Superposition 8K",
    hint: "Unigine Superposition в режиме консоли. Путь к superposition_cli.exe (папка bin). Пресет 8K. Отчёт — JSON рядом.",
    make: () => ({
      ...emptyTest(),
      name: "Superposition — 8K",
      args: "-preset 4 -mode 2 -api 2 -report_path superposition_report.json",
      duration_sec: 600, timeout_is_success: false, success_exit_code: 0,
      report_files: ["superposition_report.json"],
    }),
  },
  {
    key: "furmark",
    label: "FurMark 1.39.0",
    hint: "Стресс GPU с мониторингом. Путь к furmark.exe. Лог с температурами/FPS пишется в файл.",
    make: () => ({
      ...emptyTest(),
      name: "FurMark — GPU стресс",
      args: "/nogui /no_score_box /width=1920 /height=1080 /msaa=4 /max_time=600000 /log_temperature /log_score",
      duration_sec: 660, timeout_is_success: true, success_exit_code: 0, min_run_sec: 30,
      report_files: ["*.csv", "*_log.txt"],
    }),
  },
]

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
  const addPreset = (p: Preset) => edit && setEdit({ ...edit, tests: [...edit.tests, p.make()] })
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

        {/* Готовые пресеты */}
        <div className="mt-5 rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <Icon name="Zap" size={15} className="text-accent" />
            <span className="text-sm font-medium text-foreground">Добавить готовый тест</span>
          </div>
          <p className="mb-3 text-xs text-foreground/40">Жми — тест добавится с правильными аргументами и отчётом. Останется вписать путь к программе под свой ПК.</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <button key={p.key} onClick={() => addPreset(p)} title={p.hint}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground/80 hover:border-accent hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="Plus" size={13} /> {p.label}
              </button>
            ))}
          </div>
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
                    <span className="mt-1 block text-[11px] text-foreground/30">Ключи командной строки. Для GUI-программ (OCCT, FurMark) обязательно режим запуска теста на время, иначе откроется окно и тест завершится мгновенно.</span>
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-1 block text-xs text-foreground/50">Время теста, сек</span>
                    <input type="number" value={t.duration_sec} onChange={e => updTest(i, { duration_sec: Number(e.target.value) })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                    <span className="mt-1 block text-[11px] text-foreground/30">Сколько держать тест. Ставь чуть больше длительности в аргументах (запас на запуск).</span>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-foreground/50">Код успеха</span>
                    <input type="number" value={t.success_exit_code} onChange={e => updTest(i, { success_exit_code: Number(e.target.value) })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                    <span className="mt-1 block text-[11px] text-foreground/30">Какой код = успех, если программа завершилась сама. Обычно 0. Поставь -1, чтобы принимать любой код.</span>
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-foreground/70">
                    <span className="text-xs text-foreground/50">Таймаут = успех</span>
                    <span className="flex items-center gap-2 pt-1.5" style={{ cursor: "pointer" }}>
                      <input type="checkbox" checked={t.timeout_is_success} onChange={e => updTest(i, { timeout_is_success: e.target.checked })} />
                      <span className="text-[11px] text-foreground/30">Вкл — если тест «крутится вечно» и мы гасим его по времени (OCCT/Prime95/FurMark). Выкл — если программа сама завершается (Cinebench/Superposition).</span>
                    </span>
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs text-foreground/50">Минимум секунд работы (защита от «мгновенного» теста)</span>
                  <input type="number" value={t.min_run_sec} onChange={e => updTest(i, { min_run_sec: Number(e.target.value) })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                  <span className="mt-1 block text-[11px] text-foreground/30">Если программа закрылась раньше этого времени — тест считается ПРОВАЛЕННЫМ. Спасает от случая, когда OCCT/FurMark открыл окно и сразу «вышел». 0 — выключено. Для OCCT поставь 30.</span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-foreground/50">Файлы-отчёты (через запятую, можно маски *.log)</span>
                  <input value={t.report_files.join(", ")} onChange={e => updTest(i, { report_files: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                    placeholder="%USERPROFILE%\Documents\OCCT\*.html"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary" />
                  <span className="mt-1 block text-[11px] text-foreground/30">Откуда забрать отчёт после теста. OCCT кладёт отчёты в «Документы\OCCT». Можно маски (*.html, *.csv). Эти файлы приложатся к прогону на сайте.</span>
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