---
title: Nadpisania dla kanału i języka
---

# Nadpisania dla kanału i języka

Katalog stosuje dla wartości atrybutów produktu **model wartości o czterech zakresach**. Ten sam
klucz atrybutu może mieć w jednym produkcie do czterech osobnych miejsc na wartość:

- `global` — jedna wartość dla wszystkich kanałów sprzedaży i wszystkich języków;
- `language` — jedna wartość dla każdego języka (np. systemowe Name, Description);
- `channel` — jedna wartość dla każdego kanału sprzedaży, do którego przypisano produkt;
- `channel+language` — jedna wartość dla każdej pary `(channel, language)`.

O tym, które z tych miejsc są dostępne dla danego atrybutu, decydują dwie flagi w definicji
atrybutu: `channelScoped` i `languageScoped`. Atrybuty systemowe `name` i `description` mają na
stałe włączone obie (stała backendu `SYSTEM_ATTRIBUTE_SCOPES`). Atrybuty zdefiniowane przez
użytkownika są domyślnie tylko globalne, a zakresy włącza się w edytorze atrybutów.

Te same zakresy decydują też o tym, **gdzie produkt jest dostępny**: jego status, okres publikacji,
odbiorcy i zasady zamawiania mogą być różne w poszczególnych kanałach sprzedaży, a status także w
parze kanał × język. Opisuje to sekcja *Dostępność w kanale sprzedaży i w języku* poniżej. Klucze
URL produktu w językach i w parach kanał × język mają osobną stronę,
[Klucze URL i przekierowania](./url-keys-and-redirects.md).

## Po co

Katalog B2B często potrzebuje dla tego samego produktu zarówno tekstów marketingowych różnych w
poszczególnych kanałach (hurt i detal), jak i tłumaczeń na różne języki. Dotychczasowy sposób
przechowywania — JSONB w `products.name` / `products.description` i płaski JSONB
`products.attribute_values` — pozwalał wyrazić tylko wymiar językowy. Model czterech zakresów
znosi to ograniczenie bez przepisywania podstawowego sposobu przechowywania: dodaje obok osobną
tabelę nadpisań, przechowującą wartości zależne od kanału, oraz jedną funkcję rozstrzygającą, która
przy odczycie łączy oba źródła.

## Sposób przechowywania

Globalne wartości bazowe pozostają tam, gdzie były zawsze:

- `products.name` (JSONB `Record<lang, string>`) — zależne od języka.
- `products.description` (JSONB `Record<lang, string>`) — zależne od języka.
- `products.attribute_values` (JSONB `Record<key, value>`) — domyślnie globalne. Gdy flaga
  `languageScoped` atrybutu ma wartość `true`, wartość wewnętrzna też jest indeksowana językiem:
  `Record<key, Record<lang, value>>`.

Wartości zależne od kanału trafiają do nowej tabeli:

```sql
create table "product_value_overrides" (
  "id"            uuid primary key default gen_random_uuid(),
  "product_id"    uuid not null references "products"("id") on delete cascade,
  "attribute_key" varchar(64) not null,
  "channel_id"    uuid not null references "sales_channels"("id") on delete cascade,
  "language_code" varchar(16) null,
  "value"         jsonb not null,         -- always wrapped { "v": <scalar | object> }
  "created_at"    timestamptz not null default now(),
  "updated_at"    timestamptz not null default now()
);
```

Unikalność krotki (produkt, atrybut, kanał, język) zapewniają **dwa indeksy częściowe**:

```sql
create unique index "product_value_overrides_channel_only_uniq"
  on "product_value_overrides" ("product_id", "attribute_key", "channel_id")
  where "language_code" is null;

create unique index "product_value_overrides_channel_lang_uniq"
  on "product_value_overrides" ("product_id", "attribute_key", "channel_id", "language_code")
  where "language_code" is not null;
```

W zwykłym ograniczeniu UNIQUE PostgreSQL traktuje każdy `NULL` jako odrębną wartość, więc jedynym
poprawnym sposobem wyrażenia, że „(kanał, NULL) i (kanał, NULL) to ten sam wiersz”, są dwa indeksy
częściowe — po jednym dla każdego przypadku `NULL`.

Do wyszukiwania w ciasnych pętlach funkcja rozstrzygająca używa zwykłego indeksu btree:

```sql
create index "product_value_overrides_product_attr_idx"
  on "product_value_overrides" ("product_id", "attribute_key");
```

Druga tabela — `product_editor_preferences` — przechowuje dla każdej pary (administrator, produkt)
ostatnio wybrane `(channelId, languageCode)`, aby strona edycji produktu ustawiała przełączniki tak
jak przy poprzedniej wizycie. Tabela nie ma klucza obcego do `sales_channels`, więc usunięty lub
odpięty kanał jest przy odczycie po prostu pomijany.

## Funkcja rozstrzygająca

Jedynym źródłem odpowiedzi na pytanie „jaką wartość pokazać?” jest
`packages/contracts/src/product-value-resolver.ts`. Ten sam plik TypeScript importują backend
(endpointy administracyjne, odczyt dla storefrontu, indeksowanie wyszukiwarki) i aplikacja panelu
administracyjnego. Podgląd wartości efektywnej w panelu z definicji nie może więc różnić się od
tego, co wyświetla storefront.

Algorytm — `resolveAttribute({ baseline, overrides, scope, ctx })` — przechodzi cztery kroki:

1. wartość `(channel + language)` — gdy atrybut zależy od kanału I od języka, a kontekst zawiera
   oba;
2. wartość `(channel-only)` — gdy atrybut zależy od kanału, a kanał jest w kontekście;
3. wartość bazowa `(global + language)` — dla atrybutów zależnych od języka wybiera żądany język z
   JSONB;
4. wartość bazowa `(global)` — pojedyncza wartość (albo wartość w języku podstawowym dla atrybutów
   zależnych od języka).

Wygrywa pierwsza niepusta wartość. Pusty string, `null`, pusty obiekt i pusta tablica są traktowane
jako „brak wartości” i algorytm przechodzi dalej. Funkcja zwraca zarówno wynik, JAK I znacznik
`source` wskazujący, skąd pochodzi odpowiedź — panel administracyjny wykorzystuje go, aby przy
każdym polu wyświetlić etykietę „channel + language override” / „global baseline”.

### Osierocone nadpisania

Administrator może z powrotem ustawić flagę `channelScoped` atrybutu na `false`, gdy nadpisania dla
kanałów są już zapisane. Funkcja rozstrzygająca po prostu pomija wtedy wiersze nadpisań atrybutu,
który przestał zależeć od kanału, więc storefront wraca do wartości bazowej bez utraty danych.
Osierocone wiersze może kiedyś usunąć zadanie porządkowe; ta funkcja tego nie wymaga.

## Zapis

Nadpisania zależne od kanału zapisuje się przez jeden endpoint administracyjny:

```
PATCH /api/v1/admin/catalog/products/:id/value-overrides
{
  "upserts": [
    { "attributeKey": "name",        "channelId": "<vip-uuid>", "languageCode": "en-US", "value": { "v": "VIP wholesale name (EN)" } },
    { "attributeKey": "description", "channelId": "<vip-uuid>", "languageCode": "pl-PL", "value": { "v": "Wholesale-only Polish copy" } }
  ],
  "deletes": [
    { "attributeKey": "description", "channelId": "<retail-uuid>", "languageCode": "en-US" }
  ]
}
```

Wszystkie żądane operacje wykonują się w jednej transakcji `em.transactional`. Handler najpierw
sprawdza każdy wpis według sześciu reguł i przy pierwszym błędzie wycofuje całość:

| Kod 422                             | Kiedy występuje |
| ----------------------------------- | -------------- |
| `attribute_unknown`                 | `attributeKey` nie jest ani atrybutem systemowym (`name`, `description`), ani wierszem w `product_attributes`. |
| `attribute_not_channel_scoped`      | atrybut ma `channelScoped=false`, więc nie ma wartości dla kanału. |
| `attribute_missing_language`        | atrybut ma `languageScoped=true`, ale wpis ma `languageCode=null`. |
| `channel_not_assigned_to_product`   | `channelId` nie występuje w `sales_channel_products` dla tego produktu. |
| `language_not_in_channel`           | `languageCode` nie jest `null` i nie występuje w tablicy `SalesChannel.languages` kanału. |
| `value_invalid`                     | opakowana wartość `value.v` nie pasuje do `valueType` atrybutu. |

Zapis wartości bazowych (Name / Description dla każdego języka; globalne `attribute_values`) się nie
zmienia — redaktorzy nadal korzystają z istniejących pól dla poszczególnych języków na zakładce
Details. Nadpisania dla kanałów są dodatkiem.

## Odczyt

Z funkcji rozstrzygającej korzystają następujące miejsca:

- **Endpoint administracyjny** —
  `GET /api/v1/admin/catalog/products/:id?channelId=&languageCode=&includeOverridesMap=true`
  zwraca wartości bazowe produktu ORAZ — jeśli podano parametry kontekstu — blok `resolved` z
  `name`, `description`, `attributeValues` i `sources`. Przy `includeOverridesMap=true` dołącza też
  pełną listę nadpisań, aby klient mógł pokazywać podgląd przy przełączaniu kontekstu.
- **Publiczny odczyt dla storefrontu** — kanał pobiera z nagłówka `x-sales-channel` (dotychczasowa
  konwencja), a język z `Accept-Language`, a gdy go brak — domyślny język kanału. Warstwa nadpisań
  jest niewidoczna dla publicznego klienta: otrzymuje on wartość obowiązującą. Strona produktu
  (nazwa, opis, pola SEO, wartości atrybutów, lista atrybutów na stronie produktu, produkty
  składowe zestawu grupowego i opcje pakietu) oraz każda karta na liście produktów przechodzą przez języki w kolejności własnego wyboru wartości bazowej
  storefrontu — język z żądania, potem domyślny język kanału, potem `en-US`, `en` i pierwszy
  zapisany język — i dla każdego języka biorą wartość z miejsca `(channel + language)`, jeśli jest
  wypełnione, a w przeciwnym razie zatrzymują się na nim, jeśli wartość bazowa ma tekst w tym
  języku. Nadpisanie obowiązuje więc tylko dla języka, z którego strona wzięłaby tekst bazowy, albo
  dla języka wcześniejszego w tej kolejności: żądanie w `en-US` w kanale z domyślnym językiem
  `pl-PL` pokazuje tekst bazowy `en-US`, a nie nadpisanie `pl-PL`, natomiast żądanie w `de-DE` dla
  produktu bez tekstu `de-DE` przechodzi do `pl-PL` i pokazuje jego nadpisanie. Miejsce
  `(channel-only)` jest sprawdzane na końcu i wygrywa z wartością bazową niezależnie od tego, gdzie
  zatrzymało się przejście. Kafelki powiązanych produktów zachowują własny wybór języka, który nie
  uwzględnia domyślnego języka kanału, i przez niego przechodzą miejsca nadpisań, więc kafelek może
  pokazać tekst bazowy `en-US` tam, gdzie karta na liście pokazuje nadpisanie domyślnego języka
  kanału. Produkt bez nadpisań wygląda dokładnie tak jak wcześniej.
  Gdy listę obsługuje Postgres, `sort=name` porządkuje produkty według nazwy obowiązującej w
  kanale i języku żądania (przy równych nazwach według identyfikatora), wolny tekst `q` dopasowuje
  nazwę obowiązującą i obowiązujące wartości atrybutów przeszukiwalnych, a `filter[attr.*]` i
  liczniki filtrów korzystają z wartości obowiązujących w kanale w języku żądania. Gdy listę
  obsługuje moduł `search`, sortuje on według nazwy zindeksowanej w domyślnym języku kanału (zob.
  stronę modułu `search`).
- **Indeksowanie wyszukiwarki (Meilisearch)** — tworzy jeden dokument dla każdej pary
  `(product, channel)`. Pola `name` i `description` każdego dokumentu przechodzą przez funkcję
  rozstrzygającą z `channel.defaultLanguage` jako aktywnym językiem, więc nadpisania dla kanałów
  wpływają na trafność wyników wyszukiwania w storefroncie i na sortowanie po nazwie.
- **Karty wyników wyszukiwania** — moduł wyszukiwania przed udzieleniem odpowiedzi ponownie
  odczytuje każde trafienie z Postgresa, a nazwa na karcie jest ustalana właśnie tam, a nie
  brana z indeksu: wiersze nadpisań kanału sprzedaży z żądania są odczytywane raz na stronę
  wyników, a karta przechodzi przez te same języki i miejsca, w tej samej kolejności, co karta na
  liście produktów opisana wyżej. Zindeksowana nazwa jest ustalana tylko dla domyślnego języka
  kanału, więc dla żądania w każdym innym języku byłaby błędna. Produkt bez nadpisania dla
  danego kanału wygląda dokładnie tak jak wcześniej.

## Panel administracyjny

Zakładka **Details** strony edycji produktu ma nad istniejącymi polami dla języków panel
`<ProductScopeEditor>`. Panel:

1. Równolegle pobiera `GET /scope-context` (kanały przypisane do produktu, języki każdego kanału,
   podstawowy język panelu administracyjnego i zapamiętany wybór redaktora) oraz
   `GET /value-overrides`.
2. Wyświetla przełącznik kanału sprzedaży (Global i każdy przypisany kanał) oraz przełącznik języka
   ograniczony do języków aktywnego kanału (albo do sumy języków wszystkich kanałów przy Global).
3. Pokazuje efektywne Name i Description dla aktywnego kontekstu, z etykietą źródła przy każdym
   polu — `channel + language override` / `channel override` / `global baseline (language)` /
   `global baseline (fallback)` / `no value`.
4. Przy każdym polu oferuje działania „Add override” / „Edit override” / „Użyj dziedziczonego”. Zmiany
   są zapisywane przez `PATCH /value-overrides` z optymistycznym odświeżeniem.
5. Zapisuje wybór redaktora `(channel, language)` przez `PUT /editor-preference` (z opóźnieniem,
   bez gwarancji), aby przy następnej wizycie ustawić ten sam kontekst.

Edycja jest możliwa dopiero po wybraniu konkretnego kanału. Przy Global (bez kanału) panel jest
tylko do odczytu, a tekst pomocy wyjaśnia, że nadpisania działają wyłącznie w obrębie kanału.

## Dostępność w kanale sprzedaży i w języku

Produkt jest **dostępny** dla kupującego w kanale sprzedaży C i języku L, gdy spełnione są
wszystkie warunki:

1. należy do kanału C i nie jest zarchiwizowany;
2. jego obowiązujący **status** w (C, L) to `active`;
3. bieżąca chwila mieści się w jego obowiązującym **okresie publikacji** (oba końce włącznie);
4. jego obowiązujący zakres **odbiorców** obejmuje kupującego.

L to pierwszy znacznik `Accept-Language` żądania dopasowany do języków kanału C, a gdy żaden nie
pasuje — domyślny język kanału C. Tę jedną regułę stosuje każdy odczyt dla kupującego — lista
produktów i jej zakres cen, liczniki filtrów i kategorii, strona produktu, powiązane produkty,
produkty składowe zestawu grupowego i opcje pakietu, szybkie wyszukiwanie, wyszukiwarka, mapa
witryny, pliki produktowe — oraz każde miejsce, w którym produkt jest nabywany: koszyk, checkout i
składanie zamówienia, zapytania ofertowe, szybkie zamówienie i zewnętrzne przyjmowanie zamówień.
Produkt niedostępny odpowiada dokładnie tak jak produkt, który nie istnieje
(`404 PRODUCT_NOT_FOUND`); nie da się odróżnić, czy produkt istnieje, jest wyłączony, jest poza
okresem publikacji, czy ma ograniczonych odbiorców. Wyjątkiem jest produkt zarchiwizowany, opisany w
sekcji *Status produktu i archiwizacja* na stronie
[Katalog](../catalog.md#status-produktu-i-archiwizacja).

### Zakresy i dziedziczenie

| Pole | Globalnie | Kanał sprzedaży | Kanał × język |
| --- | --- | --- | --- |
| Status (`active` / `inactive`) | `products.status` | tak | tak |
| Okres publikacji | `products.publish_from` / `publish_until` | tak | — |
| Odbiorcy (widoczność i organizacje) | `products.visibility` / `allowed_organization_ids` | tak | — |
| Minimalna ilość zamówienia, możliwość zwrotu | `products` | tak | — |

Każde pole przyjmuje wartość z najbardziej szczegółowego zakresu, który ją ustawia: status — z
pary kanał × język, potem z kanału, potem globalną; pozostałe pola — z kanału, potem globalną.
Zakres bez ustawienia **dziedziczy** — nie ma „pustej” wartości, która by coś wyłączała. Produkt bez
nadpisań działa dokładnie tak jak wcześniej.

- **Status.** `inactive` w dowolnym zakresie oznacza po prostu wyłączenie w tym zakresie, a
  archiwizacja nie jest statusem — zob. sekcję *Status produktu i archiwizacja* na stronie
  [Katalog](../catalog.md#status-produktu-i-archiwizacja). Produkt wyłączony globalnie i `active` w
  jednym kanale jest dostępny tylko w tym kanale.
- **Okres publikacji.** `from` i `until`, oba opcjonalne (brak oznacza okres otwarty z tej strony);
  oba końce są włączone. Okres kanału zastępuje okres globalny jako para, nawet gdy obie jego strony
  są otwarte. Okres, który nie zaczyna się przed swoim końcem, jest odrzucany z kodem
  `422 VALIDATION_FAILED` (`details.field = 'window'`). Okres jest sprawdzany w chwili odpowiedzi na
  żądanie; przy jego otwarciu ani zamknięciu nic nie jest zapisywane. Zadanie cykliczne
  (`catalog.publication-window.sweep`, co pięć minut) ogłasza `product.updated.v1` z
  `changedFields: ["publicationWindow"]` dla każdego produktu, którego granica okresu została
  przekroczona, aby pamięci podręczne i indeks wyszukiwarki nadążały za zmianą.
- **Odbiorcy.** Tryb widoczności i lista organizacji stanowią jedną wartość: odbiorcy kanału
  zastępują regułę globalną w całości i nigdy nie są z nią łączeni. Wskazanie organizacji, które nie
  należą do kanału, jest dozwolone, a odpowiedź zawiera wtedy ostrzeżenie `audience_non_members`.
- **Zasady zamawiania.** Zob. sekcję *Dla kanału sprzedaży* w części o zasadach zamawiania na stronie
  [Katalog](../catalog.md#dla-kanału-sprzedaży).

Nadpisanie jest uwzględniane tylko tam, gdzie może obowiązywać: nadpisanie dla kanału, z którego
produkt został usunięty, albo dla języka, którego kanał już nie oferuje, pozostaje zapisane, ale
jest pomijane i widnieje jako osierocone (niżej), dopóki nie zostanie usunięte.

### Zapis zakresów

`GET /api/v1/admin/catalog/products/:id/scopes` (`catalog:read`) zwraca wartości globalne oraz, dla
każdego kanału, nadpisania, języki kanału i informację, czy produkt nadal do niego należy. `PATCH`
na tej samej ścieżce (`catalog:write`) je zapisuje:

```json
{
  "channels": [
    {
      "channelId": "<retail-uuid>",
      "status": "active",
      "window": { "from": "2026-11-01T00:00:00Z", "until": null },
      "audience": null,
      "languageStatuses": [{ "languageCode": "de-DE", "status": "inactive" }]
    }
  ],
  "global": { "publishUntil": "2026-12-31T23:59:59Z" }
}
```

Pominięty klucz pozostaje bez zmian; `null` usuwa nadpisanie (wartość dziedziczona). Wartość dla
kanału, do którego produkt nie należy, albo dla języka, którego kanał nie oferuje, jest odrzucana z
kodem `422 SCOPE_INVALID`; usunięcie takiego nadpisania jest zawsze dozwolone. Globalny okres
publikacji można też zapisać przez `PATCH` produktu (`publishFrom`, `publishUntil`).

Każde żądanie to jedno polecenie zapisywane w dzienniku zdarzeń, `product.scopes.update`; wysłanie
zapisanego stanu sprzed zmiany tą samą ścieżką przywraca go. Zapis ogłasza `product.updated.v1` z
`changedFields` spośród `scopedStatus`, `publicationWindow`, `audience` i `orderRules`. Zmiana
statusu, która włącza produkt, podlega kontroli kompletności — zob. stronę
[Katalog](../catalog.md#kontrola-kompletności-przy-włączaniu-produktu) — a `warnings` zawiera jego
wynik. Importy i konektory zapisują te same zakresy przez `catalogProductScopeWritePort`, bez
sprawdzania; tabela pól jest na stronie
[Klucze URL i przekierowania](./url-keys-and-redirects.md#integracje). Ustawienie statusu w jednym
kanale wielu produktom naraz to *Status w kanale i języku* w edycji zbiorczej — zob. stronę
[Katalog](../catalog.md#status-dla-kanału-i-języka-zbiorczo).

W edytorze produktu są to **ustawienia zakresów** pod przełącznikiem kanału na zakładce Details
(status w kanale i w języku, okres publikacji, odbiorcy) oraz **Zasady zamawiania w kanałach** na
zakładce Inventory; bez uprawnienia `catalog:write` wszystkie są tylko do odczytu.

### Przegląd zakresów

`GET /api/v1/admin/catalog/products/:id/scope-overview` (`catalog:read`) przedstawia produkt jako
tabelę kanałów × języków, a zakładka **Scopes** edytora produktu ją pokazuje. Każda komórka
zawiera:

- obowiązujący status i jego źródło (`channel_language`, `channel` albo `global`);
- informację, czy produkt jest tam teraz dostępny — należy do kanału, język jest oferowany, produkt
  jest włączony, mieści się w okresie publikacji i nie jest zarchiwizowany; odbiorcy są pokazani jako
  reguła, a nie sprawdzani dla kogokolwiek;
- każde pole nadpisane w tej komórce i poziom, z którego pochodzi — `status`, `window`,
  `audience`, `minOrderQuantity`, `returnable`, `name`, `description`, `attribute:<key>`,
  `urlKey` oraz pola galerii, załączników, jednostek opakowania i SEO ustawione dla kanału lub
  języka;
- `missing` — co w tym miejscu zgłosiłaby kontrola kompletności, niezależnie od statusu komórki.

Nadpisania, które już nie obowiązują, są wymienione w `orphans` z powodem: `not_a_member`,
`language_not_offered` albo `attribute_scope_changed`. Na zakładce Scopes wartość zakresu,
nadpisanie wartości albo klucz URL wraca do wartości dziedziczonej przyciskiem **Użyj
dziedziczonego** tam, gdzie jest ustawione — wartości samego kanału w kolumnie „Cały kanał”,
wartości samego języka w wierszu „Każdy kanał” — a osierocone nadpisanie (wymienione w sekcji
**Nie obowiązuje już**) można usunąć; zakładka wywołuje endpoint, do którego należy dana wartość
(`…/scopes`, `…/value-overrides` albo `…/url-keys`). Przywrócenie wartości tekstowej (nazwy,
opisu, klucza URL, pola SEO) i usunięcie osieroconej wartości wymagają potwierdzenia, które
nazywa pole i zakres; pozostałe wartości wracają jednym kliknięciem. Produkt, który nie należy do żadnego
kanału sprzedaży, nie ma kanałów i ma wszystkie aktywne języki platformy.

Przed wyłączeniem flagi `channelScoped` lub `languageScoped` atrybutu
`GET /api/v1/admin/catalog/attributes/:idOrKey/scope-change-preview?channelScoped=&languageScoped=`
zwraca, ile nadpisań wartości przestanie obowiązywać, łącznie i w każdym kanale. Zmiana zachowuje
wiersze; stają się one osierocone.

### Przechowywanie

`product_channel_scopes` przechowuje jeden wiersz dla produktu i kanału ze statusem, okresem
publikacji, odbiorcami, minimalną ilością zamówienia i możliwością zwrotu (`NULL` oznacza
dziedziczenie); `product_channel_language_scopes` przechowuje status w parze kanał × język. Oba
wiersze są usuwane razem z produktem i kanałem
(`20261022T035133_catalog_product_scopes.ts`, wraz z kolumnami globalnego okresu publikacji
`products.publish_from` i `publish_until`; bez uzupełniania danych).

## Migracja

Wszystko wprowadza jedna migracja, `20260611T140346_catalog_product_value_overrides_init.ts`:

- dodaje do `product_attributes` kolumny logiczne `channel_scoped` i `language_scoped` (domyślnie
  `false`);
- tworzy `product_value_overrides` z dwoma częściowymi indeksami UNIQUE i indeksem btree
  `(product_id, attribute_key)`;
- tworzy `product_editor_preferences` (złożony klucz główny `(admin_user_id, product_id)`).

Nie ma migracji danych bazowych ani uzupełniania danych. `down()` jest dokładnym odwróceniem —
usuwa obie tabele i obie kolumny.

## Poza zakresem

- **Nadpisania atrybutów zdefiniowanych przez użytkownika w panelu administracyjnym** — panel
  pokazuje dziś tylko systemowe Name i Description. Endpoint PATCH przyjmuje nadpisania atrybutów
  użytkownika, a odczyt je rozstrzyga, ale aplikacja panelu nie ma jeszcze dla nich interfejsu
  zapisu.
- **Ponowne indeksowanie z uwzględnieniem kanału** — endpoint PATCH nie dodaje jeszcze do kolejki
  zadania ponownego indeksowania w Meilisearch dla każdego zmienionego kanału; zmianę uwzględni
  dopiero następna aktualizacja indeksu produktu (wywołana dowolną zmianą w katalogu). Osobne
  indeksowanie przy zapisie nadpisania to niewielka zmiana do zrobienia później.
