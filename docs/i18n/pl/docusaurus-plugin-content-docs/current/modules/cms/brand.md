---
title: Ustawienia marki
sidebar_label: Marka
sidebar_position: 2
description: Jeden zestaw kolorów, schematów kolorów, czcionek, skali typografii, przycisków i odstępów, którego używa każdy blok Page Buildera — globalnie i opcjonalnie osobno dla kanału sprzedaży
---

# Ustawienia marki

Ekran **Marka** zawiera decyzje projektowe, za którymi podąża każdy blok Page
Buildera w storefroncie: paletę kolorów, trzy schematy kolorów, czcionkę
nagłówków i tekstu, skalę typografii, kształt przycisków oraz odstępy i
szerokości układu. Wystarczy raz zmienić tu kolor główny albo czcionkę tekstu,
a podąży za tym każda strona zbudowana w Page Builderze — bez edycji stron,
bez ponownego budowania i wdrażania.

Dopóki nikt nie zapisze ekranu, obowiązują wartości wbudowane, które odtwarzają
wygląd bloków sprzed powstania tego ekranu.

## Otwieranie ekranu

- **Nawigacja**: **Marka** (`/cms/brand`), obok pozostałych ekranów CMS.
- **Paleta poleceń**: ⌘K / CTRL+K → „Ustawienia marki” (znajdują ją też słowa
  *marka*, *czcionki*, *kolory*, *motyw* oraz angielskie *brand*, *fonts*,
  *colours*, *colors*, *typography*, *theme*).
- **Uprawnienia**: ekran otworzy i odczyta każda rola z uprawnieniem **View CMS
  content** (`cms.read`). Zapis wymaga uprawnienia **Edycja ustawień marki**
  (`cms.brand`), które samo wymaga `cms.read`. Bez niego pola są tylko do
  odczytu i nie ma przycisku zapisu.

## Co można ustawić

| Sekcja | Ustawienia |
| --- | --- |
| Kolory | Kolor główny i dodatkowy z kolorami po najechaniu, kolor tekstu na każdym z nich, skala neutralna od 50 do 900 oraz **gradient akcentu** (początek, koniec i kąt) używany przez wyróżnienia gradientowe w nagłówkach. |
| Schematy kolorów | Jasny, stonowany i ciemny. Każdy ma kolor tła, tekstu, tekstu stonowanego, obramowania i linku. Schemat ciemny może mieć też **dekoracyjne tło** — obraz, który ciemna sekcja może namalować za swoją treścią. Sekcja wybiera schemat w Page Builderze, a każdy blok w jej wnętrzu przyjmuje kolory schematu. |
| Typografia | Czcionka nagłówków i czcionka tekstu (zob. [Czcionki](#czcionki)) oraz skala typografii: Display, Nagłówek 1–6, Lead, Body i Small, każdy z rozmiarem na telefon i na komputer, interlinią, grubością, odstępem między literami i wyborem czcionki nagłówków albo tekstu. Nagłówki 1–6 dotyczą też nagłówków pisanych w tekście sformatowanym (blok Treść sformatowana, tekst sformatowany bloku). |
| Przyciski | Kształt narożników (kwadratowe, zaokrąglone albo pigułka), wysokość małego, średniego i dużego przycisku, grubość etykiety i wielkość liter etykiety. |
| Odstępy | Nazwane stopnie, z których wybiera się odstęp nad i pod sekcją — brak, bardzo mały, mały, średni, duży, bardzo duży, największy — każdy z rozmiarem na telefon i na komputer. |
| Układ | Szerokość treści, szerokość szerokiej treści oraz margines boczny na telefonie i na komputerze. Szerokość treści to kontener strony — 1360 px razem z marginesami bocznymi, dopóki jej nie zmienisz; ustaw ją większą, aby poszerzyć ramkę na każdej stronie CMS: podąża za nią każda sekcja Contained, treść trzymana w kontenerze strony i ścieżka nawigacji strony. Dwa opcjonalne mnożniki skalują tekst i kroki odstępów między progami: **Skala tekstu i odstępów na tablecie (768–1023 px)** mnoży tam rozmiary mobilne (np. 1,15 to 15 % więcej), a **Skala tekstu i odstępów na małym komputerze (1024–1279 px)** rozmiary z komputera. Puste pole to 1: nic się nie zmienia. Rozmiary ustawione w bloku we własnych pikselach (rozmiar lub odstęp **Własny (px)**) nie są skalowane. Dwa dalsze opcjonalne ustawienia, domyślnie wyłączone: **Zwiększaj rozmiary z komputera wraz z szerokością okna za małym komputerem** sprawia, że rozmiary rosną z szerokością okna od mnożnika małego komputera przy 1280 px do pełnych rozmiarów z komputera przy **Pełne rozmiary z komputera od (px, domyślnie szerokość kontenera strony)**; **Skaluj wysokość przycisków razem z tekstem i odstępami** stosuje mnożniki także do wysokości przycisków (przycisk z samą ikoną podąża za nimi, bo jest od nich liczony). |

**Podgląd** pokazuje przykład w każdym z trzech schematów z wartościami
widocznymi na ekranie, jeszcze przed zapisem.

Bloki nadal przyjmują własne wartości tam, gdzie ma to znaczenie: pole koloru
może zawierać kolor marki (zapisany jako odwołanie, np. `token:primary`, które
podąża za późniejszymi zmianami marki) albo dowolny kolor hex, a nagłówek może
nadpisać rozmiar, czcionkę, grubość lub interlinię w swojej grupie
**Advanced**.

## Ustawienia globalne i nadpisania kanałów

Karta **Zakres** wybiera, co edytujesz:

- **Wszystkie kanały (ustawienia globalne)** — ustawienia, których używa każdy
  kanał sprzedaży bez własnego nadpisania.
- **Kanał sprzedaży** — własna marka tego kanału. Kanał bez nadpisania
  pokazuje **Dziedziczy ustawienia globalne**. **Nadpisz dla tego kanału**
  zaczyna nadpisanie jako **pełną kopię** ustawień globalnych; nic nie jest
  stosowane przed zapisem.

Nadpisanie to pełna kopia, a nie lista różnic. **Późniejsza zmiana ustawień
globalnych nie trafia do kanału, który ma nadpisanie**; ekran mówi o tym przy
każdym nadpisanym kanale. **Przywróć ustawienia globalne** (po potwierdzeniu)
usuwa nadpisanie, a kanał znów podąża za ustawieniami globalnymi.

Storefront używa zestawu obowiązującego dla kanału sprzedaży żądania:
nadpisania kanału, a bez niego ustawień globalnych, a bez nich wartości
wbudowanych. Podgląd w Page Builderze używa zestawu obowiązującego dla
pierwszego kanału sprzedaży przypisanego do strony, więc redaktor widzi markę
kanału w edytorze.

## Ostrzeżenia o kontraście

Ekran ostrzega komunikatem **Niski kontrast**, gdy para kolorów ma kontrast
poniżej progu WCAG 2.2 AA:

- tekst, tekst stonowany i link każdego schematu na jego tle — 4,5:1;
- tekst na kolorze głównym i dodatkowym na wypełnieniu przycisku i jego
  wypełnieniu po najechaniu — 4,5:1;
- każdy kolor gradientu akcentu na tle każdego schematu — 3:1, próg dla dużego
  tekstu, bo wyróżnienia gradientowe występują w dużych nagłówkach.

Ostrzeżenie nigdy nie blokuje zapisu: decyduje właściciel marki. Odpowiedź na
zapis zwraca tę samą listę.

## Dekoracyjne tło

**Dekoracyjne tło** schematu ciemnego to dowolny obraz z biblioteki zasobów,
także SVG. Sekcja ze schematem ciemnym i włączonym **Decorative backdrop**
maluje je za swoją treścią, pokrywając sekcję od jej górnej krawędzi, wyśrodkowane.

Sposób rysowania tła ustawia się w sekcji (albo w grupie sekcji) obok
przełącznika **Decorative backdrop**, nie na tym ekranie: **Rozmiar tła
dekoracyjnego** (Wypełnij, domyślnie; Zmieść; Rozmiar naturalny; albo szerokość
w px lub %), **Powtarzanie tła dekoracyjnego** (bez powtarzania, domyślnie;
kafelki; w poziomie; w pionie) i **Położenie tła dekoracyjnego** (góra,
domyślnie; środek, dół, lewa albo prawa). Wysoka grupa pokryta jednym obrazem
skaluje go do swojej wysokości, przez co jego szczegóły stają się duże i
rozmyte; szerokość w px z **Powtarzaj w pionie** zachowuje tło w jego własnej
skali wzdłuż całej kolumny i w tym samym rozmiarze na każdej szerokości ekranu.

Tło można też podać adresem w polu **Adres URL dekoracyjnego tła**: adresem
`https://` albo ścieżką we własnym sklepie zaczynającą się od `/` (na przykład
`/media/backdrop.svg`, wczytywaną z adresu API sklepu, tak jak plik z
biblioteki). Ekran odrzuca przy zapisie każdy inny adres. Gdy ustawione są oba,
używany jest plik z biblioteki.

- **Osobno w każdej sekcji albo raz dla grupy.** Każda sekcja maluje własną
  kopię, więc dwie sąsiednie ciemne sekcje pokazują tło każda od swojej górnej
  krawędzi, z krawędzią między nimi. Aby jedno tło ciągnęło się za kilkoma
  sekcjami, umieść je w **grupie sekcji** ze schematem ciemnym i włączonym
  **tłem dekoracyjnym**: grupa maluje je raz, od swojej górnej krawędzi, za
  wszystkimi swoimi sekcjami (zobacz stronę modułu CMS, „Grupy sekcji”).
- **Animowany SVG.** SVG może mieć własną animację CSS (np. powoli przesuwające
  się światła). Przeglądarka rysuje go jako obraz: nie uruchamia skryptów i nie
  wczytuje niczego spoza pliku, więc wszystko — kształty, gradienty i `<style>` —
  musi być wewnątrz SVG.
- **Ograniczony ruch.** Strona nie może zatrzymać animacji wewnątrz obrazu, więc
  musi to zrobić SVG: umieść animację w
  `@media (prefers-reduced-motion: no-preference)`, a odwiedzający, który prosi
  o ograniczony ruch, zobaczy nieruchomy rysunek — **o ile przeglądarka
  sprawdza to zapytanie wewnątrz SVG rysowanego jako obraz**. Obsługa różni się
  między przeglądarkami i ich wersjami, a przeglądarka, która go nie sprawdza,
  odtwarza animację, więc sprawdź zasób w przeglądarkach obsługiwanych przez
  sklep i utrzymuj ruch powolny i subtelny. Animuj w CSS, nie w SMIL
  (`<animate>`), którego zapytanie nie zatrzyma.

Przykład, w którym miękkie światło powoli dryfuje, a przy ograniczonym ruchu
stoi w miejscu:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
  <style>
    .glow { transform-origin: 800px 450px; }
    @media (prefers-reduced-motion: no-preference) {
      .glow { animation: drift 24s ease-in-out infinite alternate; }
    }
    @keyframes drift { to { transform: translateX(120px) scale(1.15); } }
  </style>
  <defs>
    <radialGradient id="g" cx="50%" cy="40%" r="50%">
      <stop offset="0" stop-color="#1d4ed8" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#1d4ed8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect class="glow" x="0" y="0" width="1600" height="900" fill="url(#g)"/>
</svg>
```

## Czcionki

Czcionka nagłówków i czcionka tekstu są jednego z trzech rodzajów:

| Rodzaj | Co wpisujesz | Jak jest wczytywana |
| --- | --- | --- |
| **Czcionka systemowa** | Zestaw: bezszeryfowa, szeryfowa albo o stałej szerokości. | Nic nie jest pobierane. |
| **Pliki czcionek z biblioteki zasobów** | Nazwę rodziny (np. `Acme Sans`), czcionkę zastępczą (bezszeryfową albo szeryfową) i do ośmiu plików czcionek, każdy z grubością (100–900) i stylem (normalny albo kursywa). Wybór pokazuje pliki z biblioteki zasobów o typie `font/*`; najlepiej `woff2`. | Storefront zapisuje jedną regułę `@font-face` na plik z `font-display: swap` i wczytuje z wyprzedzeniem (preload) zwykły, prosty krój czcionki tekstu. |
| **Arkusz stylów usługi czcionek** | Nazwę rodziny, czcionkę zastępczą i adres `https://` arkusza stylów usługi, np. `https://fonts.example.com/css?family=Acme+Sans`. | Storefront dołącza arkusz stylów w nagłówku strony. |

Ogólna rodzina zastępcza zawsze zamyka listę czcionek, więc tekst wyświetla się,
zanim czcionka się wczyta, i także wtedy, gdy się nie wczyta. Nazwa rodziny może
zawierać litery, cyfry, spacje oraz `-`, `_`, `.`; adres arkusza stylów musi
zaczynać się od `https:`. Za licencje czcionek odpowiada wdrożenie.

### Wczytywanie czcionek z innej domeny

Przeglądarka wczyta czcionkę z innego źródła (origin) tylko wtedy, gdy to
źródło na to pozwala przez CORS. Czcionki z biblioteki zasobów serwuje API
(`/assets/file/<id>` pod publicznym adresem API), zwykle z innego źródła niż
storefront:

- **`CORS_ALLOWED_ORIGINS`** w środowisku API musi zawierać źródło storefrontu
  (np. `https://shop.example.com`). Wymagają go tam już inne wywołania
  storefrontu z przeglądarki. Podgląd na ekranie Marka i w Page Builderze
  wczytuje te same pliki z panelu, więc panel serwowany z innego źródła niż API
  też musi być na tej liście — czego i tak wymagają jego własne wywołania API.
- **Magazyn w chmurze**: gdy backend magazynu biblioteki zasobów odpowiada
  przekierowaniem na adres w buckecie, sam bucket musi wysyłać nagłówki CORS
  zezwalające na źródła storefrontu i panelu. Ustaw to w konfiguracji bucketu.
- **Usługi czcionek** wysyłają własne nagłówki CORS; po twojej stronie nic nie
  trzeba robić.

Czcionka zablokowana przez CORS nie psuje strony: używana jest rodzina
zastępcza.

## Zapis, audyt i pamięć podręczna

- **Równoczesne zmiany**: każdy zakres ma wersję. Jeśli ktoś inny zapisał ten
  sam zakres po jego wczytaniu, zapis jest odrzucany, wczytywana jest
  najnowsza wersja, a twoje zmiany nie są stosowane.
- **Walidacja**: wartość spoza zakresu jest odrzucana, a pola są wymieniane z
  nazwy.
- **Audyt**: każdy zapis to jedno polecenie (Command),
  `cms.brand_tokens.update`, z dokładnie jednym wpisem audytu dla obiektu
  `cms_brand_tokens` (id `global` albo id kanału sprzedaży), zawierającym
  ustawienia przed zmianą i po niej.
- **Storefront**: po zatwierdzeniu zapisu odświeżany jest tag pamięci
  podręcznej storefrontu `cms:brand`, więc następne żądanie używa nowych
  ustawień. Jeśli odświeżanie nie jest skonfigurowane albo się nie uda,
  storefront przejmie zmianę w ciągu pięciu minut. Ręczne czyszczenie pamięci
  podręcznej w Ustawieniach odświeża ten sam tag (przestrzeń `cms-brand`).

## Dla programistów

### Gdzie są zapisane ustawienia

- **Tabela** `cms_brand_tokens`, należąca do modułu `cms`: jeden wiersz na
  zakres, `sales_channel_id` równe null dla wiersza globalnego (unikalne,
  wartości null nie są traktowane jako różne), `tokens` (JSONB, pełny zestaw),
  `version`, `updated_at`. Reset usuwa wiersz zakresu.
- **Schemat** `cmsBrandTokensSchema`, zestaw wbudowany `DEFAULT_BRAND_TOKENS`
  i kontrola kontrastu `assessBrandContrast` w
  `packages/contracts/src/cms-brand.ts`. Tło schematu ciemnego to
  `schemes.dark.decorativeAssetId` (zasób z biblioteki) albo
  `schemes.dark.decorativeUrl` (`brandMediaUrlSchema`: `https:` albo ścieżka
  zaczynająca się od `/`, najwyżej 2048 znaków, bez cudzysłowów, nawiasów,
  ukośników wstecznych, nawiasów ostrych i białych znaków); gdy ustawione są
  oba, wygrywa zasób. Sposób, w jaki sekcja albo grupa je rysuje, należy do
  tego bloku: `decorativeSize`, `decorativeRepeat` i `decorativePosition` jego
  wartości `background` (`sectionBackgroundSchema` w
  `packages/contracts/src/page-builder-props.ts`), zapisywane w stylu elementu
  jako `background-size`, `background-repeat` i `background-position` ponad
  wartościami arkusza stylów: `cover`, `no-repeat` i `top center`.
- **Usługa** `src/backend/services/brand-tokens-service.ts` i ekran
  `src/admin/pages/BrandPage.tsx`, oba w pakiecie modułu `cms`.

### HTTP

| Metoda i ścieżka | Dostęp | Odpowiedź |
| --- | --- | --- |
| `GET /api/v1/admin/cms/brand-tokens[?salesChannelId=]` | `cms.read` | `{global, channel?, effective, warnings}` |
| `PUT /api/v1/admin/cms/brand-tokens` | `cms.brand` | Treść żądania `{scope: {kind: 'all'} \| {kind: 'channel', salesChannelId}, tokens \| null, expectedVersion}`; `200 {version, warnings}`, `409 VERSION_CONFLICT`, `400 VALIDATION_FAILED`, `404 UNKNOWN_SALES_CHANNEL`. `tokens: null` usuwa nadpisanie kanału albo przywraca zestaw globalny do wartości wbudowanych. |
| `GET /api/v1/storefront/cms/brand-tokens` | publiczny | Obowiązujący zestaw dla wyznaczonego kanału sprzedaży (bez nagłówka — dla domyślnego kanału systemowego); `cache-control: public, max-age=60`. |
| `GET /api/v1/admin/cms/page-builder/config?salesChannelId=` | `cms.read` | `brandTokens` w opisie Page Buildera, używane przez podgląd w edytorze. |

### Tokeny jako zmienne CSS

`brandTokensToCss(tokens, {assetUrl, mediaUrl})` z `@endora-commerce/cms-components`
(`packages/cms-components/src/brand/brand-css.ts`) zamienia zestaw na zmienne
CSS i linki czcionek. Storefront wyświetla wynik po stronie serwera w `<head>`
jako `<style id="cmsb">` (`storefront/lib/theme/StorefrontDocument.tsx`),
pobierając zestaw w `getServerContext()` z `revalidate: 300` i tagiem
`cms:brand`. Panel wstawia ten sam wynik do iframe Page Buildera i do podglądu
na ekranie Marka. Oba przekazują `mediaUrl`, które przenosi adres tła
zaczynający się od `/` na publiczny adres API, tak jak względny adres wideo.

| Zmienne | Źródło |
| --- | --- |
| `--cmsb-color-primary`, `-primary-hover`, `-secondary`, `-secondary-hover`, `-on-primary`, `-on-secondary` | Kolory |
| `--cmsb-n-50` … `--cmsb-n-900` | Skala neutralna |
| `--cmsb-grad` | Gradient akcentu |
| `--cmsb-fg`, `--cmsb-bg`, `--cmsb-fg-muted`, `--cmsb-border`, `--cmsb-link`, `--cmsb-decorative` | Schemat jasny na `:root`, podmieniany przez każdą regułę `[data-cmsb-scheme="light\|muted\|dark"]` |
| `--cmsb-font-heading`, `--cmsb-font-body` | Czcionki |
| `--cmsb-t-<token>-size`, `-lh`, `-w`, `-ls`, `-font` | Skala typografii (`display`, `h1`–`h6`, `lead`, `body`, `small`) |
| `--cmsb-btn-radius`, `--cmsb-btn-h-s`, `-h-m`, `-h-l`, `--cmsb-btn-weight`, `--cmsb-btn-transform` | Przyciski |
| `--cmsb-space-<step>` | Odstępy (`none` … `xxl`) |
| `--cmsb-container`, `--cmsb-wide`, `--cmsb-gutter` | Układ |

Rozmiary inne na komputerze są podmieniane w jednym bloku
`@media (min-width: 1024px)`. Z mnożnikiem tabletu innym niż 1
(`tierScale.tablet`) blok `@media (min-width: 768px) and (max-width:
1023.98px)` przed nim podmienia każde `--cmsb-t-<token>-size` i
`--cmsb-space-<step>` na wartość mobilną razy mnożnik; z mnożnikiem małego
komputera (`tierScale.smallDesktop`) blok `@media (min-width: 1024px) and
(max-width: 1279.98px)` po nim robi to samo z wartościami z komputera. Margines
boczny i kontener nie są skalowane. Bez mnożników żaden z tych bloków nie jest
zapisywany, więc wynik jest bajt w bajt taki sam jak wcześniej. Dwa dalsze
opcjonalne ustawienia rozszerzają te bloki (każde nic nie zapisuje, dopóki nie
jest ustawione):

- `tierScale.fluidDesktop: true`, przy mnożniku małego komputera poniżej 1,
  dodaje blok od końca małego komputera do `tierScale.fluidUntilPx` (inaczej
  `layout.containerMaxPx`), w którym każdy rozmiar tekstu i krok odstępu
  z komputera to `clamp(<wartość × mnożnik>px, <wartość × 100 / koniec>vw,
  <wartość>px)` — mnożnik rośnie z szerokością okna do 1 na końcu;
- `tierScale.buttons: true` zapisuje także `--cmsb-btn-h-s|m|l` w blokach
  tabletu, małego komputera i płynnym, skalowane tak samo.

Zakres małego komputera zawsze kończy się na 1279.98 px, tak jak zakłada
arkusz stylów każdego bloku, a margines boczny i kontener strony są takie same
na każdym progu między telefonem a komputerem. Własne wartości **Własny (px)**
bloku są zapisywane jako dosłowne piksele i nie są skalowane. Klucze zapisane
przez wcześniejszą wersję tego ekranu (`smallDesktopUntilPx`, `blockPx`,
`buttonLabels`, marginesy i kontener na progach, `fluidContainer`,
`breadcrumbsPaddingYPx`, `trackingMobileEm`) znikają przy następnym zapisie
marki, a do tego czasu niczego nie zapisują. Dla każdego poziomu nagłówka `h1`–`h6`, którego
styl typografii jest ustawiony, wynik zawiera też jedną regułę, która nadaje
nagłówkom tego poziomu w tekście sformatowanym (`.cmsc-pb-rich-content`,
`.cmsc-pb-rich`, `.cmsc-pb-hero__body`, `.cmsc-pb-feature-list__body`) rozmiar,
interlinię, grubość i odstęp między literami tego poziomu. Jest zapisana tutaj,
a nie w arkuszu stylów, bo bez marki nagłówki tekstu sformatowanego przyjmują
własne style nagłówków strony, których żadna wartość zapasowa nie odtworzy.
Storefront ustawia też `--cmsb-header-offset`,
wysokość swojego przyklejonego nagłówka, której sekcje z kotwicą używają jako
`scroll-margin-top`.

**Każde użycie ma wartość zastępczą.** `packages/cms-components/styles/cms-components.css`
odczytuje każdą zmienną jako `var(--cmsb-…, <wbudowana wartość>)`, a wbudowane
wartości są równe `DEFAULT_BRAND_TOKENS`. Strona wyświetlona bez
`<style id="cmsb">` — przy wyłączonym module `cms`, nieudanym odczycie albo w
edytorze e-maili, który korzysta z tego samego arkusza stylów — wygląda więc
dokładnie tak jak przed wprowadzeniem ustawień marki. Pilnuje tego test
zgodności wartości zastępczych
(`packages/cms-components/src/brand/fallback-parity.test.tsx`). Autor bloku
pisze tak samo; zob. *Zmienne marki* w przewodniku
[Rozszerzanie Page Buildera](./extending-page-builder.md).

`brandTokensToCss` traktuje zestaw jako niezaufany: kolor inny niż hex, nazwa
rodziny spoza dozwolonych znaków, adres arkusza stylów inny niż `https:` albo
adres tła, którego schemat by nie przyjął, są pomijane (obowiązuje wtedy
wartość zastępcza), adresy zasobów i tła są zapisywane jako escapowane ciągi
CSS, a do wyniku nie może trafić znak `<`.

### Gdy moduł jest wyłączony

Gdy `cms` jest wyłączony, jego trasy marki nie odpowiadają, storefront
wyświetla strony bez `<style id="cmsb">` i obowiązują wartości zastępcze.
Zapisane wiersze pozostają i znów działają po ponownym włączeniu modułu.
