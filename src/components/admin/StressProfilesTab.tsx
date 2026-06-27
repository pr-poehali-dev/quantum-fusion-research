import { useEffect, useState, useCallback } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { getAdminKey } from "@/pages/admin/types"

// Параллельная программа-компаньон (напр. GPU-Z рядом с FurMark)
interface CompanionProgram {
  program: string
  args: string
  screenshot: boolean        // делать ли скриншот окна этой программы
}
// Шаг UI-сценария (расширение send_keys: клик/клавиши/ожидание/скрин)
interface UiAction {
  type: "keys" | "click" | "wait" | "screenshot"
  value: string              // клавиши, координаты "x,y", заголовок окна или ""
  delay_sec: number          // пауза перед шагом
}
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
  send_keys: string
  send_keys_delay_sec: number
  // ── Новые поля (опциональны, чтобы старые профили не ломались) ──
  test_mode?: "process" | "screenshot"   // обычный тест ИЛИ тест со скриншотом результата
  screenshot_target?: string             // что скриншотить: заголовок окна / имя программы ("GPU-Z")
  screenshot_delay_sec?: number          // через сколько секунд после старта снять скрин
  companion_programs?: CompanionProgram[] // программы, запускаемые параллельно с тестом
  ui_actions?: UiAction[]                 // последовательность UI-действий внутри окна теста
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
  min_run_sec: 0, send_keys: "", send_keys_delay_sec: 5,
  test_mode: "process", screenshot_target: "", screenshot_delay_sec: 30,
  companion_programs: [], ui_actions: [],
})
const emptyProfile = (): Profile => ({
  name: "", note: "", tests: [emptyTest()], is_active: true, sort_order: 0,
})

// Пресет теста, как он лежит в БД (конструктор готовых тестов).
interface DbPreset {
  id?: number
  label: string
  hint: string
  test_name: string
  program: string
  args: string
  duration_sec: number
  timeout_is_success: boolean
  success_exit_code: number
  min_run_sec: number
  send_keys: string
  send_keys_delay_sec: number
  report_files: string[]
  sort_order: number
}

const emptyPreset = (): DbPreset => ({
  label: "", hint: "", test_name: "", program: "", args: "",
  duration_sec: 600, timeout_is_success: true, success_exit_code: -1, min_run_sec: 0,
  send_keys: "", send_keys_delay_sec: 5, report_files: [], sort_order: 0,
})

// Превратить пресет из БД в тест профиля.
const presetToTest = (p: DbPreset): TestItem => ({
  ...emptyTest(),
  name: p.test_name || p.label,
  program: p.program,
  args: p.args,
  duration_sec: p.duration_sec,
  timeout_is_success: p.timeout_is_success,
  success_exit_code: p.success_exit_code,
  min_run_sec: p.min_run_sec,
  send_keys: p.send_keys,
  send_keys_delay_sec: p.send_keys_delay_sec,
  report_files: p.report_files || [],
})

// Встроенный быстрый пресет: FurMark с параллельным GPU-Z и скриншотом показаний.
const furmarkGpuzPreset = (): TestItem => ({
  ...emptyTest(),
  name: "FurMark + GPU-Z (скрин)",
  program: "StressTests\\FurMark\\furmark.exe",
  args: "/nogui /width=1920 /height=1080 /msaa=0",
  duration_sec: 600,
  timeout_is_success: true,
  success_exit_code: -1,
  min_run_sec: 30,
  send_keys: "",
  send_keys_delay_sec: 5,
  report_files: [],
  test_mode: "screenshot",
  screenshot_target: "GPU-Z",
  screenshot_delay_sec: 300,
  companion_programs: [
    { program: "StressTests\\GPU-Z\\GPU-Z.exe", args: "", screenshot: true },
  ],
  ui_actions: [
    { type: "wait", value: "", delay_sec: 300 },
    { type: "screenshot", value: "GPU-Z", delay_sec: 0 },
  ],
})

export default function StressProfilesTab() {
  const adminKey = getAdminKey()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)
  const [presets, setPresets] = useState<DbPreset[]>([])
  const [editPreset, setEditPreset] = useState<DbPreset | null>(null)
  const [savingPreset, setSavingPreset] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.stress.profilesList(adminKey),
      api.stress.presetsList(adminKey),
    ]).then(([prof, pres]) => {
      setProfiles(prof.profiles || [])
      setPresets(pres.presets || [])
    }).finally(() => setLoading(false))
  }, [adminKey])

  useEffect(() => { load() }, [load])

  const savePreset = () => {
    if (!editPreset) return
    if (!editPreset.label.trim()) { alert("Укажите название теста"); return }
    setSavingPreset(true)
    api.stress.presetSave(editPreset, adminKey).then(() => {
      setEditPreset(null)
      load()
    }).finally(() => setSavingPreset(false))
  }

  const removePreset = (id?: number) => {
    if (!id) return
    if (!confirm("Удалить этот готовый тест?")) return
    api.stress.presetDelete(id, adminKey).then(load)
  }
  const updPreset = (patch: Partial<DbPreset>) => editPreset && setEditPreset({ ...editPreset, ...patch })

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
  const addPreset = (p: DbPreset) => edit && setEdit({ ...edit, tests: [...edit.tests, presetToTest(p)] })
  const addBuiltinTest = (t: TestItem) => edit && setEdit({ ...edit, tests: [...edit.tests, t] })
  const delTest = (i: number) => edit && setEdit({ ...edit, tests: edit.tests.filter((_, idx) => idx !== i) })
  const moveTest = (i: number, dir: -1 | 1) => {
    if (!edit) return
    const j = i + dir
    if (j < 0 || j >= edit.tests.length) return
    const tests = [...edit.tests]
    ;[tests[i], tests[j]] = [tests[j], tests[i]]
    setEdit({ ...edit, tests })
  }

  // ─────────────────────── Конструктор готового теста ─────────────────────
  if (editPreset) {
    const ep = editPreset
    const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
    const monoCls = "w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
    return (
      <div className="max-w-3xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{ep.id ? "Редактирование теста" : "Новый готовый тест"}</h2>
          <button onClick={() => setEditPreset(null)} className="text-sm text-foreground/50 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>← Назад</button>
        </div>

        <div className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/50">Название теста (кнопка-пресет)</span>
              <input value={ep.label} onChange={e => updPreset({ label: e.target.value })} placeholder="Напр.: Cinebench R23 (авто)" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/50">Имя теста внутри профиля</span>
              <input value={ep.test_name} onChange={e => updPreset({ test_name: e.target.value })} placeholder="Напр.: Cinebench R23 — Multi Core" className={inputCls} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-foreground/50">Подсказка (описание)</span>
            <input value={ep.hint} onChange={e => updPreset({ hint: e.target.value })} placeholder="Что делает тест, куда класть программу" className={inputCls} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/50">Программа (путь)</span>
              <input value={ep.program} onChange={e => updPreset({ program: e.target.value })} placeholder="StressTests\CINEBENCH R23\23.2.0.0\Cinebench.exe" className={monoCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/50">Аргументы запуска</span>
              <input value={ep.args} onChange={e => updPreset({ args: e.target.value })} placeholder="g_CinebenchCpuXTest=true ..." className={monoCls} />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/50">Время теста, сек</span>
              <input type="number" value={ep.duration_sec} onChange={e => updPreset({ duration_sec: Number(e.target.value) })} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/50">Код успеха (-1 = любой)</span>
              <input type="number" value={ep.success_exit_code} onChange={e => updPreset({ success_exit_code: Number(e.target.value) })} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/50">Минимум секунд</span>
              <input type="number" value={ep.min_run_sec} onChange={e => updPreset({ min_run_sec: Number(e.target.value) })} className={inputCls} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={ep.timeout_is_success} onChange={e => updPreset({ timeout_is_success: e.target.checked })} />
            Таймаут = успех (для стресс-утилит, которые крутятся вечно)
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/50">Нажать клавиши (через запятую)</span>
              <input value={ep.send_keys} onChange={e => updPreset({ send_keys: e.target.value })} placeholder="напр. P для FurMark" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/50">Через сколько секунд нажать</span>
              <input type="number" value={ep.send_keys_delay_sec} onChange={e => updPreset({ send_keys_delay_sec: Number(e.target.value) })} className={inputCls} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-foreground/50">Файлы-отчёты (через запятую, маски *.html)</span>
            <input value={ep.report_files.join(", ")} onChange={e => updPreset({ report_files: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} placeholder="StressTests\OCCT\report\*.html" className={monoCls} />
          </label>
        </div>

        <div className="mt-5 flex gap-3">
          <button onClick={savePreset} disabled={savingPreset} className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Save" size={16} /> {savingPreset ? "Сохранение..." : "Сохранить тест"}
          </button>
          <button onClick={() => setEditPreset(null)} className="rounded-xl border border-border px-6 py-2.5 text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Отмена</button>
        </div>
      </div>
    )
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
            {/* Встроенный пресет со скриншотом */}
            <button onClick={() => addBuiltinTest(furmarkGpuzPreset())} title="FurMark с параллельным GPU-Z и скриншотом показаний"
              className="flex items-center gap-1.5 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs text-foreground hover:border-accent transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="Camera" size={13} /> FurMark + GPU-Z (скрин)
            </button>
            {presets.map(p => (
              <button key={p.id} onClick={() => addPreset(p)} title={p.hint}
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
                      placeholder="StressTests\OCCT\OCCT.exe"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary" />
                    <span className="mt-1 block text-[11px] text-foreground/30">Лучше относительный путь от папки StressRunner: <span className="font-mono">StressTests\OCCT\OCCT.exe</span> — тогда работает на любом ПК (флешка). Можно и полный путь C:\...</span>
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
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-foreground/50">Нажать клавиши после запуска</span>
                    <input value={t.send_keys} onChange={e => updTest(i, { send_keys: e.target.value })}
                      placeholder="напр. P для FurMark"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                    <span className="mt-1 block text-[11px] text-foreground/30">Приложение само нажмёт эти клавиши в окне теста. Для FurMark «P» размазывает бублик и сильнее греет GPU. Пусто — ничего не жмём.</span>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-foreground/50">Через сколько секунд нажать</span>
                    <input type="number" value={t.send_keys_delay_sec} onChange={e => updTest(i, { send_keys_delay_sec: Number(e.target.value) })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs text-foreground/50">Файлы-отчёты (через запятую, можно маски *.log)</span>
                  <input value={t.report_files.join(", ")} onChange={e => updTest(i, { report_files: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                    placeholder="%USERPROFILE%\Documents\OCCT\*.html"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary" />
                  <span className="mt-1 block text-[11px] text-foreground/30">Откуда забрать отчёт после теста. OCCT кладёт отчёты в «Документы\OCCT». Можно маски (*.html, *.csv). Эти файлы приложатся к прогону на сайте.</span>
                </label>

                {/* ── Режим теста и скриншот ── */}
                <div className="rounded-lg border border-border/70 bg-background/40 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs text-foreground/50">Режим теста</span>
                      <select value={t.test_mode || "process"} onChange={e => updTest(i, { test_mode: e.target.value as TestItem["test_mode"] })}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" style={{ cursor: "pointer" }}>
                        <option value="process">Обычный (запуск программы)</option>
                        <option value="screenshot">Со скриншотом результата</option>
                      </select>
                      <span className="mt-1 block text-[11px] text-foreground/30">«Со скриншотом» — приложение снимет окно (напр. GPU-Z) как отчёт. Подходит для проверок, где важна не выгрузка файла, а картинка показаний.</span>
                    </label>
                    {t.test_mode === "screenshot" && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-xs text-foreground/50">Что снимать (окно/программа)</span>
                          <input value={t.screenshot_target || ""} onChange={e => updTest(i, { screenshot_target: e.target.value })}
                            placeholder="GPU-Z"
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs text-foreground/50">Скрин через, сек</span>
                          <input type="number" value={t.screenshot_delay_sec ?? 30} onChange={e => updTest(i, { screenshot_delay_sec: Number(e.target.value) })}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                        </label>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Программы-компаньоны (запускаются параллельно) ── */}
                <div className="rounded-lg border border-border/70 bg-background/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground/60">Параллельные программы (компаньоны)</span>
                    <button onClick={() => updTest(i, { companion_programs: [...(t.companion_programs || []), { program: "", args: "", screenshot: false }] })}
                      className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-foreground/60 hover:border-primary hover:text-primary" style={{ cursor: "pointer" }}>
                      <Icon name="Plus" size={11} /> Добавить
                    </button>
                  </div>
                  <p className="mb-2 text-[11px] text-foreground/30">Запускаются вместе с тестом (напр. GPU-Z рядом с FurMark для контроля показаний). Можно пометить «скрин» — приложение снимет окно компаньона.</p>
                  {(t.companion_programs || []).map((c, ci) => (
                    <div key={ci} className="mb-1.5 flex items-center gap-2">
                      <input value={c.program} onChange={e => { const arr = [...(t.companion_programs || [])]; arr[ci] = { ...c, program: e.target.value }; updTest(i, { companion_programs: arr }) }}
                        placeholder="StressTests\GPU-Z\GPU-Z.exe"
                        className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary" />
                      <input value={c.args} onChange={e => { const arr = [...(t.companion_programs || [])]; arr[ci] = { ...c, args: e.target.value }; updTest(i, { companion_programs: arr }) }}
                        placeholder="аргументы"
                        className="w-28 rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary" />
                      <label className="flex items-center gap-1 text-[11px] text-foreground/50" style={{ cursor: "pointer" }} title="Снять скриншот окна этой программы">
                        <input type="checkbox" checked={c.screenshot} onChange={e => { const arr = [...(t.companion_programs || [])]; arr[ci] = { ...c, screenshot: e.target.checked }; updTest(i, { companion_programs: arr }) }} />
                        скрин
                      </label>
                      <button onClick={() => updTest(i, { companion_programs: (t.companion_programs || []).filter((_, x) => x !== ci) })}
                        className="rounded p-1 text-red-400/70 hover:text-red-400" style={{ cursor: "pointer" }}><Icon name="X" size={13} /></button>
                    </div>
                  ))}
                </div>

                {/* ── UI-сценарий (последовательность действий внутри окна) ── */}
                <div className="rounded-lg border border-border/70 bg-background/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground/60">UI-сценарий (действия в окне теста)</span>
                    <button onClick={() => updTest(i, { ui_actions: [...(t.ui_actions || []), { type: "keys", value: "", delay_sec: 2 }] })}
                      className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-foreground/60 hover:border-primary hover:text-primary" style={{ cursor: "pointer" }}>
                      <Icon name="Plus" size={11} /> Добавить шаг
                    </button>
                  </div>
                  <p className="mb-2 text-[11px] text-foreground/30">Расширенная замена «нажать клавиши»: пошагово — нажать клавиши / клик по координатам / пауза / скриншот. Выполняются по порядку после запуска теста.</p>
                  {(t.ui_actions || []).map((a, ai) => (
                    <div key={ai} className="mb-1.5 flex items-center gap-2">
                      <span className="w-4 text-[11px] text-foreground/30">{ai + 1}</span>
                      <select value={a.type} onChange={e => { const arr = [...(t.ui_actions || [])]; arr[ai] = { ...a, type: e.target.value as UiAction["type"] }; updTest(i, { ui_actions: arr }) }}
                        className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary" style={{ cursor: "pointer" }}>
                        <option value="keys">Клавиши</option>
                        <option value="click">Клик (x,y)</option>
                        <option value="wait">Пауза</option>
                        <option value="screenshot">Скриншот</option>
                      </select>
                      {a.type !== "wait" && a.type !== "screenshot" && (
                        <input value={a.value} onChange={e => { const arr = [...(t.ui_actions || [])]; arr[ai] = { ...a, value: e.target.value }; updTest(i, { ui_actions: arr }) }}
                          placeholder={a.type === "click" ? "640,480" : "P или ^c (Ctrl+C)"}
                          className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary" />
                      )}
                      {a.type === "screenshot" && (
                        <input value={a.value} onChange={e => { const arr = [...(t.ui_actions || [])]; arr[ai] = { ...a, value: e.target.value }; updTest(i, { ui_actions: arr }) }}
                          placeholder="окно (пусто = весь экран)"
                          className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary" />
                      )}
                      <span className="text-[11px] text-foreground/40">через</span>
                      <input type="number" value={a.delay_sec} onChange={e => { const arr = [...(t.ui_actions || [])]; arr[ai] = { ...a, delay_sec: Number(e.target.value) }; updTest(i, { ui_actions: arr }) }}
                        className="w-14 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary" />
                      <span className="text-[11px] text-foreground/40">с</span>
                      <button onClick={() => updTest(i, { ui_actions: (t.ui_actions || []).filter((_, x) => x !== ai) })}
                        className="rounded p-1 text-red-400/70 hover:text-red-400" style={{ cursor: "pointer" }}><Icon name="X" size={13} /></button>
                    </div>
                  ))}
                </div>
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
        <div className="flex items-center gap-2">
          <button onClick={() => setEditPreset(emptyPreset())}
            className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground/80 hover:border-accent hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Zap" size={16} className="text-accent" /> Создать новый тест
          </button>
          <button onClick={() => setEdit(emptyProfile())} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={16} /> Новый профиль
          </button>
        </div>
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

      {/* Готовые тесты (пресеты) */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Icon name="Zap" size={15} className="text-accent" />
          <h3 className="text-sm font-semibold text-foreground">Готовые тесты</h3>
          <span className="text-xs text-foreground/40">— переиспользуй их в профилях</span>
        </div>
        {presets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-foreground/40">
            Пока нет. Нажми «Создать новый тест» выше.
          </div>
        ) : (
          <div className="space-y-2">
            {presets.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <div className="min-w-0">
                  <span className="truncate text-sm font-medium text-foreground">{p.label}</span>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-foreground/40">{p.program || "путь не задан"}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => setEditPreset({ ...emptyPreset(), ...p })}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Pencil" size={13} /> Изменить
                  </button>
                  <button onClick={() => removePreset(p.id)} className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Trash2" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}