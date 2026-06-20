import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"

const CONSENT_KEY = "begraphics_privacy_consent_v1"

export default function ConsentModal() {
  const [show, setShow] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    try {
      if (!localStorage.getItem(CONSENT_KEY)) setShow(true)
    } catch { /* ignore */ }
  }, [])

  const accept = () => {
    try {
      localStorage.setItem(CONSENT_KEY, new Date().toISOString())
    } catch { /* ignore */ }
    setShow(false)
  }

  if (!show) return null

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" style={{ cursor: "auto" }}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl">
        {/* Заголовок */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4 sm:px-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon name="ShieldCheck" size={20} />
          </span>
          <div>
            <h2 className="text-base font-bold sm:text-lg">Согласие на обработку персональных данных</h2>
            <p className="text-xs text-foreground/50">Пожалуйста, ознакомьтесь перед использованием сайта</p>
          </div>
        </div>

        {/* Прокручиваемый текст */}
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-foreground/75 sm:px-6">
          <p className="mb-3">
            Настоящим, в соответствии с Федеральным законом № 152-ФЗ «О персональных данных»,
            продолжая использование сайта BeGraphics, вы подтверждаете своё согласие на обработку
            персональных данных на изложенных ниже условиях.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-foreground">1. Оператор</h3>
          <p className="mb-3">
            Обработку персональных данных осуществляет владелец сайта BeGraphics (далее — «Оператор»).
            Контакты для обращений: Telegram <span className="text-foreground">@BeGraphicsCard</span>,
            тел. <span className="text-foreground">+7 (960) 029-69-98</span>.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-foreground">2. Какие данные обрабатываются</h3>
          <p className="mb-3">
            Имя, номер телефона, адрес электронной почты, данные о заказе и доставке, а также
            технические данные (cookie-файлы, IP-адрес, сведения о браузере и устройстве,
            действия на сайте), необходимые для работы сервиса и аналитики.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-foreground">3. Цели обработки</h3>
          <p className="mb-3">
            Оформление и выполнение заказов, связь с вами по заявкам и обращениям, оказание услуг
            ремонта и сборки, информирование о статусе заказа, улучшение работы сайта и сервиса,
            исполнение требований законодательства.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-foreground">4. Правовые основания</h3>
          <p className="mb-3">
            Обработка осуществляется на основании настоящего согласия, а также для исполнения
            договора, стороной которого вы являетесь, и в соответствии с требованиями закона.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-foreground">5. Cookie-файлы</h3>
          <p className="mb-3">
            Сайт использует cookie и аналогичные технологии для корректной работы, сохранения
            настроек (например, темы оформления) и анализа посещаемости. Вы можете отключить
            cookie в настройках браузера, однако часть функций может стать недоступной.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-foreground">6. Передача третьим лицам</h3>
          <p className="mb-3">
            Данные могут передаваться службам доставки, платёжным сервисам и иным партнёрам
            исключительно в объёме, необходимом для исполнения заказа, с соблюдением требований
            о конфиденциальности.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-foreground">7. Срок и условия обработки</h3>
          <p className="mb-3">
            Данные обрабатываются в течение срока, необходимого для достижения целей обработки,
            либо до отзыва согласия. Оператор принимает необходимые правовые, организационные и
            технические меры для защиты персональных данных.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-foreground">8. Ваши права</h3>
          <p className="mb-3">
            Вы вправе получить информацию об обработке ваших данных, требовать их уточнения,
            блокирования или удаления, а также отозвать согласие в любой момент, направив
            обращение Оператору по указанным выше контактам. Отзыв согласия не влияет на
            законность обработки, осуществлённой до его отзыва.
          </p>

          <p className="mb-1 mt-4 text-xs text-foreground/50">
            Нажимая «Принимаю», вы подтверждаете, что ознакомились с условиями, даёте согласие на
            обработку персональных данных и использование cookie-файлов.
          </p>
        </div>

        {/* Кнопка внизу текста */}
        <div className="border-t border-border bg-card px-5 py-4 sm:px-6">
          <button
            onClick={accept}
            className="w-full rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            style={{ cursor: "pointer" }}
          >
            Принимаю
          </button>
          <button
            onClick={() => navigate("/privacy")}
            className="mt-2 w-full text-center text-xs text-foreground/50 hover:text-primary transition-colors"
            style={{ cursor: "pointer" }}
          >
            Открыть полный текст Политики конфиденциальности
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
