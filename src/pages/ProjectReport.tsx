import Icon from "@/components/ui/icon";

interface Row {
  label: React.ReactNode;
  value: React.ReactNode;
}

function ReportTable({
  title,
  icon,
  head,
  rows,
}: {
  title: string;
  icon: string;
  head: [string, string];
  rows: Row[];
}) {
  return (
    <section className="mb-12">
      <h2 className="mb-5 flex items-center gap-2.5 text-2xl font-bold text-white">
        <Icon name={icon} size={24} className="text-primary" />
        {title}
      </h2>
      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03]">
              <th className="px-5 py-3 text-sm font-semibold text-white/50">{head[0]}</th>
              <th className="px-5 py-3 text-sm font-semibold text-white/50">{head[1]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-white/[0.06] last:border-0">
                <td className="px-5 py-3 align-top text-sm text-white/80">{r.label}</td>
                <td className="px-5 py-3 align-top text-sm font-semibold text-white">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const Mono = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em] text-white/70">
    {children}
  </code>
);

export default function ProjectReport() {
  return (
    <div className="min-h-screen bg-[#0a0a0b] px-4 py-12 text-white sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-12">
          <p className="mb-2 text-sm font-medium uppercase tracking-widest text-primary">
            Quantum Fusion — внутренняя оценка
          </p>
          <h1 className="text-4xl font-extrabold leading-tight">Отчёт по проекту</h1>
          <p className="mt-3 max-w-xl text-white/50">
            Стек: React + TypeScript (фронтенд) · Python cloud-функции (бэкенд) · PostgreSQL.
            Цифры — фактический объём собственного кода.
          </p>
        </header>

        <ReportTable
          title="Объём кода (факты)"
          icon="FileCode"
          head={["Метрика", "Значение"]}
          rows={[
            { label: "Файлов фронтенда (.tsx / .ts, свой код)", value: "~167 файлов" },
            { label: "Строк фронтенда (React/TS, без shadcn/ui)", value: <>~26 000</> },
            {
              label: <>UI-кит <Mono>components/ui</Mono> (shadcn, сторонний)</>,
              value: "51 файл — в оценку не входит",
            },
            { label: "Cloud-функций (Python)", value: "29 функций" },
            { label: "Строк Python (свой код)", value: <>~17 500</> },
            { label: "SQL-миграций", value: <>175 файлов, ~6 000 строк</> },
            { label: "Таблиц в схеме БД", value: <>~70 таблиц</> },
            { label: "Точек входа (страницы / API / роуты)", value: "~60" },
            {
              label: "Внешних интеграций",
              value: "5: Telegram (бот + OAuth), S3, ReportLab (PDF), Ollama (OCR), PostgreSQL",
            },
          ]}
        />

        <ReportTable
          title="Структура (детали)"
          icon="LayoutGrid"
          head={["Слой", "Содержимое"]}
          rows={[
            { label: "Страницы (pages)", value: "25 страниц, 30 маршрутов" },
            { label: "Свои компоненты", value: "~67 (admin, configurator, sections и др.)" },
            {
              label: "Ключевые библиотеки фронта",
              value: "react-router, react-query, zustand, react-hook-form + zod, recharts, tiptap, lucide",
            },
            {
              label: "Крупнейшие модули бэка",
              value: <><Mono>orders</Mono>, <Mono>reserves</Mono>, <Mono>warehouse</Mono>, <Mono>wip-builds</Mono>, <Mono>tg-bot</Mono></>,
            },
            {
              label: "Домены системы",
              value: "магазин, конфигуратор ПК, заказы, склад + резервы, финансы/касса, RMA/гарантия, стресс-тесты",
            },
            { label: "Зависимости Python", value: "psycopg2, boto3, Pillow, reportlab" },
          ]}
        />

        <ReportTable
          title="Краткий вывод"
          icon="Gauge"
          head={["Показатель", "Значение"]}
          rows={[
            { label: "Свой код", value: <>~43 500 строк (26k TS + 17.5k Python) + 175 миграций</> },
            {
              label: "Сложность",
              value: <><b>Высокая</b> (нишевый домен + 5 интеграций + богатый UI + складская логика)</>,
            },
            { label: "Часы «с нуля»", value: <>2 200 – 2 800 ч</> },
            { label: "Часы с учётом AI", value: <>~1 100 – 1 600 ч эквивалента</> },
            { label: "Деньги (замена)", value: <>~6 – 12 млн ₽</> },
            { label: "Календарь (1 dev)", value: <>~12–16 мес. без AI, ~6–8 с AI</> },
          ]}
        />

        <p className="mt-8 rounded-lg border border-white/10 bg-white/[0.03] px-5 py-4 text-sm leading-relaxed text-white/50">
          Если нужно — могу сделать <span className="text-white/80">детальную таблицу по каждой
          cloud-функции</span> или оценку только одного блока (например, <Mono>склад + резервы</Mono>{" "}
          или <Mono>финансы</Mono>) отдельно от всего проекта.
        </p>
      </div>
    </div>
  );
}
