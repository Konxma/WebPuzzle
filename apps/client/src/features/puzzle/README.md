# Puzzle feature

- models/RoomGateway.ts — інтерфейс мережевої кімнати.
- viewmodels/PuzzleViewModel.ts — стан екрана, прогрес, гравці та команди.
- views/PuzzleView.tsx — React-панелі та контейнер.
- rendering/PuzzleRenderer.ts — PixiJS, єдиний атлас, камера та вказівник.

Фігурні контури, сусідство і з’єднання — у packages/shared/src/domain. Сервер підтверджує захоплення, рух та з’єднання. Рухи обробляються поза React. Подальша оптимізація й тестування на слабших ПК залишаються потрібними.
