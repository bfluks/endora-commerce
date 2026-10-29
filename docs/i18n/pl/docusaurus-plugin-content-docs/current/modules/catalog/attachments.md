---
title: Załączniki produktu
---

# Załączniki produktu

Załączniki produktu to pliki do pobrania (certyfikaty, specyfikacje techniczne, karty produktu,
inne pliki PDF) przypisane do produktu. Odwołują się do wiersza `Asset`, więc ten sam plik można
powiązać z wieloma produktami bez powielania — wiersz `assets` pozostaje nawet po usunięciu
załącznika.

## Typy załączników

Słownik `attachment_types` dzieli załączniki na kategorie. Migracja `20260429T112543_catalog_product_attachments.ts` tworzy cztery standardowe
wiersze o stałych UUID, aby dane początkowe i testy mogły się do nich niezmiennie odwoływać:

- `certificate` — Certificate / Certyfikat
- `tech_spec` — Technical specification / Specyfikacja techniczna
- `product_card` — Product card / Karta produktu
- `pdf` — dowolny plik PDF

Administratorzy mogą dodawać własne typy na stronie **Attachment Types** w panelu
administracyjnym. Usunięcie typu, którego nadal używa jakiś produkt, zwraca
`409 ATTACHMENT_TYPE_IN_USE`.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/attachment-types` | administrator | Lista typów z liczbą użyć |
| `POST /api/v1/admin/catalog/attachment-types` | administrator | Utworzenie własnego typu |
| `PATCH /api/v1/admin/catalog/attachment-types/:id` | administrator | Zmiana nazwy lub pozycji |
| `DELETE /api/v1/admin/catalog/attachment-types/:id` | administrator | Usunięcie; odrzucane, gdy typ jest używany |
| `GET /api/v1/admin/catalog/products/:id/attachments` | administrator | Lista załączników produktu |
| `POST /api/v1/admin/catalog/products/:id/attachments` | administrator | Dołączenie istniejącego pliku, opcjonalnie z nazwami i opisami w językach oraz kanałami, w których jest ukryty |
| `PATCH /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | administrator | Zmiana nazwy, opisu, typu lub pozycji, nazw i opisów w językach oraz kanałów, w których załącznik jest ukryty |
| `DELETE /api/v1/admin/catalog/products/:id/attachments/:attachmentId` | administrator | Usunięcie (plik pozostaje) |

## W kanale sprzedaży i w języku

Załącznik to ten sam plik w każdym kanale sprzedaży. Różnić się mogą jego nazwa i opis w
poszczególnych językach oraz to, czy kanał w ogóle go pokazuje.

- **Nazwa i opis w języku.** `nameTranslations` i `descriptionTranslations` przypisują tekst do
  języka, np. `{ "pl-PL": "Karta techniczna", "de-DE": "" }`. Podany język jest ustawiany, pusty
  tekst go usuwa, a język pominięty w żądaniu pozostaje bez zmian. Nazwa ma najwyżej 160 znaków,
  opis najwyżej 4000. Strona produktu pokazuje tekst w języku żądania, a gdy go nie ma — globalną
  nazwę i globalny opis załącznika.
- **Ukrycie w kanale.** `hiddenInChannels` to lista identyfikatorów kanałów sprzedaży; zastępuje
  zbiór kanałów, w których załącznik jest ukryty. Ukryty załącznik nie jest w tym kanale ani
  wymieniany na stronie produktu, ani z niej linkowany.

Ukryć załącznik można tylko w kanale, do którego należy produkt; w przeciwnym razie żądanie kończy
się błędem `422 SCOPE_INVALID`. Usunięcie kanału ze zbioru jest zawsze dozwolone, także po usunięciu
produktu z kanału.

Ukrycie dotyczy tylko prezentacji, a nie kontroli dostępu. Ukryty załącznik nie jest pokazywany w
kanale, ale jego plik zachowuje stały adres URL i każdy, kto ten adres zna, nadal może go pobrać.
Ukrycie nie zapewnia poufności dokumentu: pliku, który nie może być publiczny, nie należy dołączać
do produktu.

Utworzenie lub zmiana załącznika trafia do dziennika zdarzeń raz, jako `product_attachment.create`
albo `product_attachment.update`, ze stanem załącznika przed zmianą i po niej: produktem, typem,
nazwą, opisem, pozycją, obiema mapami tłumaczeń i `hiddenInChannels`. Wysłanie zapisanego stanu
sprzed zmiany (bez `productId`) tą samą ścieżką przywraca go. Zapis ogłasza zdarzenie
`product.updated.v1` z `changedFields: ["attachments"]`. Żądanie, które niczego nie zmienia, niczego
nie zapisuje i niczego nie ogłasza.

Bez tych ustawień każdy kanał pokazuje wszystkie załączniki pod ich globalnymi nazwami, tak jak
dotąd.

## Błędy

| Kod | Status | Kiedy |
| --- | --- | --- |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Plik załącznika musi być rodzaju `pdf`, `certificate` lub `other` (zdjęcia i filmy tylko w galerii) |
| `ATTACHMENT_TYPE_IN_USE` | 409 | Usunięcie zablokowane, bo typ jest używany |
| `ATTACHMENT_TYPE_CODE_TAKEN` | 409 | Kolizja `code` przy tworzeniu |
| `ATTACHMENT_TYPE_NOT_FOUND` | 404 | Brak `:id` |
| `ATTACHMENT_NOT_FOUND` | 404 | Brak `:attachmentId` |
| `SCOPE_INVALID` | 422 | Ukrycie załącznika w kanale, do którego produkt nie należy |

## Storefront

`productDetail.attachments[]` zawiera pełne metadane typu i pliku (filename, sizeBytes, mimeType,
url) w postaci, w jakiej pokazuje je kanał sprzedaży żądania: bez załączników ukrytych w tym kanale,
z nazwą i opisem w języku żądania. Komponent `<AttachmentsList>` grupuje załączniki według typu (w kolejności pierwszego
wystąpienia, aby pozycje ustawione przez administratora decydowały o kolejności sekcji), wyświetla
jeden nagłówek dla każdego typu i tworzy linki do pobrania z `download={filename}`, aby pobrane pliki
miały czytelne nazwy.

## Przechowywanie

`attachment_types` (id, code unique, name jsonb, position) +
`product_attachments` (id, product_id FK CASCADE, asset_id FK RESTRICT,
attachment_type_id FK RESTRICT, name, description, position,
name_translations, description_translations).
`product_attachment_channel_hidden` (attachment_id, sales_channel_id,
product_id) przechowuje załącznik ukryty w kanale; wiersz jest usuwany razem z załącznikiem,
produktem i kanałem.

Podstawa platformy nie ma publicznego `AssetsService` — katalog importuje encję `Asset` bezpośrednio
z innego modułu. Przesyłanie plików w panelu administracyjnym to zmiana planowana na poziomie podstawy
platformy; do tego czasu administratorzy przy tworzeniu załącznika wklejają identyfikator
istniejącego pliku.
