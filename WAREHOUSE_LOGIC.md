# Складская логика: Минус-резерв + Автозакупка (Этап 1)

## Контекст и термины

Схема БД: `t_p72635010_quantum_fusion_resea`

**SKU** = строка в `warehouse_groups` (поле `sku`, 8 символов). Товар (`products`) ссылается на группу через `products.warehouse_group_id`. Группа ссылается на товар через `warehouse_groups.product_id`.

**Партия (supply)** = строка в `warehouse_supplies`. У одного SKU (group_id) может быть несколько партий с разной себестоимостью (FIFO по cost_price). Поля партии:
- `qty` — физически лежит на полке (свободно к резерву)
- `qty_reserved` — обычный резерв (POSITIVE), товар физически есть, заблокирован под заказ
- `qty_negative` — минус-резерв (NEGATIVE), товара нет, «долг склада»

## Инвариант остатков (на уровне SKU = group_id)

ВАЖНО: `qty` партии — это УЖЕ СВОБОДНЫЙ остаток (свободно к резерву), а НЕ полное
физическое наличие. При резерве: `qty -= n`, `qty_reserved += n`; при снятии:
`qty += n`, `qty_reserved -= n`. Поэтому:

```
free(group)             = Σ supplies.qty                 -- свободно к резерву (уже за вычетом резерва!)
total_reserved(group)   = Σ supplies.qty_reserved        -- POSITIVE резервы
total_negative(group)   = Σ supplies.qty_negative        -- NEGATIVE (долг → закупка)
physical_on_hand(group) = Σ(supplies.qty + qty_reserved) -- физически на полке = свободно + в резерве
```

⚠️ НЕ вычитать qty_reserved из Σqty при расчёте free — это ДВОЙНОЕ вычитание
(qty уже свободный). Такой баг создавал ложный минус-резерв при наличии товара
(см. чейнжлог v7.50).

POSITIVE-резерв уменьшает `qty` партии и увеличивает `qty_reserved`.
NEGATIVE-резерв НЕ трогает `qty` — только `qty_negative` (сигнал закупки).

## Алгоритм резервирования заказа (handle_reserve_and_purchase)

Запускается:
- для заказов-комплектующих (parts) — сразу при создании заказа;
- для заказов-ПК — на этапе **«Заказ»** (НЕ на «Согласовании»).

Для каждой позиции заказа (по group_id):
1. Если у позиции нет `product_id`/`group_id` (пользовательское железо) → пропустить, пометить «Пользовательское железо, пересогласуй».
2. Если qty ≤ 0 (возврат) → пропустить (минус-резерв не применяем).
3. `SELECT ... FOR UPDATE` по партиям группы (блокировка от гонок).
4. `free = Σqty - Σqty_reserved`.
5. `take = min(max(free,0), qty)` → разложить POSITIVE по партиям FIFO (по cost_price/дате): `qty -= take_i`, `qty_reserved += take_i`.
6. `shortage = qty - take`. Если `shortage > 0`:
   - добавить NEGATIVE: `qty_negative += shortage` (в партию-«буфер» группы);
   - upsert в `warehouse_backorders` (+shortage) — единый источник корзины закупки.
7. Записать движения в `warehouse_movements`.

## Гашение минус-резерва при приёмке (Этап 2 — РЕАЛИЗОВАНО)

Функция `receive_stock(cur, group_id, qty, ...)`:
- создаёт партию прихода (или использует переданную supply_id);
- находит активные NEGATIVE-резервы группы, сортирует по `orders.created_at ASC` (раньше заказ = приоритет), блокирует `FOR UPDATE OF r`;
- гасит по очереди: `qty_negative -= clear` на буфере; на партии прихода `qty -= clear`, `qty_reserved += clear`;
- NEGATIVE-резерв переходит в POSITIVE (полностью — меняем type; частично — split на две строки);
- уменьшает `warehouse_purchase_basket.required_qty`;
- остаток прихода сверх потребности остаётся свободным наличием (`free_added`).

HTTP: POST `?action=receive` {group_id, qty, cost_price, store_id?, cell?, purchase_date?, supply_id?}.

## Отмена заказа

- POSITIVE резерв → вернуть в наличие (`qty += r`, `qty_reserved -= r`).
- NEGATIVE резерв:
  - если строка backorder ещё `NEW` (не заказана поставщику) → уменьшить `qty_negative` и `backorders.qty`;
  - если уже `ORDERED` → НЕ трогать (товар уже едет).

## Пересчёт заказа (RecalcOrderReserves)

При изменении состава/кол-ва зарезервированного заказа: снять все резервы заказа и наложить заново через handle_reserve_and_purchase. ⚠️ ПРОВЕРИТЬ НА БАГИ (см. WAREHOUSE_BUGS.md).

## Источник истины

- Корзина закупки → `warehouse_backorders` (БД), НЕ localStorage. Статусы в БД.
- Старый механизм (wip_builds.{slot}_status='need_order') постепенно мигрируем на backorders.