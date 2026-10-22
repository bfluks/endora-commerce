---
title: Opinie
description: Administratorzy wysyłają z panelu opinie twórcom Endora Commerce, przekazywane jako jeden e-mail i nigdzie nie zapisywane
---

# Opinie

Moduł `admin_feedback` pozwala każdemu zalogowanemu administratorowi wysłać opinię twórcom Endora
Commerce bez wychodzenia z panelu: błąd, brakującą funkcję, pytanie. Dopóki moduł jest włączony,
panel pokazuje link **Wyślij opinię**; okno, które otwiera, prosi o treść wiadomości, adres e-mail
do odpowiedzi i opcjonalnie numer telefonu.

## Co jest wysyłane i dokąd

Instancja przekazuje wiadomość do **przekaźnika** — domyślnie punktu kontaktowego
`commerce.endora.software` — który zamienia ją w jeden e-mail do wsparcia Endory, z Twoim adresem
jako adresem odpowiedzi. Oprócz tego, co wpisała osoba wysyłająca, instancja dodaje to, co wie
o sobie, żeby nikt nie musiał tego wpisywać:

| Pole | Skąd pochodzi |
| --- | --- |
| Wiadomość, e-mail, telefon | Okno opinii |
| Język | Język, w którym działał panel |
| Adres panelu | Adres panelu, w którym otwarto okno |
| Wydanie platformy | Wydanie Endora Commerce, na którym działa instancja |
| Adres API | Skonfigurowany publiczny adres API instancji, jeśli jest ustawiony |
| Administrator | Imię i nazwisko oraz identyfikator wysyłającego administratora |

**Na instancji nic nie jest zapisywane**: ani tabela, ani wpis w logu z treścią wiadomości. Jeśli
przekaźnik jest nieosiągalny, osoba wysyłająca dowiaduje się o tym i może spróbować ponownie.

## Ustawienia

Oba znajdują się w grupie **Opinie** na ekranie Ustawienia.

| Ustawienie | Domyślnie | Znaczenie |
| --- | --- | --- |
| `admin_feedback.module_enabled` | włączone | Przełącznik aktywacji modułu. Wyłączony: link znika i nie można nic wysłać. |
| `admin_feedback.relay_url` | `https://commerce.endora.software/api/platform-feedback/` | Dokąd wysyłane są opinie. Musi to być adres `http` lub `https`. Pusta wartość pozostawia moduł włączony i odrzuca każdą wysyłkę jako nieskonfigurowaną. |

Jeśli Twoja instancja nie może wysyłać do Endory żadnych danych, wyłącz moduł. Nic innego
w platformie od niego nie zależy.

## API

`POST /api/v1/admin/feedback` — dowolny zalogowany administrator, bez wymaganego kodu uprawnienia.

```json
{
  "message": "The order list forgets my filters after I open an order.",
  "email": "anna@shop.example",
  "phone": "+48 600 100 200",
  "adminUrl": "https://admin.shop.example",
  "language": "en"
}
```

| Odpowiedź | Kiedy |
| --- | --- |
| `204` | Przekaźnik przyjął wiadomość. |
| `400 VALIDATION_FAILED` | Treść żądania jest nieprawidłowa — pusta wiadomość, błędny adres e-mail lub numer telefonu. |
| `429 RATE_LIMITED` | Administrator wysłał więcej niż pięć wiadomości w ciągu dziesięciu minut albo przekaźnik ogranicza liczbę wiadomości z tej instancji. |
| `502 ADMIN_FEEDBACK_DELIVERY_FAILED` | Przekaźnik nie odpowiedział w ciągu dziesięciu sekund, odrzucił wiadomość albo odpowiedział przekierowaniem (które nigdy nie jest wykonywane — sprawdź adres przekaźnika, łącznie z ukośnikiem na końcu). |
| `503 ADMIN_FEEDBACK_NOT_CONFIGURED` | Adres przekaźnika jest pusty albo nie jest adresem `http(s)`. |
| `503 MODULE_DISABLED` | Moduł jest wyłączony. |
