/**
 * Генерация статичных HTML-страниц для поисковых роботов.
 *
 * Зачем: сайт — одностраничное приложение, весь текст подставляет браузер
 * через JavaScript. Робот и ИИ-ассистент получают пустой каркас с общим
 * заголовком «BeGraphics — сборка, ремонт и комплектующие для ПК»,
 * одинаковый для всех адресов. Поэтому статьи не индексировались.
 *
 * Что делает: после сборки складывает рядом с index.html настоящие
 * страницы — dist/articles/8/index.html и т.д. — с заголовком, описанием,
 * микроразметкой и полным текстом. Хостинг отдаёт файл напрямую, робот
 * видит содержимое сразу. Живой посетитель попадает на ту же страницу,
 * приложение поднимается поверх и работает как раньше.
 *
 * Запускается автоматически в npm run build.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const SITE = "https://begraphics.ru";

const API = JSON.parse(
  fs.readFileSync(path.join(ROOT, "backend", "func2url.json"), "utf8")
);

/** Экранирование текста для вставки в HTML-атрибут или тело страницы. */
const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Убрать теги и лишние пробелы — для описаний. */
const plain = (html = "") =>
  String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** Запрос с повтором: сборочный сервер иногда ловит обрыв сети. */
async function fetchText(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.text();
    } catch (e) {
      last = e;
      await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
    }
  }
  throw new Error(`${last?.message || "ошибка"} ${url}`);
}

async function json(url) {
  return JSON.parse(await fetchText(url));
}

/**
 * Карта сайта в /sitemap.xml.
 *
 * Раньше она отдавалась по служебному адресу облачной функции: роботы
 * такую карту находят хуже, а Яндекс требует, чтобы карта лежала на том
 * же домене, что и сайт. Забираем содержимое при сборке и кладём файлом.
 */
async function writeSitemap() {
  const xml = await fetchText(API.sitemap);
  if (!xml.includes("<urlset") && !xml.includes("<sitemapindex")) {
    throw new Error("ответ не похож на карту сайта");
  }
  fs.writeFileSync(path.join(DIST, "sitemap.xml"), xml, "utf8");
  const n = (xml.match(/<loc>/g) || []).length;
  console.log(`prerender: sitemap.xml — адресов ${n}`);
}

/**
 * Собрать HTML страницы: берём каркас сборки и заменяем в нём мета-теги,
 * а внутрь #root кладём готовый текст. React при запуске перерисует
 * содержимое, так что дублирования пользователь не увидит.
 */
function buildPage(shell, { url, title, description, image, body, jsonld, type = "article" }) {
  let html = shell;

  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : "",
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    jsonld
      ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`
      : "",
  ]
    .filter(Boolean)
    .join("\n    ");

  // Выкидываем мета-теги каркаса, чтобы не спорили с нашими
  html = html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+name="description"[^>]*>/gi, "")
    .replace(/<link\s+rel="canonical"[^>]*>/gi, "")
    .replace(/<meta\s+property="og:(type|url|title|description|image)"[^>]*>/gi, "")
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>/gi, "");

  html = html.replace("</head>", `    ${head}\n  </head>`);
  // Каркас содержит именно пустой <div id="root"></div> — вставляем текст
  // внутрь него.
  const marker = '<div id="root"></div>';
  if (html.includes(marker)) {
    html = html.replace(marker, `<div id="root">${body}</div>`);
  } else {
    html = html.replace(/<div id="root">\s*<\/div>/, `<div id="root">${body}</div>`);
  }
  return html;
}

function write(route, html) {
  const dir = path.join(DIST, route);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
}

/**
 * Разделы сайта. Заголовки заданы здесь списком, а не вытащены из кода:
 * в компонентах атрибут title попадается и у служебных элементов (кнопок,
 * подсказок), автоматический разбор цеплял их вместо заголовка страницы.
 */
const SECTIONS = [
  ["shop", "Магазин комплектующих для ПК — BeGraphics",
    "Видеокарты, процессоры, материнские платы, память и другие комплектующие для ПК с доставкой. Новые и б/у."],
  ["builds", "Готовые сборки ПК — купить игровой компьютер — BeGraphics",
    "Готовые сборки игровых и рабочих компьютеров с проверкой и гарантией. Подбор конфигурации под задачи и бюджет."],
  ["articles", "Статьи и тесты — обзоры, гайды и бенчмарки железа — BeGraphics",
    "Обзоры комплектующих, тесты и бенчмарки, гайды по сборке и ремонту ПК от мастерской BeGraphics."],
  ["configurator", "Конфигуратор ПК — соберите компьютер онлайн — BeGraphics",
    "Соберите компьютер под свои задачи: подбор комплектующих с проверкой совместимости и расчётом цены."],
  ["tier-lists", "Тир-листы комплектующих — рейтинги железа — BeGraphics",
    "Рейтинги видеокарт, процессоров и других комплектующих по результатам тестов мастерской."],
  ["faq", "Вопрос-ответ — заказ, доставка и гарантия — BeGraphics",
    "Ответы на частые вопросы: оплата, доставка, гарантия и сборка ПК на заказ."],
  ["promo", "Акции и промокоды — скидки на сборки ПК — BeGraphics",
    "Актуальные акции и промокоды: скидки на сборки ПК и комплектующие. Промокод вводится в корзине."],
  ["cables", "Кастомные кабели для ПК — BeGraphics",
    "Кастомные кабели питания для компьютера: подбор длины и цвета под вашу сборку."],
  ["service", "Ремонт компьютеров и ноутбуков в Москве — BeGraphics",
    "Диагностика и ремонт компьютеров, ноутбуков и видеокарт. Пайка, замена чипов, восстановление после залития."],
  ["b2b", "Оптовые цены для партнёров — BeGraphics",
    "Оптовый прайс на комплектующие для сервисов, интеграторов и корпоративных клиентов."],
  ["contacts", "Контакты — как нас найти — BeGraphics",
    "Адрес мастерской, телефон и режим работы. Приём техники в ремонт и выдача заказов."],
  ["privacy", "Политика конфиденциальности — BeGraphics",
    "Как мы обрабатываем и защищаем персональные данные посетителей сайта."],
];

function writeSections(shell) {
  for (const [route, title, description] of SECTIONS) {
    const url = `${SITE}/${route}`;
    const body = `<section><h1>${esc(title.split(" — ")[0])}</h1><p>${esc(
      description
    )}</p></section>`;
    write(route, buildPage(shell, { url, title, description, body, type: "website" }));
  }
  console.log(`prerender: разделов ${SECTIONS.length}`);
}

async function main() {
  const shellPath = path.join(DIST, "index.html");
  if (!fs.existsSync(shellPath)) {
    console.log("prerender: нет dist/index.html — сначала сборка");
    return;
  }
  const shell = fs.readFileSync(shellPath, "utf8");
  let count = 0;

  await writeSitemap().catch((e) =>
    console.log("prerender: sitemap пропущен —", e.message)
  );
  writeSections(shell);

  // ── Статьи ───────────────────────────────────────────────────────────
  try {
    const data = await json(API.articles);
    const list = Array.isArray(data) ? data : data.articles || [];
    for (const a of list.filter((x) => x.is_published)) {
      const full = await json(`${API.articles}?id=${a.id}`).catch(() => null);
      const art = full?.article || full || a;
      const text = plain(art.content || "");
      if (!text) continue;

      const title = art.meta_title || `${art.title} — BeGraphics`;
      const description =
        art.meta_description || clip(plain(art.excerpt) || text, 300);
      // Канонический адрес должен совпадать с тем, что стоит в карте
      // сайта (там слаг, если он задан), иначе робот получает два разных
      // указания на одну статью и может не склеить дубли.
      const url = `${SITE}/articles/${art.slug || art.id}`;

      // Текст статьи отдаём как есть: у него уже есть <p>, <h2> и списки —
      // роботу важна именно эта структура.
      const body = `<article><h1>${esc(art.title)}</h1>${
        art.excerpt ? `<p>${esc(plain(art.excerpt))}</p>` : ""
      }${art.content || ""}</article>`;

      const jsonld = {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: clip(art.title, 110),
        description: clip(description, 300),
        image: art.image_url || undefined,
        datePublished: art.created_at || undefined,
        dateModified: art.updated_at || art.created_at || undefined,
        author: { "@type": "Organization", name: "BeGraphics" },
        publisher: { "@type": "Organization", name: "BeGraphics" },
        mainEntityOfPage: url,
      };

      write(`articles/${art.id}`, buildPage(shell, {
        url, title, description, image: art.image_url, body, jsonld,
      }));
      if (art.slug) {
        write(`articles/${art.slug}`, buildPage(shell, {
          url, title, description, image: art.image_url, body, jsonld,
        }));
      }
      count++;
    }
  } catch (e) {
    console.log("prerender: статьи пропущены —", e.message);
  }

  // ── Товары ───────────────────────────────────────────────────────────
  try {
    const data = await json(API.products);
    const list = Array.isArray(data) ? data : data.products || [];
    for (const p of list) {
      if (p.is_active === false) continue;
      const title = p.meta_title || `${p.name} — купить в BeGraphics`;
      const description =
        p.meta_description ||
        clip(plain(p.description) || `${p.name}. Наличие, цена, доставка.`, 300);
      const url = `${SITE}/product/${p.slug || p.id}`;

      const body = `<article><h1>${esc(p.name)}</h1>${
        p.description ? `<div>${p.description}</div>` : ""
      }${p.price ? `<p>Цена: ${esc(p.price)} ₽</p>` : ""}</article>`;

      const jsonld = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: p.name,
        description: clip(description, 300),
        image: p.image_url || undefined,
        offers: {
          "@type": "Offer",
          price: p.price,
          priceCurrency: "RUB",
          availability: p.in_stock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          url,
        },
      };

      const page = buildPage(shell, {
        url, title, description, image: p.image_url, body, jsonld,
        type: "product",
      });
      write(`product/${p.id}`, page);
      // В карте сайта товары указаны по слагу — страница нужна и там,
      // иначе робот придёт по адресу из карты и снова получит пустой каркас.
      if (p.slug) write(`product/${p.slug}`, page);
      count++;
    }
  } catch (e) {
    console.log("prerender: товары пропущены —", e.message);
  }

  // ── Готовые сборки ───────────────────────────────────────────────────
  // В карту сайта попадают только сборки из каталога (status=catalog) —
  // остальные это заказы клиентов, им публичная страница не нужна.
  try {
    const data = await json(API.builds);
    const list = Array.isArray(data) ? data : data.builds || data.items || [];
    for (const b of list) {
      if (b.status !== "catalog") continue;
      const title = `${b.name} — готовая сборка ПК — BeGraphics`;
      const описание = plain(b.description) ||
        `Готовая сборка ${b.name}: подбор комплектующих, сборка и проверка с гарантией.`;
      const description = clip(описание, 300);
      const url = `${SITE}/build-preview/${b.slug || b.id}`;
      const image = (b.image_urls || [])[0];

      const body = `<article><h1>${esc(b.name)}</h1>${
        b.description ? `<div>${b.description}</div>` : ""
      }${b.total_price ? `<p>Цена: ${esc(b.total_price)} ₽</p>` : ""}</article>`;

      const jsonld = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: b.name,
        description,
        image: image || undefined,
        offers: {
          "@type": "Offer",
          price: b.total_price,
          priceCurrency: "RUB",
          availability: "https://schema.org/InStock",
          url,
        },
      };

      write(`build-preview/${b.id}`, buildPage(shell, {
        url, title, description, image, body, jsonld, type: "product",
      }));
      count++;
    }
  } catch (e) {
    console.log("prerender: сборки пропущены —", e.message);
  }

  console.log(`prerender: готово, страниц ${count}`);
}

main().catch((e) => {
  // Сборку не роняем: без страниц сайт работает как раньше.
  console.log("prerender: пропущено —", e.message);
});