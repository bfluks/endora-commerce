---
title: Pola niestandardowe dla encji rdzenia
---

# Pola niestandardowe

Operatorzy mogą dodawać pola do encji rdzenia **po wdrożeniu — jako dane, nigdy jako migrację
schematu czy wdrożenie kodu**. Warstwa pól niestandardowych to ogólny moduł, **niezależny od
encji**, który przejmuje *projekt* `product_attributes` z katalogu (typowane definicje, listy opcji,
etykiety dla poszczególnych języków) jako możliwość przekrojową — bez umieszczania w swoim rdzeniu
czegokolwiek specyficznego dla encji, do której pola należą.

## Obsługiwane encje

Pola niestandardowe są dostępne dla encji **Category, Order, Organization, CustomerAccount,
QuoteRequest, Opportunity i Product**. Dwie z nich **podążają za modułem właścicielskim**:
QuoteRequest za `quote_requests`, a Opportunity za `crm`. Gdy właściciela nie ma, typ znika z
panelu administracyjnego i z API definicji całkowicie — nie jest wyświetlany, tworzony ani
edytowany — a jego definicje, opcje i zapisane wartości są zachowane i wracają bez zmian razem z
modułem. Każda z tych encji ma dodatkowy zbiór wartości w JSONB
(`{ [definitionKey]: value }`); właścicielem tej kolumny i zapisów do niej jest moduł encji. W
większości encji jest to kolumna `customFieldValues`; produkt korzysta zamiast tego z istniejącej
już kolumny `products.attribute_values` (zobacz *Powiązanie sprawdzania wartości* niżej). Atrybuty
produktu zostały połączone z tą warstwą przez **adapter**, a nie przepisane: ogólna warstwa jest
właścicielem tożsamości każdego atrybutu (klucz, etykiety dla poszczególnych języków, typ wartości,
wymagalność, opcje), a katalog przechowuje flagi zachowania we własnej tabeli rozszerzenia 1:1
(`product_attributes`) i pozostaje jedynym miejscem zapisu (zobacz *Encje zarządzane przez własny
moduł* niżej).

## Jak to działa

- **Definicje to dane.** Pole to wiersz w `custom_field_definitions` (`@GlobalEntity`):
  `entityType`, `key`, przetłumaczona `label` (z wartością domyślną), `valueType`, flaga `required`
  i — dla typów wyboru — lista wierszy `custom_field_options`. Dodanie, edycja lub usunięcie pola to
  zmiana danych w panelu administracyjnym; **bez migracji i bez wdrożenia**.
- **Sześć typów wartości**: `text`, `number`, `boolean`, `date`, `select` (jedna opcja),
  `multiselect` (wiele opcji).
- **Walidacja przy każdym zapisie.** Gdy rekord encji jest tworzony lub edytowany, ogólna warstwa
  sprawdza przesłane wartości względem definicji i **odrzuca każde pole osobno** przy każdym
  naruszeniu (zły typ, brak wymaganej wartości, nieznana opcja, wartość spoza zakresu), z błędem
  wskazującym pole. Następnie moduł encji zapisuje wartości we własnej kolumnie
  `customFieldValues`.
- **Odczyt razem z polami wbudowanymi.** Wartości są zwracane wszędzie tam, gdzie odczytywany jest
  rekord — administratorowi zawsze, a każdemu innemu tylko wtedy, gdy pozwala na to **widoczność**
  pola (następna sekcja).

## Widoczność: kto odczytuje wartości pola

Każda definicja określa, komu zwracane są zapisane wartości pola:

| Widoczność | Kto odczytuje wartości |
|---|---|
| `internal` | Wyłącznie administratorzy. Wartości nigdy nie opuszczają API administracyjnego. |
| `customer` | Administratorzy **oraz** odpowiedzi encji przeznaczone dla osób spoza administracji: odpowiedzi sklepu dla klienta i odpowiedzi zewnętrznego API (klucz API). |

- **Nowe pole jest `internal`**, dopóki autor nie wybierze inaczej — w formularzu definicji („Kto
  widzi wartość”) albo polem `audience` w `POST /api/v1/admin/custom-fields/definitions`. Notatka,
  ocena kredytowa czy flaga ryzyka zamodelowana jako pole niestandardowe pozostaje więc w panelu
  administracyjnym, dopóki ktoś świadomie jej nie udostępni. Widoczność istniejącego pola zmienia
  się na tym samym ekranie albo przez `PATCH …/definitions/:id`; zmiana działa od następnego
  odczytu i nie modyfikuje zapisanych wartości.
- **Sama aktualizacja niczego nie zmienia.** Definicje istniejące przed wprowadzeniem tego atrybutu
  zostały zmigrowane do `customer`, ponieważ ich wartości były już zwracane klientom. Po
  aktualizacji przejrzyj je i przenieś do `internal` wszystko, co nigdy nie miało być pokazywane.
- **Gdzie to dziś obowiązuje.** Dwie encje zwracają wartości pól niestandardowych osobom spoza
  administracji: **Zamówienie** (odpowiedzi dla klienta pod `/api/v1/orders` i odpowiedzi
  zewnętrzne pod `/api/v1/external/orders`) oraz **Zapytanie ofertowe** (szczegóły zapytania
  klienta pod `/api/v1/quote-requests/:id`). Wartości kategorii, organizacji, kont klientów i szans
  sprzedażowych są zwracane wyłącznie w trasach administracyjnych. W każdym przypadku obiekt
  `customFieldValues` zachowuje swój kształt i po prostu zawiera mniej kluczy.
- **Wartość bez definicji jest traktowana jak wewnętrzna.** Po usunięciu pola jego zapisane
  wartości pozostają w rekordach (zob. *Retencja danych*) i nie są zwracane ani klientowi, ani
  integracji. Z tego samego powodu klucza, pod którym wciąż istnieją zapisane wartości, nie da się
  **utworzyć ponownie jako `customer`**: żądanie jest odrzucane z kodem `409`. Utwórz pole jako
  `internal`, przejrzyj zawartość rekordów, a dopiero potem zmień widoczność.
- **Zmiana widoczności może dotrzeć do wszystkich odpowiedzi nawet po 5 sekundach.** Definicje są
  przechowywane w pamięci podręcznej każdego procesu API przez 5 sekund. Proces, który obsłużył
  zmianę, stosuje ją natychmiast i powiadamia pozostałe; proces, do którego powiadomienie nie
  dotrze, zwraca poprzednią widoczność do czasu wygaśnięcia swojej kopii. Po przeniesieniu pola do
  `internal` odczekaj 5 sekund, zanim zaczniesz na tym polegać.
- **Atrybutów produktu to nie dotyczy.** Typ `product` jest zarządzany przez moduł encji: o tym,
  czy kupujący widzi atrybut, decydują własne flagi atrybutów katalogu.
- **Dla modułu encji.** Przepuść zapisany zbiór wartości przez
  `CustomFieldValuePort.projectForCustomer(entityType, bag)` w tym jednym serializatorze, który
  odpowiada osobom spoza administracji, i nigdy nie zwracaj tam surowej kolumny. Metoda korzysta z
  pamięci podręcznej definicji dla typu encji, więc wywołanie jej raz na wiersz listy nie kosztuje
  zapytania na wiersz. Żadna trasa nie pozwala osobie spoza administracji *zapisywać* wartości pól
  niestandardowych.

## Podział odpowiedzialności

Ogólna warstwa odpowiada za **definicje i walidację**; moduł encji — za **zapis i audyt**:

- Moduł pól niestandardowych nigdy nie zapisuje do tabeli innej encji i nie audytuje jej zapisów.
  Moduł encji zapisuje własny rekord i audytuje własny zapis, a ogólną warstwę wywołuje tylko po to,
  by zwalidować wartości i odczytać definicje — dzięki temu granice modułów pozostają nienaruszone i
  nie ma podwójnego audytu.
- Zmiany definicji i opcji same są wrażliwymi zapisami i przechodzą przez **Command Bus**; moduł
  rejestruje swoje uprawnienia (`custom_fields:read`, `custom_fields:write`) i uczestniczy w cyklu
  życia modułów.

## Encje zarządzane przez własny moduł (`managedBy`)

Rejestr encji (`custom-field-registry.ts`) obsługuje ogólną właściwość `managedBy` we wpisie encji:
`{ moduleId, labelKey, route }`. Gdy jest ustawiona, definicje dla tej encji tworzy wskazany moduł
we własnym interfejsie, a ogólny ekran administracyjny staje się dla tego typu encji **tylko do
odczytu**: `POST` / `PATCH` / `DELETE` na `/api/v1/admin/custom-fields/definitions*` są odrzucane z
`409 host_managed`, a strona pól niestandardowych w panelu pokazuje encję tylko do odczytu, z
informacją i odnośnikiem do ekranu, który nią zarządza. O odmowie decyduje rejestr — ogólny rdzeń
sprawdza tylko obecność znacznika, nigdy to, który moduł zarządza encją (w logice rdzenia nie ma
identyfikatora żadnej encji).

Pierwszym użytkownikiem jest produkt: `managedBy` wskazuje stronę `/catalog/attributes` modułu
katalogu, która pozostaje jedynym miejscem zapisu atrybutów produktu.

## Powiązanie sprawdzania wartości (`{table, column}`)

Zabezpieczenia zmian w ogólnej warstwie (`hasStoredValues`, `isOptionInUse` — stojące za odmowami
`value_type_locked` i `option_in_use`) sprawdzają zbiór wartości encji przez odczyt JSONB tylko do
odczytu. Miejsce sprawdzania to dla każdej encji **powiązanie z kolumną** `{ table, column }`:
większość encji korzysta z kolumny `custom_field_values`, a produkt z
`products.attribute_values`. To powiązanie to wyłącznie metadane o przechowywaniu — w ogólnym
module nie ma żadnej logiki konkretnej encji.

## Transakcyjne API zapisu definicji (polecenia modułu encji)

Moduły zarządzające definicjami własnej encji (przez `managedBy`) zmieniają je przez eksportowane
`CustomFieldDefinitionApplyApi` (`applyCreate` / `applyUpdate` / `applyDelete` oraz warianty dla
opcji). Każda z tych funkcji działa na **EntityManagerze dostarczonym przez wywołującego**, pilnuje
ogólnych niezmienników (powtórzony klucz, reguły opcji, blokada typu wartości, opcja w użyciu) i
**niczego nie audytuje ani nie publikuje unieważnienia pamięci podręcznej** — polecenie modułu
encji zarządza transakcją, zapisuje jeden wiersz audytu i po zatwierdzeniu publikuje unieważnienie
pamięci podręcznej definicji. Dzięki temu `custom_fields` pozostaje jedynym modułem zapisującym do
swoich tabel, a polecenie modułu encji może atomowo utrzymać spójność definicji i własnych wierszy
(Command Bus nie obsługuje zagnieżdżania).

## Uwaga o połączeniu: atrybuty produktu

Połączenie odbyło się przez **adapter**, a nie przez przepisanie: atrybuty produktu stały się
definicjami pól niestandardowych dla encji `product`, a katalog przechowuje wiersz rozszerzenia 1:1
(`product_attributes`) z flagami zachowania i ustawieniami prezentacji. Ogólny rdzeń zyskał tylko
trzy opisane wyżej punkty rozszerzenia niezależne od encji (wpis `product` w rejestrze z
`managedBy`, powiązanie sprawdzania `{table, column}` i API zapisu definicji) — bez żadnej logiki
katalogu. Spojrzenie od strony katalogu i wynik migracji opisuje
[strona modułu katalogu](../modules/catalog.md#atrybuty-jako-rozszerzenia-custom-field).

## Izolacja tenantów (dziedziczona)

**Wartości** pól niestandardowych są przechowywane w kolumnach encji, więc bez dodatkowej pracy
dziedziczą izolację tenantów rekordu: wartości w zamówieniu, organizacji, kliencie czy zapytaniu
ofertowym należącym do organizacji są ograniczone do tego samego tenanta co rekord — ogólna warstwa
nie dodaje nowej ścieżki zawężania. **Definicje** należą do platformy (albo, jeśli są zawężone, do
organizacji), zgodnie z tym, jak zawężona jest sama encja.

## Flagi możliwości encji (punkt rozszerzenia)

Pole może mieć **nieprzezroczysty** obiekt `config` — flagi możliwości encji, takie jak
„filterable” czy „search-indexed”. Ogólny rdzeń **przechowuje go, ale nigdy nie interpretuje**:
flagę interpretuje moduł *encji* przez własny, udokumentowany punkt rozszerzenia (np. filtrowanie
kategorii korzysta z flagi `filterable`; możliwości produktu pozostają w `product_attributes`). Dzięki
temu sprawy dotyczące wyłącznie katalogu nie trafiają do ogólnego rdzenia — to dokładnie ten rozrost,
przed którym chroni ten podział: `product_attributes` obrastało w `isVariantAxis` / `isPromoRule` /
`filterPosition`, aż przestało nadawać się do ponownego użycia.

## Filtry list (`listFilter`)

`listFilter` to jedyny atrybut definicji, który ogólny rdzeń **interpretuje** — dlatego jest
kolumną obok `required`, a nie flagą w `config`. Definicja z włączonym atrybutem jest dostępna jako
filtr na liście swojej encji w panelu, a to ogólna warstwa zamienia filtry żądania na SQL — inaczej
każda lista encji miałaby własną kopię tych samych sześciu predykatów.

- **To rejestr decyduje, które typy mogą go mieć.** Wpis każdego typu encji w rejestrze deklaruje
  `listFilter`; dziś robią to `order`, `quote_request` i `opportunity`. Ustawienie go dla innego
  typu jest odrzucane, a punkt końcowy `entity-types` publikuje tę flagę, żeby panel oferował opcję
  tylko tam, gdzie ma ona zastosowanie. Włączenie lub wyłączenie nie zmienia żadnej zapisanej
  wartości.
- **Port.** `custom_fields` publikuje `CustomFieldListFilterPort`: `listFilterable(entityType)`
  zwraca definicje oferowane przez listę, a `condition(entityType, filters)` zamienia wszystkie
  filtry żądania na **jeden** warunek — `select t."id" from "<tabela encji>" t where …`, z każdym
  kluczem i wartością jako parametrem — albo zgłasza błąd, wymieniając każdy klucz, który nie jest
  oferowany. Lista encji opakowuje ten warunek jako `id in (…)` w każdej wykonywanej instrukcji
  (wiersze, suma, liczniki), więc filtr zawęża cały wynik, a nie stronę, i działa w obrębie
  własnego zakresu tenanta i widoczności tej encji.
- **Korzysta z powiązania przechowywania.** Warunek sprawdza to samo powiązanie `{ table, column }`
  encji co opisane wyżej zabezpieczenia zmian, więc encję można filtrować bez kodu specyficznego
  dla niej w ogólnym module.
- **Semantyka.** `contains` (bez względu na wielkość liter), `in` (którakolwiek z opcji; dla
  wielokrotnego wyboru — którakolwiek z posiadanych), `is` oraz zakresy `min`/`max` i `from`/`to` z
  oboma końcami. Rekord bez wartości nigdy nie pasuje. Wartości jednego pola łączy OR; pola oraz
  własne filtry listy łączy AND. Najwyżej 10 pól i 100 wartości `in` na żądanie.
- **Odmowa nigdy nie jest cicha.** Klucz nieznany, innego typu albo nieoferowany jest odrzucany z
  `400` `CUSTOM_FIELD_FILTER_UNAVAILABLE` i nazwany, a nie pomijany — pominięty filtr pokazuje
  operatorowi więcej rekordów, niż chciał, i nic o tym nie mówi.
- **Brak w sklepie.** Żaden filtr pola niestandardowego nie trafia do sklepu ani do punktów
  końcowych dla kluczy API.

### Dlaczego tablica CRM zachowuje własne predykaty

Tablica szans sprzedażowych filtruje po tym, co pokazują jej **karty** — polach wbudowanych i
niestandardowych, łącznie z osobą kontaktową — i pomija pole, którego karta już nie pokazuje, żeby
stary link nadal się otwierał. Ta reguła należy do tablicy, nie do definicji, i obejmuje pola, o
których ogólna warstwa nic nie wie. Dlatego tablica zachowuje własne predykaty, a `listFilter`
stosuje tylko **lista** szans: jej odwołania `custom:` przechodzą przez port i są odrzucane, gdy
nie są oferowane, a tablica — i żądanie listy kontynuujące jedną z jej kolumn (`cardValues=true`)
— zachowują regułę karty.

## Przechowywanie danych

Usunięcie definicji pola **nie** usuwa zapisanych wartości: nieaktualne wartości są zachowywane w
uśpieniu (nie są pokazywane ani odczytywane), zamiast być od razu kasowane, więc pomyłkowe usunięcie
da się cofnąć, a zapisy encji nigdy nie prowadzą kaskadowo do utraty danych.

## Dodawanie pola niestandardowego

Zdefiniuj pole na ekranie pól niestandardowych w panelu administracyjnym, dla wybranego typu encji
(klucz, przetłumaczona etykieta, typ wartości, wymagalność, widoczność, opcje). Od tej chwili pole pojawia się
w każdym rekordzie tego typu, a jego wartość jest zapisywana i odczytywana przez zwykłe ścieżki
tworzenia, edycji i odczytu encji — bez zmiany kodu.
