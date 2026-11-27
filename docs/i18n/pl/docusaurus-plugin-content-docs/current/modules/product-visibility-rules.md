---
title: Reguły widoczności produktów
description: Ograniczanie, które produkty widzi rola administratora, według ceny katalogowej, i produkty kanału sprzedaży podążające za regułą
---

# Reguły widoczności produktów

Moduł `product_visibility_rules` ogranicza, które produkty widzi rola administratora, według cen
katalogowych produktów, i pozwala, by produkty kanału sprzedaży podążały za nazwaną regułą produktową
(*regułą witryny*). Jest dostarczany **wyłączony**: dopóki operator go nie włączy, nic się nie zmienia.

Ta strona rośnie razem z funkcją (`specs/193-product-visibility-rules/`); przewodnik operatora
powstanie razem z ekranami konfiguracji.

## Włączanie i wyłączanie

Przełącznik aktywacji jest na **Platforma → Moduły**. Włączenie od razu stosuje mapowania ról —
niezmapowana rola obsługująca zapytania ofertowe nie widzi żadnych produktów, dopóki nie zostanie
zmapowana, więc zmapuj role zaraz po włączeniu. Wyłączenie od razu znosi wszystkie ograniczenia i
zachowuje całą konfigurację, która zaczyna znów działać po ponownym włączeniu modułu.
