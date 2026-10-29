---
title: Galeria produktu
---

# Galeria produktu

Każdy produkt może mieć galerię zdjęć i filmów z trzema oznaczeniami, które określają, który obraz
storefront pokazuje w którym miejscu:

- **Base Image** — główny obraz na stronie produktu. Dokładnie jeden na produkt.
- **Small Image** — obraz wyróżniony na pasku miniatur. Dokładnie jeden na produkt.
- **Thumbnail** — obraz na karcie produktu w listach. Dokładnie jeden na produkt.

Każdy element galerii może mieć **od jednego do trzech** z tych oznaczeń (ten sam plik może być np.
jednocześnie Base Image i Thumbnail). Regułę „dokładnie jeden element z danym oznaczeniem w
produkcie” wymusza ograniczenie bazy danych `UNIQUE (product_id, label)`, więc kolizja kończy się
typowanym błędem konfliktu, a nie cichym uszkodzeniem danych.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/products/:id/gallery` | administrator | Galeria produktu |
| `POST /api/v1/admin/catalog/products/:id/gallery` | administrator | Dodanie istniejącego zdjęcia lub filmu z opcjonalnymi oznaczeniami |
| `POST .../gallery?replace=true` | administrator | Atomowa zamiana: zdejmuje kolidujące oznaczenia z innych elementów tego produktu, a potem je przypisuje |
| `PATCH /api/v1/admin/catalog/products/:id/gallery/:itemId` | administrator | Zmiana oznaczeń (ten sam przełącznik `?replace=true`), tekstu alternatywnego w językach i kanałów, w których element jest ukryty |
| `GET /api/v1/admin/catalog/products/:id/gallery/channel-roles` | administrator | Własne przypisania ról w poszczególnych kanałach sprzedaży |
| `PUT /api/v1/admin/catalog/products/:id/gallery/channel-roles` | administrator | Ustawienie lub usunięcie własnych przypisań ról kanału sprzedaży |
| `DELETE /api/v1/admin/catalog/products/:id/gallery/:itemId` | administrator | Usunięcie z galerii (wiersz pliku pozostaje) |
| `PUT /api/v1/admin/catalog/products/:id/gallery/order` | administrator | Zmiana kolejności według listy identyfikatorów |

## Atomowa zamiana oznaczeń

Bez parametru `?replace=true` przypisanie oznaczenia, które ma już inny element, zwraca
`409 GALLERY_LABEL_ALREADY_TAKEN`. Z tym parametrem usługa najpierw usuwa kolidujące przypisania, a
potem wstawia nowe — wszystko w jednej transakcji, więc administratorzy pracujący równocześnie nigdy
nie zobaczą stanu zmienionego do połowy.

## W kanale sprzedaży i w języku

Zestaw zdjęć jest taki sam w każdym kanale sprzedaży: kanał nie może dodać własnego
zdjęcia ani zmienić kolejności galerii. Kanał może zmienić to, który element pełni
daną rolę, i to, które elementy pokazuje. Tekst alternatywny można ustawić osobno dla
każdego języka.

- **Rola w kanale.** `PUT …/gallery/channel-roles` z treścią
  `{ "channelId": "…", "roles": { "baseImage": "<itemId>", "smallImage": null } }`
  nadaje kanałowi własny element pełniący daną rolę. `null` przywraca rolę elementowi
  z ustawień globalnych; rola pominięta w żądaniu pozostaje bez zmian. Klucze to
  `baseImage`, `smallImage` i `thumbnail`. W kanale każdą rolę pełni najwyżej jeden
  element. `GET` zwraca kanały, które mają własne przypisania.
- **Ukrycie w kanale.** `PATCH …/gallery/:itemId` z treścią
  `{ "hiddenInChannels": ["…"] }` zastępuje zbiór kanałów, w których element jest
  ukryty. Ukryty element nie jest pokazywany w tym kanale: ani w galerii na stronie
  produktu, ani jako obraz na karcie produktu w listach, ani jako obraz Open Graph,
  ani w pliku produktowym tego kanału, ani w porównaniu oglądanym w tym kanale. Rola,
  której element jest ukryty w kanale, nie ma tam elementu, więc karta produktu
  bierze następny obraz w swojej kolejności.
- **Tekst alternatywny w języku.** `PATCH …/gallery/:itemId` z treścią
  `{ "altText": { "pl-PL": "…", "de-DE": "" } }` ustawia własny tekst alternatywny
  produktu dla obrazu w każdym podanym języku. Pusty tekst usuwa dany język, a język
  pominięty w żądaniu pozostaje bez zmian. Strona produktu pokazuje tekst w języku
  żądania, a gdy go nie ma — tekst alternatywny samego pliku.

Ukryć element lub nadać mu rolę można tylko w kanale, do którego należy produkt; w
przeciwnym razie żądanie kończy się błędem `422 SCOPE_INVALID`. Usunięcie ustawienia
jest zawsze dozwolone, także po usunięciu produktu z kanału.

Ukrycie dotyczy tylko prezentacji, a nie kontroli dostępu. Ukryty element nie jest
pokazywany w kanale, ale jego plik zachowuje stały adres URL i każdy, kto ten adres zna,
nadal może go pobrać. Ukrycie nie zapewnia poufności obrazu: pliku, który nie może być
publiczny, nie należy umieszczać w galerii produktu.

Każdy taki zapis trafia do dziennika zdarzeń raz, jako `product.media.update`, ze
stanem elementu (lub ról kanału) przed zmianą i po niej. Wysłanie zapisanego stanu
sprzed zmiany tą samą ścieżką przywraca go. Zapis ogłasza zdarzenie
`product.updated.v1` z `changedFields: ["media"]`. Żądanie, które niczego nie zmienia,
niczego nie zapisuje i niczego nie ogłasza.

To samo dotyczy oznaczeń elementu i kolejności galerii. `PATCH`, który zmienia oznaczenia,
zapisuje je (`labels`) w stanie elementu; oznaczenia są zastępowane w tej samej transakcji co
reszta elementu, więc odrzucone oznaczenie pozostawia element bez zmian. Z `?replace=true` wpis
przywraca tylko ten element: oznaczenie zabrane innemu elementowi nie wraca do niego po ponownym
wysłaniu stanu sprzed zmiany. `PUT …/gallery/order` zapisuje `orderedGalleryItemIds` przed zmianą
i po niej i działa w jednej transakcji. Usunięcie elementu trafia do dziennika raz, jako
`gallery_item.delete`.

Bez tych ustawień każdy kanał pokazuje galerię globalną, tak jak dotąd.

## Błędy

| Kod | Status | Kiedy |
| --- | --- | --- |
| `GALLERY_LABEL_ALREADY_TAKEN` | 409 | Kolizja oznaczeń bez `?replace=true` |
| `GALLERY_LABEL_LIMIT_EXCEEDED` | 400 | Więcej niż 3 oznaczenia jednego elementu |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Rodzaj pliku ∉ `{image, video}` |
| `GALLERY_ITEM_NOT_FOUND` | 404 | Brak `:itemId` albo rola kanału wskazuje element innego produktu |
| `SCOPE_INVALID` | 422 | Ukrycie elementu lub nadanie roli w kanale, do którego produkt nie należy |
| `PRODUCT_NOT_FOUND` | 404 | Brak `:id` |

## Storefront

`productDetail.gallery[]` zawiera `{id, position, labels[], asset{id, kind, url}, altText}` w
postaci, w jakiej pokazuje go kanał sprzedaży żądania: bez elementów ukrytych, z rolami kanału w
`labels` i z `altText` w języku żądania. Komponent
`<GallerySwitcher>` wyświetla Base Image jako główny `<img>` (albo pierwszy element, gdy Base Image
nie jest ustawiony) oraz pasek miniatur, w którym Small Image ma atrybut `data-small-image="true"`,
aby motywy mogły go wyróżnić.

## Obraz na karcie produktu w listach

`ProductSummary.primaryAssetUrl` (używane przez kartę produktu w listach) jest wyznaczane po stronie
serwera w kolejności: Thumbnail → Base Image → pierwszy element galerii → dawny wiersz
`product_assets` → null.

## Obraz Open Graph

`productDetail.seo.openGraph.imageUrl` korzysta przede wszystkim z Base Image z galerii, a dopiero
potem z miniatury z listy, aby udostępnienia w serwisach społecznościowych pokazywały obraz wybrany
przez marketing.

## Przechowywanie

`gallery_items` (id, product_id FK CASCADE, asset_id FK RESTRICT, position, znaczniki czasu) i
`gallery_item_labels` (złożony klucz główny (gallery_item_id, label), `UNIQUE (product_id, label)`,
CHECK label IN ('base_image', 'small_image', 'thumbnail')). `gallery_items.alt_text` przechowuje
tekst alternatywny w językach. `gallery_item_channel_labels` przechowuje własny element roli w
kanale (klucz główny (product_id, sales_channel_id, label)), a `gallery_item_channel_hidden` —
element ukryty w kanale (klucz główny (gallery_item_id, sales_channel_id)); oba wiersze są usuwane
razem z produktem, elementem i kanałem.
