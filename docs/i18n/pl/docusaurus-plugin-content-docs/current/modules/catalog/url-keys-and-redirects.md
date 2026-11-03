---
title: Klucze URL i przekierowania
---

# Klucze URL i przekierowania

Adres produktu w sklepie to `/p/<klucz>`. Klucz może być inny w każdym języku, a także w każdym
kanale sprzedaży i języku:

- **klucz globalny** — `slug` produktu; jest kluczem w każdym języku, w którym produkt nie ma
  własnego klucza;
- **klucz języka** — jeden na język, we wszystkich kanałach sprzedaży;
- **klucz kanału sprzedaży × języka** — jeden na kanał i język, zastępuje tam klucz języka.

**Klucz obowiązujący** w danym kanale sprzedaży i języku to klucz kanału × języka, w przeciwnym razie
klucz języka, a w ostatniej kolejności klucz globalny. Każdy adres produktu generowany przez
platformę — kanoniczny adres i linki do wersji językowych w sklepie, mapa witryny, cel
przekierowania, adres podglądu w panelu administracyjnym — używa klucza obowiązującego, z
`?lang=<język>`, gdy język nie jest domyślnym językiem kanału.

Klucz obowiązuje tylko w swoim języku i jest unikalny w obrębie języka we wszystkich kanałach
sprzedaży: żadne dwa produkty nie mają tego samego klucza w jednym języku. Zmiana klucza zachowuje
poprzedni jako stałe przekierowanie w jego języku, prosto do bieżącego klucza; przekierowania są
przechowywane, dopóki operator ich nie usunie. Przekierowania działają, gdy moduł `seo` jest
włączony; przy wyłączonym `seo` stary klucz odpowiada „nie znaleziono”, a po ponownym włączeniu
`seo` przekierowania wracają. Pozostałe **bieżące** klucze produktu nie są przekierowaniami: także
przy wyłączonym `seo` żądanie jego klucza językowego lub globalnego, gdy nadpisuje go klucz pary
kanał × język, albo klucza innego kanału nadal prowadzi do jego adresu w danym kanale.

## Zarządzanie kluczami

W edytorze produktu panel **URL keys** na zakładce SEO pokazuje klucz globalny, klucz w każdym
języku i klucz w każdym kanale sprzedaży i języku — puste pole oznacza klucz dziedziczony — oraz
adres w sklepie, który z nich wynika w każdym kanale i języku. Gdy moduł `seo` jest włączony, panel
wymienia też przekierowania zachowane przez stare klucze.

`GET /api/v1/admin/catalog/products/:id/url-keys` (`catalog:read`) zwraca te same dane, a `PUT` na
tej samej ścieżce (`catalog:write`) je zapisuje:

```json
{
  "globalKey": "cordless-drill",
  "languageKeys": [{ "languageCode": "de-DE", "key": "akku-bohrschrauber" }],
  "channelKeys": [{ "channelId": "<retail-uuid>", "languageCode": "pl-PL", "key": null }]
}
```

Pominięta lista lub klucz pozostają bez zmian; `key: null` usuwa klucz w danym zakresie, więc
znowu obowiązuje tam klucz dziedziczony. Klucz składa się z małych liter, cyfr i łączników i ma
najwyżej 160 znaków. Klucz dla kanału, do którego produkt nie należy, albo dla języka, którego kanał
nie oferuje, jest odrzucany z kodem `422 SCOPE_INVALID`; klucz pozostawiony przez kanał, z którego
produkt został usunięty, jest oznaczony jako **Nie obowiązuje już** i można go usunąć.

- **Klucz, który ma inny produkt** w tym języku, jest odrzucany z kodem `409 URL_KEY_TAKEN`, a
  odpowiedź wskazuje ten produkt (`details.conflicts`). Klucz globalny usuniętego produktu pozostaje
  zajęty; jego klucze języków i kanałów są zwalniane.
- **Klucz, który jest przekierowaniem innego produktu**, daje odpowiedź
  `409 URL_KEY_REDIRECT_TAKEOVER_REQUIRED` wskazującą produkt, który straciłby to przekierowanie
  (`details.takeovers`). Ponowne wysłanie tego samego żądania z kluczem w `confirmTakeover` przejmuje
  go. Może to zrobić tylko operator; integracja nigdy nie przejmuje przekierowania.
- **Zmieniony klucz zostaje przekierowaniem** w swoim języku, wskazującym produkt, a nie klucz,
  więc przekierowania nigdy nie tworzą łańcuchów. Przekierowanie istnieje, dopóki operator go nie
  usunie: `DELETE /api/v1/admin/catalog/products/:id/url-redirects/:redirectId` (`catalog:write`).
  Usunięcie produktu usuwa jego przekierowania. Gdy `seo` jest wyłączony, odpowiedź pomija
  `redirects`, ale wiersze pozostają i nadal rezerwują swoje klucze.

`PUT` to jedno polecenie zapisywane w dzienniku zdarzeń, `product.url_keys.update`; wysłanie
zapisanego stanu sprzed zmiany tą samą ścieżką przywraca klucze. Usunięcie przekierowania to
`product.url_redirect.delete`. Oba ogłaszają `product.updated.v1` z `changedFields: ["urlKeys"]`.
Klucz globalny nowego lub zduplikowanego produktu jest wybierany tak, aby nie pokrywał się z żadnym
kluczem języka, kanału ani przekierowania istniejących produktów.

## W sklepie

`GET /api/v1/catalog/products/resolve/:key` rozpoznaje klucz w kanale sprzedaży i języku żądania:

- klucz obowiązujący produktu w tym miejscu daje odpowiedź `{ kind: "product", productId, key }`;
- każdy inny bieżący klucz produktu w tym języku oraz jego przekierowania w tym języku (dawny klucz
  globalny obowiązuje w każdym języku) dają odpowiedź `{ kind: "redirect", key, languageCode, path }`,
  gdzie `path` to adres produktu, pod który należy przekierować na stałe;
- klucz żadnego produktu, klucz innego języka i produkt, który nie jest tam dostępny dla
  wywołującego, dają tę samą odpowiedź `404 PRODUCT_NOT_FOUND`; produkt zarchiwizowany daje
  `410 PRODUCT_ARCHIVED`.

`GET /api/v1/catalog/products/:idOrSlug` przyjmuje identyfikator, bieżący klucz w języku żądania
albo klucz globalny produktu — nigdy przekierowanie. Szczegóły produktu zawierają
`paths: { canonical, alternates }`: adres strony w kanale i języku żądania oraz po jednym adresie dla
każdego języka kanału, w którym produkt jest dostępny dla anonimowych odwiedzających. `slug` na
liście produktów, w szczegółach produktu, w produktach składowych zestawu grupowego i pakietu oraz w
kafelkach powiązanych produktów to klucz obowiązujący w kanale i języku żądania.

## Błędy

| Kod | Status | Kiedy |
| --- | --- | --- |
| `URL_KEY_TAKEN` | 409 | Klucz jest kluczem innego produktu w tym języku |
| `URL_KEY_REDIRECT_TAKEOVER_REQUIRED` | 409 | Klucz jest przekierowaniem innego produktu, a zapis nie potwierdził przejęcia |
| `URL_REDIRECT_NOT_FOUND` | 404 | `:redirectId` nie jest przekierowaniem tego produktu |
| `SCOPE_INVALID` | 422 | Klucz dla kanału, do którego produkt nie należy, albo dla języka, którego kanał nie oferuje |
| `PRODUCT_NOT_FOUND` | 404 | Rozpoznanie klucza w sklepie nie znalazło produktu dostępnego dla wywołującego |
| `PRODUCT_ARCHIVED` | 410 | Rozpoznanie klucza w sklepie znalazło produkt zarchiwizowany |

## Integracje

Co zapisuje konektor, synchronizacja z PIM albo arkusz kalkulacyjny i w jakim zakresie. Integracja
zapisuje tylko zakresy, które wskazuje: zapis wartości globalnej nigdy nie usuwa nadpisania operatora
w kanale sprzedaży ani w języku (FR-091).

| Pole | Zakres zapisu | Przez |
| --- | --- | --- |
| Status | kanał sprzedaży albo kanał sprzedaży × język | `catalogProductScopeWritePort.applyScopes` `status`; kolumny CSV produktów `status@<kod kanału>` i `status@<kod kanału>/<język>` |
| Status globalny, widoczność, nazwa, opis | globalny (nazwa i opis per język) | `catalogProductWritePort`; kolumny CSV produktów `status`, `visibility`, `name_en`, `description_en` |
| Okno publikacji | globalny albo kanał sprzedaży | `applyScopes` `window` (`channelId: null` to okno globalne) |
| Grupa odbiorców (widoczność i organizacje) | kanał sprzedaży | `applyScopes` `audience` |
| Minimalna ilość zamówienia, możliwość zwrotu | kanał sprzedaży | `applyScopes` `orderRules` |
| Klucz URL | język albo kanał sprzedaży × język | `applyScopes` `urlKeys` (`channelId: null` to klucz języka) |
| Wartości atrybutów zależne od kanału lub języka | kanał sprzedaży, język albo oba | `catalogProductValueOverrideWritePort` |
| Tytuł i opis SEO | język | `seoMetaWritePort` — nadpisania SEO dla kanałów sprzedaży ustawia operator |

Wartość `null` oznacza „użyj wartości dziedziczonej”: nadpisanie w tym zakresie zostaje usunięte.
Pole, którego dane wejściowe nie wskazują, pozostaje bez zmian.

**Klucze URL z integracji nigdy nie są wymuszane.** Klucz, który jest kluczem innego produktu w tym
języku albo przekierowaniem innego produktu, nie zostaje zapisany: produkt zachowuje dotychczasowy
klucz w tym zakresie, a wywołanie zwraca dla każdego klucza `{ written: false, issue: { languageCode,
channelId, key, heldByProductId, kind } }` — `kind` to `current` albo `redirect`. Integracja nigdy nie
przejmuje przekierowania innego produktu i nigdy nie jest proszona o potwierdzenie; może to zrobić
tylko operator, w edytorze produktu (FR-093). Klucz dla kanału sprzedaży, do którego produkt nie
należy, albo dla języka, którego kanał nie oferuje, powoduje odrzucenie całego wywołania.

**Nie jest wykonywane sprawdzenie kompletności** przy zapisie z integracji; ostrzeżenia operatora o
brakujących nazwach i kluczach w zakresie to funkcja edytora.

**CSV produktów można wyeksportować i zaimportować bez zmian.** Eksport zawiera jedną kolumnę
`status@<kod kanału>` na kanał sprzedaży i jedną kolumnę `status@<kod kanału>/<język>` na język
kanału — nadpisanie w tym zakresie, puste tam, gdzie zakres dziedziczy wartość. Import
wyeksportowanego pliku bez zmian niczego nie zmienia; zmieniona komórka zapisuje swój zakres, a
wyczyszczona usuwa nadpisanie. Plik bez tych kolumn pozostawia wszystkie zakresy bez zmian. Jedna
niepoprawna komórka — nieznany kod kanału, wartość dla kanału, do którego produkt nie należy, albo
dla języka, którego kanał nie oferuje, wartość, która nie jest statusem — powoduje odrzucenie całego
pliku, tak jak każdy inny niepoprawny wiersz.

Każdy zapis trafia do dziennika zdarzeń i jest ogłaszany zdarzeniem `product.updated.v1`, którego
`changedFields` wskazuje, co się zmieniło (`scopedStatus`, `publicationWindow`, `audience`,
`orderRules`, `urlKeys`).
