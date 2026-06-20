import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"

export default function Privacy() {
  const navigate = useNavigate()

  useEffect(() => {
    document.title = "Политика конфиденциальности — BeGraphics"
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <span className="font-semibold text-lg text-foreground">BeGraphics</span>
          </button>
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-foreground/60 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ArrowLeft" size={15} /> Назад
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-2 text-2xl font-bold sm:text-3xl">Политика конфиденциальности и согласие на обработку персональных данных</h1>
        <p className="mb-8 text-sm text-foreground/50">
          В соответствии с Федеральным законом № 152-ФЗ «О персональных данных»
        </p>

        <div className="space-y-6 text-sm leading-relaxed text-foreground/75">
          <p>
            Настоящая Политика определяет порядок обработки и защиты персональных данных
            пользователей сайта BeGraphics. Используя сайт, вы соглашаетесь с условиями
            настоящей Политики.
          </p>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">1. Оператор</h2>
            <p>
              Обработку персональных данных осуществляет владелец сайта BeGraphics (далее — «Оператор»).
              Контакты для обращений: Telegram @BeGraphicsCard, тел. +7 (960) 029-69-98.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">2. Какие данные обрабатываются</h2>
            <p>
              Имя, номер телефона, адрес электронной почты, данные о заказе и доставке, а также
              технические данные (cookie-файлы, IP-адрес, сведения о браузере и устройстве,
              действия на сайте), необходимые для работы сервиса и аналитики.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">3. Цели обработки</h2>
            <p>
              Оформление и выполнение заказов, связь с вами по заявкам и обращениям, оказание услуг
              ремонта и сборки, информирование о статусе заказа, улучшение работы сайта и сервиса,
              исполнение требований законодательства.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">4. Правовые основания</h2>
            <p>
              Обработка осуществляется на основании согласия пользователя, а также для исполнения
              договора, стороной которого является пользователь, и в соответствии с требованиями закона.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">5. Cookie-файлы</h2>
            <p>
              Сайт использует cookie и аналогичные технологии для корректной работы, сохранения
              настроек и анализа посещаемости. Вы можете отключить cookie в настройках браузера,
              однако часть функций может стать недоступной.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">6. Передача третьим лицам</h2>
            <p>
              Данные могут передаваться службам доставки, платёжным сервисам и иным партнёрам
              исключительно в объёме, необходимом для исполнения заказа, с соблюдением требований
              о конфиденциальности.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">7. Срок и условия обработки</h2>
            <p>
              Данные обрабатываются в течение срока, необходимого для достижения целей обработки,
              либо до отзыва согласия. Оператор принимает необходимые правовые, организационные и
              технические меры для защиты персональных данных от неправомерного доступа.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">8. Права пользователя</h2>
            <p>
              Пользователь вправе получить информацию об обработке своих данных, требовать их
              уточнения, блокирования или удаления, а также отозвать согласие в любой момент,
              направив обращение Оператору по указанным контактам. Отзыв согласия не влияет на
              законность обработки, осуществлённой до его отзыва.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
