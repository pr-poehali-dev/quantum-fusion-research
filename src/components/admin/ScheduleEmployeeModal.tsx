import Icon from "@/components/ui/icon"
import { PALETTE, Employee } from "./schedule.types"

interface ScheduleEmployeeModalProps {
  empModal: Partial<Employee>
  empSaving: boolean
  onClose: () => void
  onChange: (patch: Partial<Employee>) => void
  onSave: () => void
}

export function ScheduleEmployeeModal({ empModal, empSaving, onClose, onChange, onSave }: ScheduleEmployeeModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-foreground">{empModal.id ? "Редактировать" : "Новый сотрудник"}</h3>
          <button onClick={onClose} className="text-foreground/30 hover:text-foreground" style={{ cursor: "pointer" }}>
            <Icon name="X" size={18} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-foreground/50">Имя</label>
            <input type="text" value={empModal.name || ""}
              onChange={e => onChange({ name: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="Например: Александр" />
          </div>
          <div>
            <label className="mb-2 block text-xs text-foreground/50">Цвет</label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map(c => (
                <button key={c} onClick={() => onChange({ color: c })}
                  className={`h-8 w-8 rounded-full transition-all ${empModal.color === c ? "ring-2 ring-offset-2 ring-primary ring-offset-card scale-110" : ""}`}
                  style={{ backgroundColor: c, cursor: "pointer" }} />
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/50">% за сборку ПК</label>
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={100} step="0.1" value={empModal.assembler_percent ?? 0}
                onChange={e => onChange({ assembler_percent: parseFloat(e.target.value) || 0 })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none text-right" />
              <span className="text-foreground/50">%</span>
            </div>
            <p className="mt-1 text-[11px] text-foreground/40">Начисляется от полной суммы ПК при выдаче заказа.</p>
          </div>
          {empModal.id && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={empModal.is_active !== false}
                onChange={e => onChange({ is_active: e.target.checked })} />
              <span className="text-sm text-foreground/70">Активен</span>
            </label>
          )}
          <button onClick={onSave} disabled={empSaving || !empModal.name?.trim()}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            style={{ cursor: "pointer" }}>
            {empSaving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  )
}