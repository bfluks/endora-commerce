---
title: Asystent AI (Prompt Actions)
description: Polecenia w języku naturalnym w palecie poleceń panelu administracyjnego, z jawnym podglądem i potwierdzeniem przed każdą zmianą
---

# Asystent AI (Prompt Actions)

Moduł `prompt_actions` dodaje do palety poleceń panelu administracyjnego (`⌘K` / `Ctrl+K`) tryb
poleceń w języku naturalnym. Operator opisuje, czego chce, po polsku albo po angielsku — platforma
interpretuje polecenie, pokazuje dokładnie, co zamierza zmienić, i wykonuje to dopiero po wyraźnym
potwierdzeniu.

Przykładowe polecenia:

- *Dla produktu „Bolts 0193" zwiększ stan magazynowy w magazynie „Default" na 120 sztuk*
- *Assign every product with "Helmets" in its name to the "Helmets" category*

## Jak to działa (z perspektywy operatora)

1. Otwórz paletę i wybierz **Ask the assistant…** (widoczne tylko wtedy, gdy funkcja jest włączona
   i skonfigurowana, a ty masz uprawnienie *Use the prompt assistant*).
2. Wpisz polecenie i wyślij. Asystent zamienia nazwy („Bolts 0193", „Default”) na konkretne
   rekordy, korzystając wyłącznie z wyszukiwań tylko do odczytu.
3. Pojawia się **karta planu**: dokładne operacje, bieżąca wartość, liczba rekordów, których dotyczy
   zmiana, i próbka przy zmianach masowych. Na tym etapie nic jeszcze nie zostało zmienione.
4. **Confirm** wykonuje plan, **Cancel** niczego nie zmienia. Niepotwierdzone plany wygasają po 10
   minutach.
5. Wynik jest raportowany dla każdej pozycji osobno. Operacje masowe obejmujące ponad 50 rekordów
   działają w tle; jeśli zamkniesz paletę, przy następnym otwarciu zobaczysz powiadomienie, dopóki
   nie obejrzysz wyniku.

Gdy polecenie jest niejednoznaczne, asystent zadaje jedno pytanie doprecyzowujące (z konkretnymi
propozycjami), zamiast zgadywać. Nieobsługiwane prośby i brak uprawnień są zgłaszane wprost — nic
się wtedy nie zmienia.

## Bezpieczeństwo

- Model może wywoływać tylko **wybrany katalog narzędzi** zarejestrowany w kodzie — nie może
  uruchamiać SQL, wywoływać dowolnych endpointów ani wymyślać operacji. Narzędzia, do których
  operator nie ma uprawnień, w ogóle nie są pokazywane modelowi.
- Zmiany **nigdy nie są wykonywane podczas interpretacji**: trafiają do planu, a każda operacja z
  planu w chwili wykonania ponownie sprawdza bieżące uprawnienia operatora.
- Wszystko na karcie planu **oblicza serwer** (nazwy, liczby, bieżące wartości). Tekst wygenerowany
  przez model nigdy nie jest wyświetlany, a wyniki narzędzi są traktowane wyłącznie jako dane —
  produkt nazwany jak polecenie nie może zmienić zachowania asystenta.
- Każde wykonanie zapisuje wpisy audytu: podsumowanie `prompt_action.execute` (z oryginalnym
  poleceniem, dostawcą i modelem) oraz własne wpisy audytu modułów, które wykonały zmianę (np.
  `stock_level.adjust`). Odmowy z powodu uprawnień audytuje `prompt_action.refused`. Wykonania
  pojawiają się też na karcie Recent Activity na pulpicie.

## Konfiguracja (administrator platformy)

Ustawienia → grupa **Prompt actions (AI assistant)**:

| Ustawienie | Wartość domyślna | Znaczenie |
|---------|---------|---------|
| `prompt_actions.activation` | `true` | Przełącznik modułu. Gdy wyłączony, całego modułu nie ma: API poleceń, podglądu planu i ścieżki wykonania oraz narzędzi, które wnoszą do niego inne moduły. |
| `prompt_actions.enabled` | `false` | Własny przełącznik asystenta. Gdy wyłączony, moduł pozostaje obecny, a paleta działa tak, jakby go nie było. |
| `prompt_actions.llm_credentials` | *(nieustawione)* | Odwołanie do konfiguracji danych uwierzytelniających typu `llm`, utworzonej na ekranie **Poświadczenia** (*Credentials*). Ta konfiguracja jest jedynym źródłem dostawcy, identyfikatora modelu i klucza API; sama grupa ustawień nie przechowuje żadnego klucza. |
| `prompt_actions.bulk_limit` | `500` | Największa liczba rekordów, które może zmienić jedno polecenie; większe plany są blokowane już na etapie podglądu. |

Aby skonfigurować asystenta, utwórz na ekranie Poświadczenia konfigurację danych uwierzytelniających
typu **LLM** — dostawca `anthropic` (Claude), `google` (Gemini), `openai` (GPT), `deepseek`
(DeepSeek) albo `openai_compatible` (dowolny punkt końcowy zgodny z protokołem chat completions
OpenAI, z jego **Base URL**), identyfikator modelu i klucz API — a następnie wybierz ją w ustawieniu
`prompt_actions.llm_credentials` i włącz `prompt_actions.enabled`. Konfiguracja OpenAI lub DeepSeek
może też mieć Base URL, który zastępuje wtedy publiczny adres dostawcy (serwer pośredniczący lub
bramka); dla Anthropic i Google Base URL jest pomijany. Klucz API jest sekretem tylko do zapisu:
szyfrowany w bazie i nigdy nie zwracany po zapisaniu. Odwołanie, które nie prowadzi do użytecznej
konfiguracji — nieznany dostawca albo konfiguracja zgodna z OpenAI bez poprawnego Base URL —
pozostawia asystenta nieskonfigurowanego.

Pozycja **Ask the assistant…** jest dostępna tylko wtedy, gdy spełnione są wszystkie trzy warunki:
asystent jest włączony, odwołanie wskazuje obsługiwanego dostawcę z modelem i kluczem, a Ty masz
uprawnienie opisane niżej. Gdy któryś z nich nie jest spełniony, paleta nie pokazuje wiersza
asystenta ani żadnego wyjaśnienia.

Zmiany konfiguracji obowiązują bez restartu i bez przeładowania strony panelu: backend odczytuje
ustawienia przy każdym poleceniu, a paleta pyta o dostępność asystenta przy każdym otwarciu. Aby
zapisać klucz API, backend potrzebuje w środowisku zmiennej `SETTINGS_SECRET_ENCRYPTION_KEY`
(zobacz główny README, sekcja *Environment variables*).

Przyznaj operatorom uprawnienie **Use the prompt assistant** (`prompt_actions:use`) na ekranie ról.
Każda zaplanowana operacja wymaga dodatkowo tego samego uprawnienia co odpowiadająca jej czynność
ręczna (np. `catalog:write` przy zmianie stanu magazynowego), więc asystent nigdy nie zrobi więcej,
niż operator mógłby zrobić ręcznie.

## Rozszerzanie katalogu (dla autorów modułów)

Moduły dodają narzędzia podczas kompozycji przez port `PromptActionToolRegistry` — ten sam wzorzec
rejestru adapterów co przy dostawcach płatności i wysyłki. Narzędzie deklaruje:

```ts
{
  id: '<moduleId>.<snake_case_name>',   // e.g. 'inventory.set_stock_level'
  moduleId: 'inventory',
  kind: 'resolver' | 'mutation',
  description: '…',                      // English; the LLM's only documentation
  requiredPermission: 'catalog:write',   // MUST mirror the manual route's permission
  paramsSchema: zodSchema,               // validates LLM args + becomes the JSON Schema
  execute(params, ctx) { … },            // resolvers run during interpretation;
                                         // mutations only at confirm time
  preview(params, ctx) { … },            // mutations only — server-computed facts
}
```

Reguły (egzekwowane przy rejestracji, tam gdzie to możliwe): identyfikator z kropką i przedrostkiem
modułu-właściciela; narzędzia wyszukujące nie mają skutków ubocznych i ograniczają liczbę wyników
(≤ 20); narzędzia zmieniające dane muszą implementować `preview()` z rzetelnymi liczbami i próbkami
obliczonymi przez serwer; narzędzia wyłączonych modułów automatycznie znikają z katalogu.

## Katalog narzędzi w wersji 1

| Narzędzie | Rodzaj | Uprawnienie |
|------|------|------------|
| `catalog.search_products` | wyszukiwanie | `catalog:read` |
| `catalog.search_categories` | wyszukiwanie | `catalog:read` |
| `inventory.search_warehouses` | wyszukiwanie | `catalog:read` |
| `inventory.set_stock_level` | zmiana | `catalog:write` |
| `catalog.assign_products_to_category` | zmiana | `catalog:write` |
| `catalog.remove_products_from_category` | zmiana | `catalog:write` |
| `catalog.set_product_status` | zmiana | `catalog:write` |
| `catalog.set_products_visibility` | zmiana | `catalog:write` |
| `catalog.archive_product` | zmiana | `catalog:write` |
| `catalog.restore_product` | zmiana | `catalog:write` |

Masowe przypisania do kategorii obejmujące ponad 50 produktów trafiają do istniejącej kolejki
`catalog.bulk-operation` (ten sam worker co ekran masowej edycji), więc duże polecenia nigdy nie
blokują procesu API.

**Archiwizacja to nie status.** `catalog.set_product_status` włącza (`active`) lub wyłącza
(`inactive`) produkty i nigdy ich nie archiwizuje ani nie przywraca. Aby zarchiwizować lub
przywrócić produkt, poproś o to asystenta: `catalog.archive_product` i `catalog.restore_product`
uruchamiają akcje Archiwizuj i Przywróć modułu Catalog — z tym samym wpisem audytu
(`product.archive` / `product.restore`), a jako wykonawcę zapisują administratora, który
zatwierdził plan; powyżej 50 produktów działają jako zbiorcze Archiwizuj / Przywróć w tej samej
kolejce, z możliwością cofnięcia na stronie operacji zbiorczej. Podgląd planu mówi, że produkt
zarchiwizowany przywraca tylko Przywróć. `catalog.search_products` obejmuje produkty
zarchiwizowane i zwraca `archived` obok `status`, więc zarchiwizowany produkt da się znaleźć, by
go przywrócić. Oba narzędzia są dostępne tylko tam, gdzie podłączona jest szyna poleceń modułu
Catalog.
