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
`seo` przekierowania wracają.

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
