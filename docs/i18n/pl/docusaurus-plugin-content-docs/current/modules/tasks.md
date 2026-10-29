---
title: tasks
description: Zadania przypisane administratorom, z terminem i statusem, które inne moduły mogą przejmować przez kontekst zadania
---

# `tasks`

Moduł Zadania przechowuje **zadania**: pracę do wykonania przez administratora,
z tytułem, opisem, osobą przypisaną, terminem i statusem. To celowo mała,
pierwsza wersja — podstawa, na której budują inne moduły.

## Co robi

Każde zadanie ma numer, np. `TSK-000042`, nadawany przy utworzeniu i nigdy
nieużywany ponownie. Status to jeden z czterech, a po każdym może nastąpić
każdy inny:

| Status | Znaczenie |
| --- | --- |
| `todo` | Nierozpoczęte — od tego statusu zaczyna się każde nowe zadanie. |
| `in_progress` | W toku. |
| `done` | Zakończone. Moment zakończenia jest zapisywany i czyszczony, gdy zadanie opuści `done`. |
| `cancelled` | Nie zostanie wykonane. |

Zadanie, którego termin minął, a które wciąż ma status `todo` lub
`in_progress`, jest **przeterminowane**.

Zadanie może istnieć samodzielnie albo należeć do rekordu, którego właścicielem
jest inny moduł — na przykład do projektu. Ten rekord to **kontekst** zadania.
Zadanie bez kontekstu widzi każdy, kto może przeglądać zadania. Zadanie z
kontekstem widzą tylko osoby, którym moduł będący właścicielem kontekstu
pozwala zobaczyć ten rekord: kto nie widzi projektu, nie widzi też nigdzie jego
zadań — ani na liście, ani pod ich adresem. Dla takiej osoby to zadanie nie
istnieje.

Gdy moduł będący właścicielem kontekstu zostanie wyłączony, zadania tego
kontekstu znikają z modułu Zadania do czasu jego ponownego włączenia; nic nie
jest usuwane.

## W panelu administracyjnym

Zadania są w menu bocznym w sekcji **Projekty i zadania**, dla administratorów,
którzy mogą przeglądać zadania: **Moje zadania** (`/tasks/mine`) i **Zadania**
(`/tasks`).

**Lista** pokazuje każde zadanie, które możesz zobaczyć: numer, tytuł, status,
termin — oznaczony *Po terminie*, gdy minie, a zadanie jest wciąż otwarte —
osobę przypisaną i rekord, do którego zadanie należy. Rekord jest
odnośnikiem, dopóki jest dla ciebie dostępny; rekord, którego nie możesz już
zobaczyć albo którego moduł jest wyłączony, jest nazwany *Niedostępny rekord*,
bez odnośnika. Listę można zawęzić według statusu, osoby przypisanej —
ciebie albo nikogo — albo do zadań po terminie, i przeszukać po numerze lub
tytule. Przechodzi się po niej stronami do przodu i do tyłu, po pięćdziesiąt
zadań.

**Moje zadania** wymienia twoje otwarte zadania, najpierw te z najbliższym
terminem, na końcu te bez terminu, z oznaczeniem zadań po terminie.

**Nowe zadanie** (`/tasks/new`) wymaga tytułu, a opcjonalnie opisu, terminu i
osoby przypisanej — wybieranej po nazwisku spośród aktywnych
administratorów albo przyciskiem *Przypisz do mnie*. Zadanie utworzone tutaj nie
należy do żadnego rekordu: zadanie projektu dodaje się na karcie *Zadania*
projektu, do jednego z jego etapów.

**Ekran zadania** pokazuje tytuł, numer i status, a dalej:

- **Szczegóły** — status, zmieniany od razu z listy; opis, termin i osobę
  przypisaną, zmieniane przyciskiem *Edytuj* i zapisywane razem; *Przypisz
  do mnie*; kto i kiedy utworzył zadanie oraz kiedy zostało zrobione. *Usuń
  zadanie* pyta przed usunięciem; nie jest oferowane dla zadania rekordu, którego
  nie możesz zmieniać — projektu, którego nie możesz edytować — a ekran mówi
  dlaczego.
- **Należy do** — rekord, do którego należy zadanie, tak jak nazywa go jego
  moduł: dla zadania projektu numer i tytuł projektu jako odnośnik oraz etap.
  Pokazana jest tu też notatka, którą moduł rekordu zapisał przy tworzeniu
  zadania, np. odpowiedzialna rola.
- **Historia** — każda zmiana, od najnowszych, z tym, kto ją wprowadził i kiedy.

Inne moduły mogą dodawać panele na końcu ekranu zadania. Bez uprawnienia do
tworzenia i zmieniania zadań ekran jest tylko do odczytu.

**Paleta poleceń** (⌘K / Ctrl+K) proponuje pozycje *Zadania*, *Moje zadania* i
*Nowe zadanie* — każdą administratorom z uprawnieniem, którego wymaga jej
ekran. **Wyszukiwanie globalne** panelu administracyjnego znajduje zadanie po
numerze lub tytule — wyłącznie wśród zadań, które możesz zobaczyć.

## Praca z zadaniami

**Tworzenie zadania.** Zadanie potrzebuje tylko tytułu; może mieć też opis,
osobę przypisaną — dowolnego aktywnego administratora — i termin. Dostaje
numer, zaczyna ze statusem `todo` i zapamiętuje, kto je utworzył. Można je
umieścić w rekordzie innego modułu — w tym wydaniu w etapie projektu, który
tworzący może zobaczyć i edytować; zadanie projektu zawsze należy do jednego z
jego etapów.

**Zmiana zadania.** Można zmienić jego tytuł, opis, termin, osobę przypisaną,
status i rekord, do którego należy. Po każdym statusie może nastąpić każdy
inny: przejście do `done` zapisuje, kiedy zadanie wykonano, a wyjście z `done`
ponownie to czyści.

**Przypisywanie.** Gdy zadanie zostaje przypisane komuś innemu niż osoba,
która je przypisuje — przy tworzeniu albo później — ta osoba dostaje
powiadomienie w dzwonku panelu administracyjnego, tylko z numerem zadania i
odnośnikiem do niego. Przypisanie zadania sobie albo usunięcie przypisania
nikogo nie powiadamia. Nikt też nie dostaje powiadomienia o zadaniu, którego nie
może zobaczyć: o zadaniu projektu dowiaduje się tylko ktoś, kto może zobaczyć
ten projekt. Gdy moduł **Powiadomienia administratora** jest wyłączony,
przypisywanie działa tak samo, a nikt nie dostaje powiadomienia.

**Moje zadania** to twoja otwarta praca: zadania przypisane tobie, które nie
mają statusu `done` ani `cancelled`, najpierw te z najbliższym terminem, na
końcu te bez terminu, z oznaczeniem przeterminowanych.

**Usunięcie zadania** usuwa je na stałe.

Dodanie zadania do rekordu, wyjęcie go z niego — do żadnego rekordu albo do
innego — i usunięcie zadania rekordu to zmiany w pracy tego rekordu, więc o
tym, kto może je wprowadzać, decyduje moduł rekordu: w przypadku projektu
osoba, która może edytować projekt. Przeniesienie zadania między etapami
jednego projektu i każda inna zmiana zadania wymagają tylko uprawnienia do
zmieniania zadań.

**Historia.** Każda zmiana zadania — utworzenie, zmiana, przypisanie, zmiana
statusu, usunięcie — jest zapisywana z tym, kto ją wykonał i kiedy, a historia
zadania wymienia je od najnowszych. Historia zapisuje długość opisu, nigdy jego
treść. Projekt, który zadanie opuściło, a którego nie możesz zobaczyć, nie jest
w niej wymieniany.

## Włączanie i wyłączanie

Zadania to moduł opcjonalny. Jest domyślnie włączony, a operator wyłącza go i
włącza ponownie na ekranie **Moduły** panelu administracyjnego
(`/platform/modules`).

Gdy moduł jest wyłączony:

- pozycje *Moje zadania* i *Zadania* oraz wszystkie ekrany zadań znikają z
  panelu administracyjnego, a wraz z nimi karta *Zadania* projektu i jego
  zadania etapów, pozycje palety poleceń i zadania w wyszukiwaniu globalnym;
- każdy endpoint `/api/v1/admin/tasks…` odpowiada `503` z kodem
  `MODULE_DISABLED`;
- jego uprawnień nie można już nadać żadnej roli;
- inne moduły nie mogą ani odczytywać, ani tworzyć zadań: moduł, który pokazuje
  zadania na swoich ekranach, oznacza je jako niedostępne.

Nic nie jest usuwane. Każde zadanie zostaje w bazie danych, a po ponownym
włączeniu modułu wszystko wraca dokładnie do poprzedniego stanu.

## Uprawnienia

| Kod | Na co pozwala |
| --- | --- |
| `tasks:read` | Przeglądanie zadań — listy, *Moich zadań*, pojedynczego zadania i jego historii — z zastrzeżeniem widoczności kontekstu każdego zadania. |
| `tasks:write` | Tworzenie, zmienianie, przypisywanie i usuwanie zadań. Wymaga `tasks:read`. |

## Dla programistów

### API

| Metoda i ścieżka | Uprawnienie | Odpowiedź |
| --- | --- | --- |
| `GET /api/v1/admin/tasks` | `tasks:read` | Strona zadań, od najnowszych: `{ items, nextCursor }`. Filtry: `status` (powtarzalny), `assignee` (identyfikator administratora, `me` albo `none`), `dueFrom`, `dueTo`, `overdue`, `contextType`, `contextId`, `q` (numer lub tytuł), `cursor`, `limit` (najwyżej 100). |
| `GET /api/v1/admin/tasks/mine` | `tasks:read` | `{ data: TaskSummary[] }` — otwarte zadania wywołującego, według terminu, bez terminu na końcu (najwyżej 500). |
| `POST /api/v1/admin/tasks` | `tasks:write` | `{ title, description?, assignedAdminUserId?, dueOn?, context? }` → `201` `{ data: TaskDetail }`; `422` `TASK_CONTEXT_INVALID` (także dla rekordu, do którego jego właściciel nie pozwala dodawać, `canChangeTasks`), `TASK_ASSIGNEE_INVALID`. |
| `GET /api/v1/admin/tasks/:id` | `tasks:read` | `{ data: TaskDetail }` albo `404` `TASK_NOT_FOUND` — tak samo dla zadania, które nie istnieje, i dla zadania, którego kontekstu nie możesz zobaczyć. `context.canChangeTasks` to odpowiedź właściciela rekordu dla ciebie (`false` dla niedostępnego rekordu): czy możesz usunąć zadanie albo wyjąć je z rekordu. |
| `PATCH /api/v1/admin/tasks/:id` | `tasks:write` | Dowolne z pól `title`, `description`, `dueOn`, `assignedAdminUserId`, `status`, `context` → `{ data: TaskDetail }`; `422` `TASK_CONTEXT_INVALID` przy umieszczaniu zadania w rekordzie albo wyjmowaniu go z rekordu, na które jego właściciel nie pozwala (`canChangeTasks`). |
| `DELETE /api/v1/admin/tasks/:id` | `tasks:write` | `204`; `403` `FORBIDDEN` dla zadania rekordu, którego właściciel nie pozwala go usunąć (`canChangeTasks`). |
| `GET /api/v1/admin/tasks/lookups/assignees` | `tasks:write` | `{ data: { id, name, email }[] }` — aktywni administratorzy pasujący do `q` (imię i nazwisko lub e-mail), najwyżej 50. |
| `GET /api/v1/admin/tasks/:id/history` | `tasks:read` | Ślad audytu zadania, od najnowszych: `{ data, pagination, truncated }` (`RecordHistoryPage`). |

Kontekst (`context`) zapisywany przez API musi należeć do włączonego modułu,
który wskazuje rekord jako widoczny dla ciebie, a gdy rekord ma grupy — jak
etapy projektu — musi wskazywać jedną z nich; w przeciwnym razie `422`
`TASK_CONTEXT_INVALID`. Kontekst zadania jest odczytywany jako `{ type, id,
groupId, available, label, href, groupLabel }`. Gdy moduł będący właścicielem
przestaje opisywać rekord, `available` ma wartość `false`, `label` brzmi
*Niedostępny rekord* w twoim języku, a `href` i `groupLabel` mają wartość
`null`.

Kształty żądań i odpowiedzi to schematy Zod z `@endora-commerce/contracts`
(`tasks.ts`).

### Konteksty zadań

Moduł Zadania nie wymienia z nazwy żadnego innego modułu. Moduł, który chce mieć
własne zadania, rejestruje **kontekst zadania** — typ kontekstu, którego jest
właścicielem, np. `project` — i od tej pory zadania mogą nosić ten typ,
identyfikator jednego z jego rekordów i opcjonalnie identyfikator grupy wewnątrz
rekordu (etapu projektu).

Rejestr to wpis kontenera `taskContextRegistry` (`TaskContextRegistryPort`).
Jest rejestrowany bez bramki, więc dodawaj do niego wpis z **hooka startowego
wyłącznie wnoszącego wkład, bez sprawdzania obecności**, a krawędź zadeklaruj w
`nonBindingDependencies` manifestu jako `contributes-to`:

```ts
ctx.onBoot(() => {
  lazyPort<TaskContextRegistryPort>(ctx, 'taskContextRegistry').register({
    contextType: 'project',
    ownerModuleId: 'projects',
    allVisibleContextIds: () => /* every record id the caller may see */,
    visibleContextIds: (ids) => /* which of these ids the caller may see */,
    describe: (ids) => /* id → { label, href, groups: groupId → label } */,
    canSeeAs: (adminUserId, id) => /* may that administrator see this record? */,
    canChangeTasks: (id) => /* may the caller add, take out or delete a task of this record? */,
  });
});
```

Zobowiązania deskryptora:

- **Każda metoda działa w kontekście dzierżawy samego wywołującego.** Odpowiadaj
  dla wywołującego dokładnie tak, jak odpowiadałyby twoje własne ekrany.
- `allVisibleContextIds()` to filtr wstępny listy: lista zadań pyta o niego raz
  na żądanie i zawęża zapytanie do tych identyfikatorów, więc strony pozostają
  dokładne. Niech będzie tani.
- `visibleContextIds(ids)` odpowiada dla jednego zadania albo kilku.
- `describe(ids)` określa, jak zadanie pokazuje swój kontekst: etykietę, adres w
  panelu administracyjnym i etykiety grup rekordu.
- `canSeeAs(adminUserId, id)` to jedyna metoda, która odpowiada za **kogoś
  innego**: czy ten administrator, według własnych uprawnień i zasięgu, może
  zobaczyć rekord. Moduł pyta o nią, zanim powiadomi osobę przypisaną o zadaniu
  tego rekordu; `false` — albo wyłączony właściciel — oznacza, że nikt nie
  dostaje powiadomienia.
- `canChangeTasks(id)` rozstrzyga, czy wywołujący może zmienić to, jakie
  zadania ma rekord: umieścić zadanie **w** rekordzie (utworzyć je tam albo tam
  przenieść), wyjąć je **z** rekordu (odpiąć przez `context: null` albo
  przenieść do innego rekordu) lub **usunąć** jedno z jego zadań. Przeniesienie
  zadania między grupami tego samego rekordu i edycja zadania tam, gdzie jest,
  nie wymagają tej zgody. Bez niej posiadacz `tasks:write`, który jedynie widzi
  rekord, mógłby udostępnić jego zadania każdemu, kto czyta zadania, albo
  dodawać i usuwać pracę tego rekordu. Projekty odpowiadają „tak” posiadaczowi
  `projects:write`, który widzi projekt; `false` to odmowa `422`
  `TASK_CONTEXT_INVALID` przy umieszczaniu i wyjmowaniu oraz `403` `FORBIDDEN`
  przy usuwaniu.
- `renderNote(note, language)`, opcjonalna, formułuje w języku czytającego
  notatkę, którą moduł zostawił w zadaniu przy jego tworzeniu (`contextNote` w
  `taskWritePort.createMany`). Zapisuj klucz zamiast zdania — Projekty zapisują
  rolę odpowiedzialną — a zdanie zwracaj tutaj; bez tej metody notatka jest
  pokazywana tak, jak ją zapisano.
- Jeden typ kontekstu ma jednego właściciela; rejestracja drugiego, innego
  deskryptora dla zajętego już typu zatrzymuje backend przy starcie.
- **Zasada to fail-closed.** Zadanie, którego typu kontekstu nikt nie
  zarejestrował albo którego właściciel jest wyłączony, jest ukryte na listach,
  w licznikach i pod swoim identyfikatorem, a wraca, gdy właściciel zostanie
  włączony. System — zadanie w tle bez administratora za nim — nigdy nie jest
  zawężany.

### Odczyt i zapis zadań z innego modułu

Dwa porty, oba za bramką — rozwiązanie któregokolwiek przy wyłączonym module
Zadania rzuca wyjątek, a wywołanie odpowiada `503` `MODULE_DISABLED`.
Rozwiązuj je przez `lazyPort` i deklaruj jako `degrades-without` ze zdaniem
`whenAbsent`.

| Port | Metody |
| --- | --- |
| `taskReadPort` (`TaskReadPort`) | `findById`, `listInContext`, `listOpenInContext` (ani `done`, ani `cancelled`), `countInContext` — zawężane widocznością kontekstu dla administratora, nie dla systemu. |
| `taskWritePort` (`TaskWritePort`) | `createMany({ context, tasks })` — najwyżej 100 zadań, jedno audytowane polecenie `tasks.task.create` i jedno zdarzenie `tasks.task.created.v1` na zadanie; odrzucane z `TASK_CONTEXT_INVALID`, gdy żaden włączony moduł nie jest właścicielem typu kontekstu, i z `TASK_ASSIGNEE_INVALID`, gdy osoba przypisana nie jest aktywnym administratorem — zanim cokolwiek zostanie zapisane. `deleteInContext({ contextType, contextId })` — wszystkie zadania jednego rekordu, każde przez osobne audytowane polecenie `tasks.task.delete`. |

Wywołuj `createMany` **dopiero po zatwierdzeniu własnej transakcji**: każde
zadanie jest zapisywane we własnej transakcji.

`./backend` eksportuje też **`nextTaskNumber(em)`** — wejście modułu do jego
sekwencji numerów: kolejny numer `TSK-…` w transakcji wywołującego, dla kodu,
który zapisuje zadania bez polecenia (Command), na przykład dla kompozycji demo;
jeden format i jedna sekwencja, niezależnie od tego, kto tworzy zadanie.

### Zdarzenia

| Zdarzenie | Treść |
| --- | --- |
| `tasks.task.created.v1` | `{ taskId, contextType, contextId, contextGroupId, assignedAdminUserId }` |
| `tasks.task.status_changed.v1` | `{ taskId, from, to, contextType, contextId, contextGroupId }` |
| `tasks.task.assigned.v1` | `{ taskId, from, to }` |
| `tasks.task.deleted.v1` | `{ taskId, contextType, contextId }` |

Każde jest emitowane raz na polecenie, po jego zatwierdzeniu. Zmiana kilku
rodzajów naraz — `PATCH` z nowym tytułem, osobą przypisaną i statusem — to
jedno polecenie na rodzaj (`tasks.task.update`, `tasks.task.assign`,
`tasks.task.status_change`), każde z własnym wierszem audytu, a dwa ostatnie
także z własnym zdarzeniem.
