import Icon from "@/components/ui/icon"
import StressBrandSettings from "@/components/partners/StressBrandSettings"
import StressNotifySettings from "@/components/partners/StressNotifySettings"

/**
 * Брендинг отчётов и Telegram-уведомления НАШЕЙ компании.
 * Интерфейс тот же, что в кабинете партнёра, но настраивает наш бренд:
 * бэкенд без company_id сам подставляет компанию с флагом is_own.
 */
export default function StressBrandingTab({ adminKey }: { adminKey: string }) {
  return (
    <div>
      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
        <Icon name="BadgeCheck" size={18} className="mt-0.5 shrink-0 text-primary" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">Брендинг наших отчётов</h2>
          <p className="mt-0.5 text-xs text-foreground/50">
            Логотип, ссылки и QR-код в PDF наших стресс-тестов, а также
            уведомления в Telegram. Настройки партнёров живут отдельно —
            в разделе «Партнёры».
          </p>
        </div>
      </div>

      <div className="space-y-5">
        <StressBrandSettings adminKey={adminKey} defaultOpen />
        <StressNotifySettings adminKey={adminKey} defaultOpen />
      </div>
    </div>
  )
}
