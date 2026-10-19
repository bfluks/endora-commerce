---
title: custom_fields
description: Typowane pola, które operator dodaje do zamówień, zapytań ofertowych, szans sprzedażowych i innych rekordów bez zmiany kodu, edytowane na jednym ekranie i dostępne jako filtry list w panelu.
---

# `custom_fields`

Pola niestandardowe pozwalają operatorowi dodać własne, typowane pola do rekordów platformy —
numer zamówienia zakupu klienta przy zamówieniu, region przy zapytaniu ofertowym, źródło leada
przy szansie sprzedażowej — jako dane, bez zmiany kodu i bez migracji. Pole definiuje się raz, na
ekranie **Pola niestandardowe** (`/custom-fields`), a od tej chwili jest wypełniane, pokazywane i —
tam, gdzie lista na to pozwala — używane do filtrowania wszędzie, gdzie obsługuje się rekordy tego
rodzaju.

## Rekordy, które przyjmują pola niestandardowe

| Rekordy | Dostępne | Może być filtrem listy |
| --- | --- | --- |
| Zamówienia | zawsze | tak — lista zamówień |
| Zapytania ofertowe | gdy moduł `quote_requests` jest włączony | tak — lista zapytań ofertowych |
| Szanse sprzedażowe | gdy moduł `crm` jest włączony | tak — lista szans sprzedażowych |
| Organizacje | zawsze | nie |
| Klienci | zawsze | nie |
| Kategorie | zawsze | nie |
| Produkty | zarządzane w **Katalog → Atrybuty**, tutaj tylko do odczytu | nie |

**Typ, który podąża za modułem, znika razem z nim.** Gdy moduł `quote_requests` jest wyłączony,
pola zapytań ofertowych nie są wyświetlane, nie można ich tworzyć ani edytować i nie zwraca ich API
definicji — dokładnie tak, jak pola szans sprzedażowych przy wyłączonym `crm`. Nic nie jest
usuwane: pola, ich opcje i wszystkie zapisane wartości wracają bez zmian po ponownym włączeniu
modułu.

## Tworzenie pola

Wybierz typ rekordu na ekranie **Pola niestandardowe** i wypełnij formularz pod tabelą:

- **Klucz** — identyfikator pola: małe litery, cyfry i podkreślenia, zaczyna się od litery
  (`po_number`). Po utworzeniu pola nigdy się nie zmienia.
- **Etykieta (EN)** — etykieta angielska; gdy zostanie pusta, używany jest klucz.
- **Typ** — *Tekst*, *Liczba*, *Tak / Nie*, *Data*, *Pojedynczy wybór* lub *Wielokrotny wybór*.
  Pole wyboru przyjmuje opcje jako listę oddzieloną przecinkami.
- **Kto widzi wartość** — *Wewnętrzne* (tylko administratorzy, domyślnie) albo *Klient* (wartość
  trafia też do klienta w sklepie oraz do integracji korzystających z zewnętrznego API).
- **Wymagane** — rekordu nie da się zapisać bez wartości.
- **Używaj jako filtra listy** — dostępne tylko dla zamówień, zapytań ofertowych i szans
  sprzedażowych. Zob. [Filtry list](#filtry-list).

Przycisk **Dodaj pole** tworzy pole. **Usuń** (kosz) prosi o potwierdzenie w miejscu, zanim pole
zostanie usunięte. Tworzenie, edycja i usuwanie pól wymaga uprawnienia
`custom_fields:write`; administrator z samym `custom_fields:read` widzi tylko tabelę, bez
żadnych kontrolek, które ją zmieniają.

## Edycja pola

Każdy wiersz tabeli ma przycisk **Edytuj** (ołówek). Otwarte okno pokazuje klucz, typ rekordu i typ jako
stały tekst, a resztę pozwala zmienić:

- **Etykiety** — domyślną (wymaganą), angielską i polską.
- **Wymagane** — po włączeniu okno wyjaśnia skutki: istniejące rekordy zachowują swoje wartości,
  a rekord bez wartości tego pola będzie jej wymagał przy następnej edycji jego pól
  niestandardowych. Nic nie jest uzupełniane automatycznie.
- **Opcje** pola wyboru — każdą opcję zmienia się osobno, od razu, bez naciskania **Zapisz**:
  - jej etykiety domyślną, angielską i polską, zapisywane po opuszczeniu pola lub naciśnięciu Enter;
  - **Domyślna** — opcja wstępnie wybrana dla nowego rekordu;
  - **Przesuń w górę** / **Przesuń w dół** — zmienia kolejność, w jakiej opcja jest oferowana;
  - **Usuń** — po potwierdzeniu w oknie. Opcji, którą ma jeszcze którykolwiek rekord, nie można
    usunąć: odmowa jest pokazana przy opcji, słowami serwera;
  - **Dodaj opcję** — z zapisaną wartością i etykietami.
  **Zapisana wartość** opcji nigdy się nie zmienia — to ją przechowują rekordy — więc zmiana
  etykiety opcji nie psuje żadnego rekordu ani filtra.
- **Używaj jako filtra listy**, tam gdzie typ rekordu na to pozwala.

Zmiany opcji zapisują się od razu, więc po pierwszej z nich przycisk **Anuluj** w oknie zmienia się
w **Zamknij**. **Zapisz** wysyła tylko to, co zmieniono, a gdy nic się nie zmieniło — nic. Jeśli zmiana zostanie
odrzucona, okno pozostaje otwarte z podanym powodem. Każda zmiana trafia do dziennika audytu jako
zmiana pola.

**Czego nie da się zmienić.** Klucz, typ rekordu i typ są stałe po utworzeniu pola; żeby je zmienić,
utwórz nowe pole. Opcji w użyciu nie można usunąć. Żadna edycja nie zmienia wartości, którą rekord
już ma.

## Filtry list

**Używaj jako filtra listy** udostępnia pole jako filtr na liście jego rekordów w panelu: na liście
zamówień dla pola zamówienia, na liście zapytań ofertowych dla pola zapytania ofertowego, na liście
szans sprzedażowych dla pola szansy. Kolumna *Filtr listy* w tabeli na ekranie **Pola
niestandardowe** pokazuje, które pola są filtrami list. Włączenie lub wyłączenie tej opcji nie
zmienia żadnej zapisanej wartości.

Filtr jest opisany etykietą pola w języku administratora (w razie braku — etykietą domyślną) i
działa zależnie od typu:

| Typ | Filtr | Rekord pasuje, gdy |
| --- | --- | --- |
| Tekst | tekst, który zawiera | jego wartość zawiera ten tekst, bez względu na wielkość liter |
| Liczba | najmniejsza i największa wartość, obie opcjonalne | jego wartość mieści się w zakresie, z oboma końcami |
| Data | od dnia, do dnia, oba opcjonalne | jego data mieści się w zakresie, z oboma dniami |
| Tak / Nie | *Dowolnie*, *Tak* lub *Nie* | *Tak* pasuje do tak, *Nie* do nie |
| Pojedynczy wybór | jedna lub więcej opcji | ma którąkolwiek z nich |
| Wielokrotny wybór | jedna lub więcej opcji | ma którąkolwiek z nich |

**Rekord bez wartości nigdy nie pasuje** do filtra pola niestandardowego — nawet do *Nie* w polu
tak/nie. Kilka wartości jednego pola pasuje do którejkolwiek z nich; filtry różnych pól oraz
własne filtry listy muszą pasować wszystkie. Filtr zawęża całą listę — jej sumę i każdą stronę —
a nie tylko wiersze na ekranie, i nie wychodzi poza to, co administrator może zobaczyć.

Na każdej liście filtry są w adresie strony, więc przefiltrowaną listę można dodać do zakładek albo
wysłać współpracownikowi, a zmiana filtra wraca do pierwszej strony listy. Na listach zamówień i
zapytań ofertowych filtry są też pokazane jako usuwalne etykiety obok pozostałych aktywnych filtrów
i są zapamiętywane w zapisanych widokach.

**Filtr, który nie jest już dostępny.** Jeśli od zapisania adresu wyłączono opcję pola albo
usunięto pole, lista odrzuca żądanie, mówi o tym, podając nazwę pola, i oferuje **Usuń ten filtr**.
Zapisany widok jest za to sprawdzany przy wczytaniu: niedostępny już filtr zostaje z niego usunięty,
z komunikatem, który go nazywa, zanim lista zostanie pobrana, a reszta widoku się wczytuje. Opcja
usunięta od tego czasu z pola znika z filtra bez komunikatu — żaden rekord nie może jej mieć.

**Szanse sprzedażowe: lista i tablica są niezależne.** Filtry tablicy wynikają z tego, co pokazują
jej karty; filtry pól niestandardowych listy szans sprzedażowych wynikają z tej opcji. Pole może być
jednym, nie będąc drugim. Pole karty tablicy, które nie jest filtrem listy, nie filtruje listy szans
— link, który filtrował nim listę, jest odrzucany do czasu włączenia opcji — a tablica, łącznie z
*Pokaż więcej*, działa bez zmian.

W sklepie ani w żadnym punkcie końcowym dla kluczy API nie ma filtrów pól niestandardowych.
Filtrowanie po polu *wewnętrznym* jest narzędziem administratora i nie ujawnia niczego, czego lista
i tak nie pokazywała.

## Dla integratorów

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/custom-fields/entity-types` | `custom_fields:read` | Obecnie dostępne typy encji, każdy z `listFilter`: czy jego pola mogą być filtrami list. |
| `GET /api/v1/admin/custom-fields/definitions?entityType=…` | `custom_fields:read` | Pola danego typu, każde z `listFilter`. |
| `POST /api/v1/admin/custom-fields/definitions` | `custom_fields:write` | Tworzy pole; `listFilter` jest opcjonalne, a dla typu, który go nie obsługuje, odrzucane z `422`. |
| `PATCH /api/v1/admin/custom-fields/definitions/:id` | `custom_fields:write` | Zmienia `labelDefault`, `label`, `required`, `audience` lub `listFilter`; nieobecne pola zostają bez zmian. |
| `POST`, `PATCH`, `DELETE …/definitions/:id/options[/:optionId]` | `custom_fields:write` | Dodaje, zmienia (etykiety, `isDefault`, `sortOrder` — nigdy `value`) lub usuwa opcję. `409` dla opcji w użyciu. |

Trzy listy przyjmują filtry jako parametr żądania:

- `GET /api/v1/admin/orders`, `GET /api/v1/admin/orders/export` i
  `GET /api/v1/admin/quote-requests` przyjmują `customFieldFilters` — zakodowany w URL obiekt JSON
  z kluczami pól: `{"region":{"in":["north"]},"weight":{"min":"1.5"}}`.
- `GET /api/v1/admin/crm/opportunities` przyjmuje te same filtry jako odwołania `custom:<key>` w
  `fieldFilters`.
- Każda lista zwraca swoje dostępne pola pod `…/custom-field-filters` — `GET
  /api/v1/admin/orders/custom-field-filters`, `…/quote-requests/custom-field-filters` i
  `…/crm/opportunities/custom-field-filters`.

Operatory to `contains`, `in`, `is`, `min` / `max` (liczby dziesiętne jako tekst) oraz `from` / `to`
(`YYYY-MM-DD`). Najwyżej 10 pól i łącznie 100 wartości `in` na żądanie. Pole, które nie jest filtrem
danej listy, daje `400` `CUSTOM_FIELD_FILTER_UNAVAILABLE` z odrzuconym kluczem w `details.key`.
