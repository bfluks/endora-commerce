---
title: price_lists
description: Cenniki dla klienta, grupy i domyślne, z progami ilościowymi i korektami dla kategorii
---

# `price_lists`

Mechanizm cen — przebudowany na pierwotnych podstawach wyznaczania cen. Obejmuje:

- **CustomerGroup** — grupa organizacji korzystających ze wspólnego cennika.
- **PriceList** — nazwany cennik ze statusem w cyklu życia (`draft`, `scheduled`, `active`,
  `expired`), typem `type` (`base` albo `sale`), opcjonalnym okresem obowiązywania (`startsAt` /
  `endsAt`) oraz regułą `applicationRule` w postaci drzewa, która decyduje, którego klienta,
  organizacji lub kanału dotyczy cennik.
- **PriceListProduct** — przypisanie produktu do cennika, ze złożonym kluczem głównym.
- **PriceListPriceBracket** — wiersz ze złożonym kluczem głównym
  `(priceListId, productId, currencyCode, minQuantity)`, zawierający cenę jednostkową w danej walucie
  dla progu ilościowego. Luki między progami są dozwolone; mechanizm wyznaczania przechodzi wtedy do
  cennika o następnym priorytecie.
- **PriceListMatrixEntry** — cena w cenniku dla *wybranych* produktów (jednego produktu, kategorii,
  wartości atrybutu, kategorii i wartości atrybutu albo wszystkich produktów), opcjonalnie dla jednej
  organizacji, w przedziale ilości, jako stała cena jednostkowa albo rabat procentowy. Zob.
  *Macierz cen* poniżej.
- **PriceDisplayModeOverride** — wiersz ze złożonym kluczem głównym `(scope, targetId)`, który
  nadpisuje łańcuch trybu wyświetlania cen na poziomie organizacji, kategorii lub produktu. Początkiem
  łańcucha są dwa klucze ustawień (`pricing.default_display_mode`,
  `pricing.unauthenticated_display_mode`).

Dawne tabele `PriceListItem` i `PriceListAssignment` (oraz kolumny `code` / `currency` / `priority` /
`isDefault` w `price_lists`) są utrzymywane przez migrację `20260504T125655_price_lists_engine.ts` wyłącznie jako tymczasowa warstwa
zgodności na czas przejścia „rozszerz → przenieś → zawęź”. Nowy kod MUSI korzystać ze schematu
mechanizmu cen przez `@endora-commerce/contracts`.

## Cykl życia

```text
draft ──activate──▶ scheduled ──auto on startsAt──▶ active ──auto on endsAt──▶ expired
  ▲                     │                              │                        │
  └──── draftify ───────┴────── draftify ──────────────┴────── activate (resets) ┘
```

- `activate` przestawia cennik `draft` (albo `expired`) na `scheduled`, gdy ustawiono przyszłe
  `startsAt`, a w przeciwnym razie od razu na `active`.
- `draftify` przywraca każdy cennik niesystemowy do `draft`.
- `PriceListStatusWorker.sweep()` wykonuje dwa przejścia zależne od czasu (`scheduled → active` w
  chwili `startsAt`, `active → expired` w chwili `endsAt`). Na produkcji wywołuje go co 5 minut
  powtarzalne zadanie BullMQ; w testach to samo `sweep()` jest dostępne przez
  `POST /api/v1/admin/price-lists-engine/internal/sweep`. Przebieg, który przestawi choć jeden
  cennik, czyści pamięć podręczną cen we wszystkich procesach (zob. *Pamięć podręczna cen*).

Cennik `Default` tworzony przy instalacji (`isSystem = true`) odrzuca każdą zmianę stanu, każde
usunięcie i każdą niepustą `applicationRule`. Migracja `20260504T125655_price_lists_engine.ts` tworzy w nim też progi na podstawie
dawnego `attributeValues.defaultPrice` każdego produktu, więc platforma zawsze ma użyteczną cenę
ostatecznej wartości zastępczej.

## Reguła stosowania (drzewo)

Kolumna JSONB `applicationRule` przechowuje unię rozłączną:

```ts
type ApplicationRule =
  | { kind: 'all' }
  | {
      kind: 'criterion';
      type: 'salesChannel' | 'customerGroup' | 'organization' | 'category' | 'currency';
      values: string[];                  // UUIDs (or ISO 4217 for currency)
    }
  | {
      kind: 'group';
      op: 'AND' | 'OR';
      children: ApplicationRule[];        // 1..20
    };
```

Ograniczenia (egzekwowane w kreatorze reguł po stronie klienta i przez normalizację w usłudze):

- Najwyżej 5 poziomów zagnieżdżonych grup.
- Listy wartości w kryterium są pozbawiane duplikatów; kody walut — zamieniane na wielkie litery.
- Puste grupy są odrzucane; jeśli korzeń zostaje pusty, jest zastępowany przez `{ kind: 'all' }` —
  ale `{ kind: 'all' }` jest dozwolone tylko w systemowym cenniku `Default`. Każdy inny cennik z
  pustą regułą jest odrzucany przy aktywacji (`400 empty_rule_on_non_default`).
- Nieznane identyfikatory celów (kanału, grupy klientów, organizacji, kategorii) są odrzucane z
  `400 unknown_target { type, values }`.

## Wyznaczanie ceny

`PricingService.resolveEngine({ product, variantId?, context })` zwraca:

```ts
{
  base:  { listId, bracket, listName },        // never null — Default is the floor
  sale:  { listId, bracket, listName } | null, // optional second tier
  displayMode: 'gross_only' | 'net_only' | 'both' | 'none',
  currencyCode: string
}
```

Algorytm:

1. Wczytaj wszystkie cenniki ze `status='active'`.
2. Sprawdź `applicationRule` każdego cennika względem kontekstu; zachowaj pasujące i podziel je
   według `type`.
3. W każdej grupie przejdź **łańcuch priorytetów**:
   - Poziom 1: jawne dopasowanie do organizacji.
   - Poziom 2: jawne dopasowanie do grupy klientów.
   - Poziom 3: jawne dopasowanie do kategorii.
   - Poziom 4: jawne dopasowanie do kanału sprzedaży.
   - Poziom 5: każdy inny pasujący cennik.
4. Na każdym poziomie wybierz zwycięzcę przez `tieBreak()` — najpierw najnowsze `modifiedAt`, potem
   `name` rosnąco.
5. Znajdź cenę, jaką wybrany cennik nalicza dla `(productId, currencyCode, quantity)` — jego własny
   próg albo jedną z pozycji macierzy cen (zob. *Macierz cen*). Jeśli cennik nie wyznacza żadnej ceny
   (luka), przejdź do cennika o następnym priorytecie w tej samej grupie; cennik Default jest zawsze
   na poziomie 5 grupy Base i stanowi ostateczne minimum.
6. Niezależnie wyznacz tryb wyświetlania przez
   `displayModeResolver(product, organization, customerKind)` w łańcuchu ustawienia → organizacja →
   kategoria → produkt.

Determinizm: te same dane wejściowe → ten sam wynik (bez zegara, bez losowości, pełny porządek przy
remisach). Z mechanizmu korzysta storefront (`GET /api/v1/storefront/products/:id/resolved-price`)
oraz koszyk i składanie zamówienia.

**Grupa klientów** w kroku 2 jest taka sama na każdej ścieżce: własna grupa zalogowanego konta
klienta, w przeciwnym razie grupa jego organizacji, w przeciwnym razie żadna. Wywołujący wskazuje
kupującego — organizację oraz, dla zalogowanego klienta, konto klienta — a mechanizm stosuje tę
regułę. Lista produktów w katalogu, strona produktu, wyszukiwanie, podpowiedzi wyszukiwania,
porównania, powiązania produktów, endpoint ceny wyznaczonej i koszyk wskazują konto; ceny
referencyjne zapytań ofertowych i podgląd zamówienia w panelu przekazują grupę, którą już ustaliły.
Konto, które nie należy do wskazanej obok organizacji, jest pomijane.

**Wywołania zbiorcze.** Oprócz pojedynczych `resolveEngine` / `resolveLinePrice` mechanizm wycenia
wiele produktów naraz: `resolveListingPrices` (strona listy, ilość 1), `resolveListingPriceDetails`
(to samo oraz podział na cenę bazową, promocyjną i tryb wyświetlania — dla strony produktu, kart na
stronie głównej i podpowiedzi wyszukiwania) oraz `resolveLinePrices` (wiele pozycji, każda w swojej
ilości — koszyk, sprawdzenie ceny przy składaniu zamówienia, ceny referencyjne zapytań ofertowych,
zewnętrzne API katalogu). Każde z nich wykonuje liczbę zapytań, która nie rośnie z liczbą produktów
ani pozycji, i dla każdego produktu lub pozycji zwraca dokładnie to, co pojedyncze wywołanie.

## Macierz cen

Cennik może wyznaczać cenę **wielu produktów jedną pozycją**. *Pozycja macierzy* określa:

| Współrzędna | Wartości |
| --- | --- |
| Dotyczy | jeden produkt · kategoria · wartość atrybutu · kategoria **i** wartość atrybutu · wszystkie produkty |
| Organizacja | jedna organizacja albo żadna (*wszyscy nabywcy*) |
| Ilość | od N sztuk, opcjonalnie do M sztuk |
| Cena | stała cena jednostkowa w jednej walucie albo rabat 0 < p ≤ 100 % (dwa miejsca po przecinku) w walucie, w której wyceniana jest pozycja |

Przykład: *Elementy złączne × Acme Sp. z o.o. × od 500 sztuk × 12 % rabatu*. Kupujący z Acme,
zamawiając 600 elementów złącznych, płacą o 12 % mniej; przy 400 sztukach, dla innej organizacji albo
dla produktu spoza kategorii cena się nie zmienia.

**O tym, których kupujących obsługuje cennik, nadal decyduje jego reguła stosowania** — pozycja
wyznacza cenę tylko w cenniku, do którego kupujący już się kwalifikuje, w kanale sprzedaży
żądania. Pozycje decydują wyłącznie o cenie *wewnątrz* tego cennika.

**Zasady, których musi przestrzegać pozycja** (inaczej zostaje odrzucona z komunikatem):

- Pozycja dla produktu wymaga organizacji — bez niej jest to zwykła cena produktu w cenniku,
  którą obsługuje już zakładka *Produkty i progi*.
- Stała cena wymaga wyboru produktu, kategorii lub atrybutu.
- Dwie pozycje o tym samym wyborze i organizacji nie mogą nakładać się zakresem ilości we wspólnej
  walucie (rabat procentowy dotyczy każdej waluty) — `409 PRICE_MATRIX_ENTRY_OVERLAP` ze wskazaniem
  kolidującej pozycji.
- Cennik może mieć najwyżej **5 000** pozycji — `409 PRICE_MATRIX_ENTRY_LIMIT`.

### Wybór według atrybutu i „Reguły cennika”

Można używać tylko atrybutów oznaczonych jako **Reguły cennika** w *Katalog → Atrybuty*, i tylko
takich, których wartością jest pojedynczy wybór, wiele wyborów albo tak/nie, i które nie są zależne
od języka ani od kanału sprzedaży (w przeciwnym razie `400 PRICE_MATRIX_ATTRIBUTE_NOT_ELIGIBLE` z
powodem). Wartość pojedynczego wyboru pasuje, gdy jest równa, atrybut wielokrotnego wyboru — gdy
wartości produktu ją zawierają, atrybut tak/nie — przy *tak* albo *nie*; produkt bez wartości nie
pasuje do żadnej. Odczytywane są własne wartości produktu, nie wariantu i nie nadpisania kanału.

Wyłączenie oznaczenia atrybutu **dezaktywuje** jego pozycje: w oknie odświeżania cen przestają
wyznaczać jakiekolwiek ceny, nigdy nie powodują błędu wyceny, zakładka *Macierz cen* pokazuje je jako
*Nieaktywne* z powodem, a po ponownym włączeniu oznaczenia znów obowiązują.

### Która pozycja wygrywa

W wybranym cenniku kandydatami są jego własny próg produktu i każda pozycja, która ma zastosowanie
(wybór, organizacja, przedział ilości, waluta). Cenę wyznacza pierwszy kandydat w tej kolejności:

| Kolejność | Zasada |
| --- | --- |
| 1 | Pozycja dla organizacji przed pozycją bez organizacji; własna organizacja kupującego przed bliższą organizacją nadrzędną, a ta przed dalszą |
| 2 | Produkt, potem kategoria ∩ atrybut, potem atrybut, potem kategoria, potem wszystkie produkty (własny próg produktu w cenniku liczy się jako kandydat produktowy bez organizacji) |
| 3 | Wyższa ilość początkowa |
| 4 | Niższa wynikowa cena |
| 5 | Stała kolejność wewnętrzna (identyfikator pozycji), więc wynik nigdy nie zależy od czasu |

Wybór kategorii korzysta z własnych przypisań produktu do kategorii, bez podkategorii — tak samo jak
kryterium kategorii w regule stosowania.

### Rabaty procentowe

Rabat jest liczony od **ceny referencyjnej**: własnego progu produktu w tym samym cenniku przy tej
ilości, a jeśli go nie ma — progu produktu w systemowym cenniku **Default**. Wynik jest zaokrąglany
połówkowo w górę do czterech miejsc po przecinku, z dokładnością, z jaką zapisywane są progi, w
arytmetyce całkowitoliczbowej. Rabat bez ceny referencyjnej nie wyznacza ceny i sprawdzany jest
następny kandydat; gdy nic w cenniku nie wyznacza ceny pozycji, wyznaczanie przechodzi do następnego
pasującego cennika, dokładnie jak przy cenniku bez progu. Rabat 100 % oznacza celowo darmową pozycję.

### Gdzie pojawiają się ceny z macierzy

Każde miejsce korzystające ze wspólnego mechanizmu wyznaczania cen — lista katalogu, strona
produktu, wyszukiwanie, porównanie, powiązane produkty, koszyk, finalizacja zamówienia, przyjmowanie
zamówień, ceny referencyjne zapytań ofertowych i sprawdzenie ceny w panelu administracyjnym — zwraca
tę samą cenę z macierzy dla tego samego kupującego, produktu, ilości i kanału. Progi ilościowe na
stronie produktu obejmują ilości początkowe pozycji, a sprawdzenie ceny wskazuje pozycję, która ją
wyznaczyła (`matrixEntryId`).

**Sortowanie i filtrowanie katalogu w storefroncie według ceny również uwzględnia ceny z
macierzy.** Cennik z pozycją, która dotyczy oglądającego przy ilości 1, jest porządkowany według
relacji wyliczanej z jego progów i pozycji, w opisanej wyżej kolejności, więc kolejność odpowiada
cenom na kartach produktów; produkt wyceniony wyłącznie pozycją macierzy jest sortowany według tej
ceny, a nie razem z produktami bez ceny. Cenniki bez takiej pozycji zachowują ścieżkę opartą na
indeksie. Pomiar na 2 000 produktów (`backend/test/perf/price_lists/matrix-resolver.bench.ts`):
pierwsza strona kosztuje ok. 3 ms bez pozycji, ok. 40 ms z rabatem na kategorię i ok. 20 ms z rabatem
na wszystkie produkty; strona listy z 50 produktami nie kosztuje żadnego dodatkowego zapytania,
gdy jej cenniki nie mają pozycji, i najwyżej trzy, gdy mają.

**Znane ograniczenie:** plik produktowy przypięty do wskazanego cennika odczytuje wyłącznie progi
produktów tego cennika; pozycje macierzy do niego nie trafiają. Pliki wyceniane przez mechanizm
wyznaczania cen (anonimowo) uwzględniają pozycje bez organizacji.

### Zarządzanie macierzą

Zakładka **Macierz cen** w cenniku (`/price-lists/:id?tab=matrix`) wyświetla pozycje z filtrami
według wyboru i organizacji, stronicowaniem oraz dodawaniem, edycją i usuwaniem dla
`price_lists:write`; z `price_lists:read` zakładka jest tylko do odczytu. Każda zmiana jest zapisywana
w dzienniku zdarzeń jako `price_list.matrix_entry_create|update|delete` na cenniku, z pozycją przed i
po zmianie, i widać ją na karcie *Ostatnia aktywność* pulpitu. Przedstawiciel handlowy widzi pozycje
bez organizacji albo wskazujące jedną z jego organizacji i nie może utworzyć pozycji dla innej
organizacji. Duplikowanie cennika kopiuje jego macierz; usunięcie cennika usuwa ją. Trwałe usunięcie
produktu, kategorii lub organizacji usuwa wskazujące je pozycje; usunięcie w panelu
administracyjnym (odwracalne) je zachowuje, oznaczone jako *Usunięty element*, żeby operator mógł
zdecydować.

## Tryby wyświetlania

Cztery wartości: `gross_only`, `net_only`, `both`, `none`. Pierwsze trzy decydują o kolumnach cen we
wszystkich miejscach storefrontu, które pokazują cenę; `none` ukrywa wszystkie elementy ceny i
zastępuje przycisk Add-to-cart istniejącym przyciskiem zapytania ofertowego. Endpointy pozycji koszyka
i składania zamówienia dodatkowo odrzucają pozycję z `400 CART_PRODUCT_QUOTE_ONLY`, gdy dla trójki
`(product, organization, channel)` wyznaczony tryb to `none` — jako druga linia obrony.

## API publiczne

### Endpointy mechanizmu cen (panel administracyjny)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/price-lists-engine?status=&type=&search=` | Lista cenników z opcjonalnymi filtrami |
| `POST /api/v1/admin/price-lists-engine` | Utworzenie cennika w stanie `draft` |
| `GET /api/v1/admin/price-lists-engine/:id` | Odczyt jednego cennika |
| `PATCH /api/v1/admin/price-lists-engine/:id` | Zmiana nazwy, typu, dat albo applicationRule |
| `POST /api/v1/admin/price-lists-engine/:id/activate` | Cykl życia → scheduled albo active |
| `POST /api/v1/admin/price-lists-engine/:id/draftify` | Cykl życia → draft |
| `POST /api/v1/admin/price-lists-engine/:id/duplicate` | Kopia (z wyzerowanymi datami i statusem) |
| `GET /api/v1/admin/price-lists-engine/:id/products` | Lista produktów z progami w poszczególnych walutach |
| `PUT /api/v1/admin/price-lists-engine/:id/products` | Zamiana listy produktów (różnicowo) |
| `POST /api/v1/admin/price-lists-engine/:id/products` | Dodanie jednego produktu |
| `POST /api/v1/admin/price-lists-engine/:id/products/bulk-add` | Dodanie do 200 produktów w jednym audytowanym zapisie — zob. *Dodawanie wielu produktów naraz* |
| `DELETE /api/v1/admin/price-lists-engine/:id/products/:productId` | Usunięcie (razem z progami) |
| `GET /api/v1/admin/price-lists-engine/:id/products/:productId/brackets` | Odczyt progów jednego produktu |
| `PUT /api/v1/admin/price-lists-engine/:id/products/:productId/brackets` | Zamiana progów (`{ bracketsByCurrency }`) |
| `POST /api/v1/admin/price-lists-engine/:id/products/:productId/brackets/copy` | Skopiowanie progów jednej waluty bez zmian do N innych |
| `GET /api/v1/admin/price-lists-engine/:id/matrix?page=&pageSize=&selectionKind=&organizationId=&productId=&categoryId=&lang=` | Pozycje macierzy cen, z filtrami i stronicowaniem (`organizationId=none` — pozycje bez organizacji) — `price_lists:read` |
| `GET /api/v1/admin/price-lists-engine/:id/matrix/:entryId` | Jedna pozycja — `price_lists:read` |
| `POST /api/v1/admin/price-lists-engine/:id/matrix` | Utworzenie pozycji — `price_lists:write` |
| `PATCH /api/v1/admin/price-lists-engine/:id/matrix/:entryId` | Zmiana pozycji; wszystkie zasady sprawdzane są na wyniku po scaleniu — `price_lists:write` |
| `DELETE /api/v1/admin/price-lists-engine/:id/matrix/:entryId` | Usunięcie pozycji — `price_lists:write` |
| `POST /api/v1/admin/price-lists-engine/internal/sweep` | Jeden przebieg workera, tylko na potrzeby testów |

### Dodawanie wielu produktów naraz

`POST /api/v1/admin/price-lists-engine/:id/products/bulk-add`, chroniony przez `price_lists:write`,
przyjmuje `{ productIds }` — od 1 do 200 identyfikatorów produktów
(`bulkAddPriceListProductsRequestSchema` w `@endora-commerce/contracts`) — i wyłącznie dopisuje.
Powtórzenia są scalane, z zachowaniem pierwszego wystąpienia.

Przyjęte żądanie odpowiada `200 { data: { added, unchanged, failed } }`, a każdy identyfikator trafia
do dokładnie jednej z trzech list:

- **`unchanged`** — produkt już jest w cenniku; jego progi pozostają dokładnie takie, jakie były.
- **`failed`** — `{ productId, reason: 'product_not_found' }` dla identyfikatora, którego katalog nie
  ma jako żywego produktu (nieznany albo usunięty miękko). Produkt roboczy albo nieaktywny jest żywy
  i zostaje dodany.
- **`added`** — każdy pozostały produkt, w kolejności z żądania, niezależnie od statusu i typu.

Całe żądanie to jedno polecenie, `price_list.products_add`, które zapisuje jeden wpis w dzienniku
audytu ze stanem po zmianie zawierającym wyłącznie liczby (`{ name, added, unchanged, failed }`) —
a gdy nic nie zostało dodane, nie zapisuje żadnego. Wpis pojawia się na karcie **Ostatnia
aktywność** na pulpicie jako *dodał(a) produkty do cennika*. Ponowne wysłanie tej samej treści jest więc
bezpieczne: produkty dodane za pierwszym razem wracają jako `unchanged`, bez śladu w dzienniku.

Odmowy niczego nie zapisują:

| Przypadek | Odpowiedź |
| --- | --- |
| Wywołujący nie ma `price_lists:write` | `403 FORBIDDEN` |
| Cennik jest systemowym cennikiem Default (jego lista produktów powstaje z domyślnej ceny każdego produktu) | `403 FORBIDDEN` |
| Cennik jest nieznany albo usunięty | `404 NOT_FOUND` |
| Treść nie jest obiektem albo `productIds` brakuje, jest puste, ma więcej niż 200 elementów lub zawiera coś, co nie jest UUID | `400 VALIDATION_FAILED` |
| Inne żądanie w tej samej chwili dodało ten sam nowy produkt | Może zwrócić `409 VERSION_CONFLICT`; ponowienie zgłasza produkt jako `unchanged` |

### Listy wyboru w kreatorze reguł (panel administracyjny)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/pricing/rule-targets/sales-channels` | Kanały do kreatora reguł |
| `GET /api/v1/admin/pricing/rule-targets/customer-groups` | Grupy klientów |
| `GET /api/v1/admin/pricing/rule-targets/organizations?search=&limit=` | Stronicowana lista organizacji |
| `GET /api/v1/admin/pricing/rule-targets/categories` | Pełne drzewo kategorii |
| `GET /api/v1/admin/pricing/rule-targets/currencies` | Waluty dostępne w którymkolwiek kanale sprzedaży |
| `GET /api/v1/admin/pricing/rule-targets/attributes?lang=` | Atrybuty, według których pozycja macierzy cen może wybierać produkty (oznaczone jako „Reguły cennika”, odpowiedniego typu), z ich wartościami |

### Tryby wyświetlania (panel administracyjny)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/pricing/display-mode-overrides?scope=` | Lista nadpisań |
| `GET /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` | Odczyt jednego nadpisania |
| `PUT /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` | Utworzenie lub aktualizacja (`{ mode }`, albo `{ mode: 'inherit' }`, aby usunąć) |

### Panel powiązanych cenników (panel administracyjny)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/products/:productId/price-lists` | Wszystkie cenniki, w których jest produkt, z podsumowaniem progów w poszczególnych walutach i linkiem do cennika |

### Sprawdzenie ceny kupującego (panel administracyjny)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/products/:id/resolved-price?organizationId=&customerAccountId=&quantity=&currency=&variantId=&salesChannelId=` | Cena, jaką dany kupujący zapłaciłby za jeden produkt, tak jak pokazują ją ekrany zapytań ofertowych w panelu administracyjnym. Chronione przez `price_lists:read` |

- **`matrixEntryId`** w odpowiedzi wskazuje pozycję macierzy cen, która wyznaczyła cenę, albo `null`,
  gdy wyznaczył ją zapisany próg.
- **`salesChannelId`** wskazuje kanał sprzedaży, w którym wyznaczana jest cena; bez niego —
  domyślny kanał systemowy. Nieznany albo błędny identyfikator jest odrzucany z
  `400 VALIDATION_FAILED`, a komunikat go nie powtarza.
- **Kupujący jest sprawdzany przed wyznaczeniem ceny.** Pytanie dotyczy organizacji
  `organizationId`, a w jej braku — organizacji konta klienta. Organizacja lub konto klienta,
  które nie istnieje, oraz — dla opiekuna handlowego — organizacja spoza tych, które może widzieć,
  dostają ten sam `404`, więc endpoint nikomu nie zdradza, co istnieje. Administrator platformy
  pomija tylko sprawdzenie opiekuna. Konto klienta, które nie należy do wskazanej organizacji,
  dostaje `400 VALIDATION_FAILED`.
- **Zmiana zachowania.** We wcześniejszych wersjach nieznana organizacja lub konto albo
  organizacja spoza zakresu dostawały cenę anonimową; teraz dostają `404`. Żądanie bez organizacji
  i bez konta nadal dostaje cenę anonimową.

### Storefront (publiczne)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/storefront/products/:id/resolved-price?quantity=&currency=&variantId=` | Cena podstawowa, promocyjna i tryb wyświetlania dla klienta |
| `GET /api/v1/storefront/pricing/display-mode/:productId` | Sam tryb wyświetlania (dla koszyka i miejsc, które wyznaczają ceny zbiorczo i osobno) |

Oba odczyty w storefroncie są wyznaczane **dla oglądającego**: korzystają z sesji kupującego, gdy
istnieje, a gdy jej nie ma, odpowiadają tak jak dla anonimowego użytkownika. Oglądającego ustala
jedna funkcja, więc tryb wyświetlania w wyznaczonej cenie i ten z tego endpointu nie mogą się różnić
dla tego samego wywołującego — kiedyś mogły, i zalogowany kupujący widział cenę netto na stronie
produktu, a brutto w koszyku, gdy `pricing.default_display_mode` i
`pricing.unauthenticated_display_mode` miały różne wartości. Odpowiedź wyznaczona dla organizacji ma
nagłówek `Cache-Control: private, no-store`; odpowiedź anonimowa go nie ma i pozostaje tą wersją,
którą przechowują roboty wyszukiwarek i wspólna pamięć podręczna storefrontu.

### Dawne API (nadal dostępne, dopóki wszystkie miejsca odczytu nie zostaną przeniesione)

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET / PUT / DELETE /api/v1/admin/price-lists{,/:code,/:id}` | Dawne zarządzanie cennikami w starej postaci |
| `GET / POST / DELETE /api/v1/admin/price-lists/:id/items{,/:itemId}` | Dawne zarządzanie pozycjami |
| `GET / POST / DELETE /api/v1/admin/price-lists/:id/assignments{,/:assignmentId}` | Dawne zarządzanie przypisaniami |
| `GET /api/v1/admin/price-lists/preview?productSku=&quantity=&organizationId=&salesChannelCode=` | Dawny podgląd |

## Uwagi o migracji (przebudowa silnika)

Migracja modułu `20260504T125655_price_lists_engine.ts` przebudowuje schemat w jednej transakcji:

1. Zakłada blokadę doradczą ograniczoną do transakcji (`pg_advisory_xact_lock`), aby równoległe
   migracje wykonywały się po kolei; blokada zwalnia się wraz z końcem transakcji.
2. Dodaje nowe kolumny w `price_lists` (`type`, `status`, `startsAt`, `endsAt`, `modifiedAt`,
   `isSystem`, `applicationRule` JSONB).
3. Tworzy trzy nowe tabele (`price_list_products`, `price_list_price_brackets`,
   `price_display_mode_overrides`).
4. Tworzy cennik `Default` ze stałym UUID `00000000-0000-4000-8000-00000000d51b`.
5. Przechodzi przez każdy `Product`, którego `attributeValues` zawiera `defaultPrice` (albo, w razie
   jego braku, `price`), przypisuje go do cennika `Default` i zapisuje po jednym progu dla każdej
   waluty dostępnej w którymkolwiek kanale sprzedaży, kopiując tę samą kwotę do każdej waluty.

Dawne klucze `attributeValues.defaultPrice` i `attributeValues.price` **nie** są usuwane, więc
istniejące miejsca odczytu działają dalej, a migracja nie zapisuje żadnego pliku raportu.

Migracja jest **dodatkiem** względem dawnego schematu — tabele `price_list_items` i
`price_list_assignments` oraz kolumny `code`/`currency`/`priority`/`isDefault` w `price_lists`
pozostają, dopóki miejsca odczytu w `cart-service`, `comparison-service`, `catalog-query`,
`search-query` i `product-link.service` nie przejdą na nowy mechanizm. Dawne kolumny usunie kolejna
migracja, gdy zakończy się przegląd.

Ten sam backfill jest dostępny jako usługa `DefaultPriceListMigrator`
(`src/backend/services/default-price-list-migration.ts` w tym module). Jest idempotentna, więc można
ją bezpiecznie uruchomić ponownie, i zwraca ustrukturyzowany raport wymieniający każdy produkt,
którego pojedyncza dawna cena została skopiowana do więcej niż jednej waluty.

## Storefront

- Odczyty katalogu niosą ze sobą podział ceny: każdy `ProductSummary` zwracany przez katalog (i
  wyszukiwanie) ma `resolvedPrice` — `basePrice`, `salePrice` i `displayMode` — z tego samego
  wyznaczenia, z którego pochodzi `price`. Strona produktu i karty produktów na stronie głównej
  pokazują go, więc każdy produkt jest wyceniany raz na stronę; żadna z nich nie wywołuje już
  `GET /api/v1/storefront/products/:id/resolved-price`.
- `GET /api/v1/storefront/products/:id/resolved-price` pozostaje dostępny przez
  `storefront/lib/api/pricing.ts` (`getResolvedPrice`) dla miejsca, które potrzebuje ceny jednego
  produktu w innej ilości.
- `BaseSalePriceBlock`, `PriceTag` i `ProductCard` korzystają z podziału na cenę bazową, promocyjną
  i tryb wyświetlania; `displayMode === 'none'` ukrywa wszystkie elementy ceny i pokazuje
  `QuoteRequestCta` (prowadzący do `AddToRfqForm`).
- Strona produktu zamienia wiersz Add-to-cart na przycisk zapytania ofertowego, gdy tryb to `none`.
- Wybór wariantu nie pokazuje ceny dla wariantu. Wariant kosztuje tyle, ile jego produkt — cenniki
  nie mają jeszcze wymiaru wariantu — więc blok ceny nad wyborem wariantu jest ceną każdego wariantu.

## Panel administracyjny

- `/price-lists` (lista cenników) i `/price-lists/:id` (edytor z zakładkami Details / Products &
  brackets / Application rule / Macierz cen; `?tab=matrix` otwiera macierz cen).
- `/price-lists/display-modes` — przegląd nadpisań oraz dwa klucze ustawień `pricing.*`.
- **Produkty i widełki** pokazuje listę produktów cennika z nazwą i SKU przy dowolnej jej długości —
  nazwy są pobierane przez `POST /api/v1/admin/catalog/products/batch-by-id` z katalogu, po 500
  identyfikatorów w żądaniu i najwyżej dwa żądania naraz — i otwiera edytor progów dla każdego
  produktu z listy; produkt, którego nazwy nie udało się ustalić, pokazuje początek swojego
  identyfikatora. **Dodaj** otwiera wspólną przeglądarkę produktów panelu administracyjnego na
  zakładce **Wszystkie**, gdzie można zaznaczyć produkt o dowolnym statusie i typie, a produkty, które
  już są w cenniku, mają oznaczenie *Już jest w tym cenniku*. **Dodaj N** wysyła jedno żądanie
  dodania zbiorczego dla najwyżej 200 produktów. Gdy zostanie przyjęte, przeglądarka się zamyka,
  lista produktów się odświeża, pierwszy dodany produkt zostaje wybrany z otwartym edytorem progów,
  a każdy produkt, którego nie udało się dodać, jest wymieniony z powodem. Gdy żądanie zostanie
  odrzucone albo odpowiedź się zgubi, przeglądarka zostaje otwarta z zachowanym zaznaczeniem,
  komunikatem o błędzie i przyciskiem **Ponów**, który wysyła te same produkty jeszcze raz; komunikat
  podaje przyczynę, jeśli odpowiedź ją zawiera — cennik Default albo brak uprawnienia (403), cennik,
  który już nie istnieje (404), nieprawidłowe żądanie (400) albo równoczesna zmiana cennika przez
  kogoś innego (409) — i informuje, że niczego nie zmieniono. **Dodaj** jest nieaktywne w systemowym
  cenniku Default, a bez uprawnienia `price_lists:write` albo `catalog:read` jest nieaktywne i
  pokazuje podpowiedź.
- `DisplayModeOverrideRow` jest osadzony w edytorze organizacji, w formularzu edycji drzewa kategorii
  i w panelu LinkedPriceListsPanel, który zastępuje dawny `PricingPlaceholder` w edytorze produktu.

## Porty

- **`buyerLinePricePort`** (`BuyerLinePricePort` w `@endora-commerce/contracts`) —
  `resolveForBuyer({ buyer, salesChannelId, currencyCode?, lines })` zwraca dla każdej pozycji
  cenę jednostkową netto, jaką kupujący zapłaciłby teraz w zwykłym zamówieniu w tym kanale: grupa
  klientów konta przed grupą organizacji, przedział ilościowy, aktywna cena promocyjna.
  `salesChannelId: null` oznacza domyślny kanał systemowy; brak `currencyCode` — domyślną walutę
  kanału; `quantity` jest w sztukach podstawowych. Produkt, który nie istnieje, dostaje
  `price: null` dla swojej pozycji; nieznany kanał zgłasza `400 VALIDATION_FAILED`. Klucze są
  zwracane w tej samej kolejności, a pozycje wyznaczane w ograniczonych porcjach. To ta sama
  implementacja, z której korzysta opisane wyżej sprawdzenie ceny kupującego, i **nie** sprawdza
  ona uprawnień — wywołujący przekazuje kupującego, którego już autoryzował. Moduł
  `quote_requests` korzysta z niej przy cenie referencyjnej każdej pozycji.

## Pamięć podręczna cen

Wyznaczone ceny są przechowywane w każdym procesie w pamięci podręcznej LRU (`PricingCache`, 60 s,
5 000 wpisów), z kluczem: produkt, wariant, ilość, waluta, kanał sprzedaży, organizacja i
obowiązująca grupa klientów.

- **Czyszczona po zatwierdzeniu.** Każdy audytowany zapis cennika czyści ją dopiero wtedy, gdy
  Command Bus zatwierdzi zapis — nigdy wcześniej, więc odczyt równoległy z zapisem nie przywróci
  starej ceny na cały czas życia wpisu. Zapis, który niczego nie zmienił, niczego nie czyści.
  Wyznaczenie, które zaczęło się przed czyszczeniem, dostaje odpowiedź, ale nie jest zapamiętywane.
- **Czyszczona w każdym procesie.** Czyszczenie jest ogłaszane na kanale Redis
  `b2b:price_lists:pricing-generation`; każdy proces API i workera subskrybuje go przy starcie i
  czyści własną pamięć, gdy inny proces je ogłosi. Jeśli Redis nie dostarczy ogłoszenia, pozostałe
  procesy nadrabiają w ciągu 60 s.
- **Czyszczona przez przebieg statusów**, gdy aktywuje albo wygasza cennik.
- **Nie jest czyszczona** przez zapisy katalogu (kategorie produktu albo jego własna cena): te
  nadal docierają do zapamiętanej ceny w ciągu do 60 s.

## Punkty rozszerzenia

- **Przejście koszyka i składania zamówień na nowy mechanizm** — pierwotny koszyk i składanie
  zamówień nadal odczytują `attributeValues.defaultPrice`. Następna wersja wprowadzi
  `PricingService.resolveLinePrice()` i uzależni od niego konstruktor `cart-service`; w tej samej
  zmianie pojawi się dodatkowe sprawdzenie `displayMode === 'none'`.
- **Podłączenie workera statusów do BullMQ** — `PriceListStatusWorker.sweep()` jest gotowy, ale
  rejestracja powtarzalnego zadania BullMQ (wzorem workera wygasania zapytań ofertowych) czeka na
  kolejną zmianę.
