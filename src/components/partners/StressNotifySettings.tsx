import { useCallback, useEffect, useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

type Tri = boolean | null

type Chat = {
  id: number
  chat_id: string
  title: string
  enabled: boolean
  on_run_started: Tri
  on_test_failed: Tri
  on_run_finished: Tri
  only_failures: Tri
  tpl_run_started: string
  tpl_test_failed: string
  tpl_run_finished: string
  last_ok_at: string | null
  last_error: string
}

type Settings = {
  enabled: boolean
  on_run_started: boolean
  on_test_failed: boolean
  on_run_finished: boolean
  only_failures: boolean
  tpl_run_started: string
  tpl_test_failed: string
  tpl_run_finished: string
}

const EVENTS = [
  { key: "run_started", label: "Прогон начался", hint: "Старт теста на ПК" },
  { key: "test_failed", label: "Упавший тест", hint: "Сразу при ошибке" },
  { key: "run_finished", label: "Прогон завершён", hint: "Итог: пройдено/провалено" },
] as const

export default function StressNotifySettings({ session }: { session: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [chats, setChats] = useState<Chat[]>([])
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [placeholders, setPlaceholders] = useState<string[]>([])
  const [newChatId, setNewChatId] = useState("")
  const [newTitle, setNewTitle] = useState("")
  const [testing, setTesting] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [tplOpen, setTplOpen] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState<number | null>(null)

  const auth = { session }

  const load = useCallback(() => {
    setLoading(true)
    api.stress.notifyConfig("", auth)
      .then(d => {
        if (d.settings) setSettings(d.settings)
        setChats(d.chats || [])
        setDefaults(d.defaults || {})
        setPlaceholders(d.placeholders || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  useEffect(() => { if (open && !settings) load() }, [open, settings, load])

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const saveSettings = (patch: Partial<Settings>) => {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    setSaving(true)
    api.stress.notifySettingsSave(next as unknown as Record<string, unknown>, "", auth)
      .then(d => { if (d.settings) setSettings(d.settings) })
      .catch(() => flash(false, "Не удалось сохранить"))
      .finally(() => setSaving(false))
  }

  const addChat = () => {
    const cid = newChatId.trim()
    if (!cid) return
    setSaving(true)
    api.stress.notifyChatSave({ chat_id: cid, title: newTitle.trim() }, "", auth)
      .then(d => {
        if (d.error) { flash(false, d.error); return }
        setChats(d.chats || [])
        setNewChatId(""); setNewTitle("")
        flash(true, "Чат добавлен. Проверьте связь кнопкой «Проверить».")
      })
      .catch(() => flash(false, "Не удалось добавить чат"))
      .finally(() => setSaving(false))
  }

  const patchChat = (chat: Chat, patch: Partial<Chat>) => {
    const next = { ...chat, ...patch }
    setChats(cs => cs.map(c => (c.id === chat.id ? next : c)))
    api.stress.notifyChatSave(next as unknown as Record<string, unknown>, "", auth)
      .then(d => { if (d.chats) setChats(d.chats) })
      .catch(() => flash(false, "Не удалось сохранить чат"))
  }

  const delChat = (id: number) => {
    if (!confirm("Удалить этот чат из уведомлений?")) return
    api.stress.notifyChatDelete(id, "", auth)
      .then(d => { if (d.chats) setChats(d.chats) })
      .catch(() => flash(false, "Не удалось удалить"))
  }

  const testChat = (chat_id: string) => {
    setTesting(chat_id)
    api.stress.notifyChatTest({ chat_id }, "", auth)
      .then(d => {
        if (d.ok) flash(true, "Сообщение отправлено — проверьте чат")
        else flash(false, `Telegram: ${d.error || "не доставлено"}. Добавьте бота в чат.`)
        load()
      })
      .catch(() => flash(false, "Не удалось проверить"))
      .finally(() => setTesting(null))
  }

  const Check = ({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint?: string }) => (
    <button onClick={onClick} style={{ cursor: "pointer" }}
      className="flex w-full items-start gap-2.5 rounded-lg border border-border p-2.5 text-left hover:border-primary/40 transition-colors">
      <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
        {on && <Icon name="Check" size={11} />}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {hint && <p className="text-xs text-foreground/40">{hint}</p>}
      </div>
    </button>
  )

  // Трёхпозиционный флаг чата: наследовать / включить / выключить
  const TriSwitch = ({ value, onChange, label }: { value: Tri; onChange: (v: Tri) => void; label: string }) => {
    const opts: { v: Tri; t: string }[] = [
      { v: null, t: "Как у компании" }, { v: true, t: "Слать" }, { v: false, t: "Не слать" },
    ]
    return (
      <div className="flex items-center justify-between gap-3 py-1.5">
        <span className="text-xs text-foreground/60">{label}</span>
        <div className="flex overflow-hidden rounded-lg border border-border">
          {opts.map(o => (
            <button key={String(o.v)} onClick={() => onChange(o.v)} style={{ cursor: "pointer" }}
              className={`px-2 py-1 text-[11px] transition-colors ${value === o.v ? "bg-primary text-primary-foreground" : "text-foreground/50 hover:text-foreground"}`}>
              {o.t}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const TplEditor = ({ evKey, value, onSave, inherited }: {
    evKey: string; value: string; onSave: (v: string) => void; inherited?: boolean
  }) => {
    const [draft, setDraft] = useState(value)
    useEffect(() => { setDraft(value) }, [value])
    return (
      <div className="mt-2 rounded-lg border border-border bg-background p-3">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={5}
          placeholder={inherited ? "Пусто — берётся шаблон компании" : defaults[evKey] || ""}
          className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none" />
        <div className="mt-2 flex flex-wrap gap-1">
          {placeholders.map(p => (
            <button key={p} onClick={() => setDraft(d => d + p)} style={{ cursor: "pointer" }}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-foreground/50 hover:border-primary hover:text-primary">
              {p}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <button onClick={() => onSave(draft)} style={{ cursor: "pointer" }}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            Сохранить
          </button>
          <button onClick={() => { setDraft(""); onSave("") }} style={{ cursor: "pointer" }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-foreground">
            {inherited ? "Как у компании" : "Стандартный текст"}
          </button>
        </div>
      </div>
    )
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ cursor: "pointer" }}
        className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors">
        <Icon name="Bell" size={14} />
        Уведомления в Telegram
      </button>
    )
  }

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon name="Bell" size={16} className="text-primary" />
            <h3 className="font-semibold text-foreground">Уведомления в Telegram</h3>
            {saving && <Icon name="Loader" size={13} className="animate-spin text-foreground/40" />}
          </div>
          <p className="mt-1 text-xs text-foreground/50">
            Приходят только по тестам вашей компании
          </p>
        </div>
        <button onClick={() => setOpen(false)} style={{ cursor: "pointer" }}
          className="text-foreground/40 hover:text-foreground"><Icon name="X" size={16} /></button>
      </div>

      {msg && (
        <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-green-500/30 bg-green-500/10 text-green-500" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>
          {msg.text}
        </div>
      )}

      {loading || !settings ? (
        <div className="flex justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          {/* Как получить ID чата */}
          <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs text-foreground/70">
              <b>Как подключить чат:</b> добавьте нашего Telegram-бота в нужный чат
              (или напишите ему в личку) и отправьте команду{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">/chatid</code> — бот пришлёт ID
              этого чата. Вставьте ID ниже и нажмите «Проверить».
            </p>
          </div>

          {/* Главный выключатель */}
          <div className="mb-4">
            <Check on={settings.enabled} onClick={() => saveSettings({ enabled: !settings.enabled })}
              label="Присылать уведомления" hint="Общий выключатель для всех чатов" />
          </div>

          {/* Список чатов */}
          <div className="mb-5">
            <p className="mb-2 text-xs font-medium text-foreground/50">Мои чаты</p>
            {chats.length === 0 && (
              <p className="mb-2 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-foreground/40">
                Пока не добавлено ни одного чата
              </p>
            )}
            <div className="space-y-2">
              {chats.map(ch => (
                <div key={ch.id} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => patchChat(ch, { enabled: !ch.enabled })} style={{ cursor: "pointer" }}
                      title={ch.enabled ? "Выключить" : "Включить"}
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${ch.enabled ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                      {ch.enabled && <Icon name="Check" size={11} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{ch.title || "Без названия"}</p>
                      <code className="font-mono text-[11px] text-foreground/40">{ch.chat_id}</code>
                    </div>
                    {ch.last_error ? (
                      <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-400"
                        title={ch.last_error}>Ошибка</span>
                    ) : ch.last_ok_at ? (
                      <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[11px] text-green-500">Работает</span>
                    ) : null}
                    <button onClick={() => testChat(ch.chat_id)} disabled={testing === ch.chat_id} style={{ cursor: "pointer" }}
                      className="rounded-lg border border-border px-2 py-1 text-[11px] text-foreground/60 hover:border-primary hover:text-foreground">
                      {testing === ch.chat_id ? "Отправляю…" : "Проверить"}
                    </button>
                    <button onClick={() => setChatOpen(chatOpen === ch.id ? null : ch.id)} style={{ cursor: "pointer" }}
                      className="rounded-lg border border-border px-2 py-1 text-[11px] text-foreground/60 hover:border-primary hover:text-foreground">
                      Настройки
                    </button>
                    <button onClick={() => delChat(ch.id)} style={{ cursor: "pointer" }}
                      className="text-foreground/30 hover:text-red-400" title="Удалить">
                      <Icon name="Trash2" size={14} />
                    </button>
                  </div>

                  {ch.last_error && (
                    <p className="mt-2 rounded bg-red-500/5 px-2 py-1 text-[11px] text-red-400/80">{ch.last_error}</p>
                  )}

                  {chatOpen === ch.id && (
                    <div className="mt-3 border-t border-border pt-3">
                      <p className="mb-2 text-[11px] text-foreground/40">
                        По умолчанию чат использует настройки компании. Здесь можно переопределить.
                      </p>
                      <TriSwitch label="Прогон начался" value={ch.on_run_started}
                        onChange={v => patchChat(ch, { on_run_started: v })} />
                      <TriSwitch label="Упавший тест" value={ch.on_test_failed}
                        onChange={v => patchChat(ch, { on_test_failed: v })} />
                      <TriSwitch label="Прогон завершён" value={ch.on_run_finished}
                        onChange={v => patchChat(ch, { on_run_finished: v })} />
                      <TriSwitch label="Только если есть ошибки" value={ch.only_failures}
                        onChange={v => patchChat(ch, { only_failures: v })} />

                      <div className="mt-3">
                        {EVENTS.map(ev => {
                          const key = `${ch.id}:${ev.key}`
                          const field = `tpl_${ev.key}` as keyof Chat
                          const val = (ch[field] as string) || ""
                          return (
                            <div key={ev.key} className="mb-1">
                              <button onClick={() => setTplOpen(tplOpen === key ? null : key)} style={{ cursor: "pointer" }}
                                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs text-foreground/60 hover:bg-muted">
                                <span>Текст «{ev.label}»{val ? " — свой" : " — как у компании"}</span>
                                <Icon name={tplOpen === key ? "ChevronUp" : "ChevronDown"} size={13} />
                              </button>
                              {tplOpen === key && (
                                <TplEditor evKey={ev.key} value={val} inherited
                                  onSave={v => patchChat(ch, { [field]: v } as Partial<Chat>)} />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Добавление чата */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input value={newChatId} onChange={e => setNewChatId(e.target.value)}
                placeholder="ID чата, например -1001234567890"
                className="min-w-[220px] flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                style={{ cursor: "text" }} />
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                placeholder="Название (Рабочая группа)"
                className="min-w-[160px] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                style={{ cursor: "text" }} />
              <button onClick={addChat} disabled={!newChatId.trim()} style={{ cursor: "pointer" }}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
                Добавить
              </button>
            </div>
          </div>

          {/* Настройки компании */}
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-xs font-medium text-foreground/50">
              Настройки компании <span className="text-foreground/30">— применяются ко всем чатам, если чат не переопределил</span>
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {EVENTS.map(ev => {
                const field = `on_${ev.key}` as keyof Settings
                return (
                  <Check key={ev.key} on={!!settings[field]} label={ev.label} hint={ev.hint}
                    onClick={() => saveSettings({ [field]: !settings[field] } as Partial<Settings>)} />
                )
              })}
              <Check on={settings.only_failures} label="Только если есть ошибки"
                hint="Об успешном прогоне не писать"
                onClick={() => saveSettings({ only_failures: !settings.only_failures })} />
            </div>

            <div className="mt-3">
              {EVENTS.map(ev => {
                const key = `company:${ev.key}`
                const field = `tpl_${ev.key}` as keyof Settings
                const val = (settings[field] as string) || ""
                return (
                  <div key={ev.key} className="mb-1">
                    <button onClick={() => setTplOpen(tplOpen === key ? null : key)} style={{ cursor: "pointer" }}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs text-foreground/60 hover:bg-muted">
                      <span>Текст «{ev.label}»{val ? " — свой" : " — стандартный"}</span>
                      <Icon name={tplOpen === key ? "ChevronUp" : "ChevronDown"} size={13} />
                    </button>
                    {tplOpen === key && (
                      <TplEditor evKey={ev.key} value={val}
                        onSave={v => saveSettings({ [field]: v } as Partial<Settings>)} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}