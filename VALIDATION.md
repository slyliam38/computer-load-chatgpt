# Release validation — 0.1.4 — 20 October 2026

The following checks were run locally on macOS for the public-source preparation:

| Check | Result |
| --- | --- |
| Node syntax (`npm run check`) | Passed |
| Node HTTP/dashboard/iframe tests (`npm test`) | 7 passed |
| Python policy, interpretation, Windows API mocks and source-archive tests | 24 passed |
| Read-only live MCP HTTP verification (`npm run verify`) | Passed; 4 tools, real 2-second macOS sample, no user processes stopped |
| MCP stdio discovery/resource verification (`npm run verify:stdio`) | Passed; 4 tools and protocol-clean stdout |
| Production npm dependency audit (`npm audit --omit=dev`) | No known vulnerabilities reported at check time |
| Release source-file and attribution review | No blocking findings; local artifacts and environments excluded |
| Clean installation from the 39-file source archive | Passed; setup, syntax checks and all 31 automated tests |

Tests that signal a real process target only a disposable child created by the test.
The source release does not change or restart the installed desktop application.
Raw live reports remain in ignored `artifacts/`; they are not public evidence files.

The cross-platform CI workflow is configured, but a published workflow is not a
passed GitHub run. Real Windows UI operation, native chat-stream widget rendering
and cloud ChatGPT tunnel integration remain unverified. No public adoption count
is claimed. Historical 0.1.3 and earlier evidence follows unchanged.

---

# Проверки версии 0.1.3 — 3 октября 2026

## Проверка виджета

| Проверка | Результат |
| --- | --- |
| Установка версии 0.1.3 и обнаружение инструментов app-server Codex | Пройдено; для независимого теста использованы отдельные порты, обычные порты уже заняты desktop-экземпляром |
| Локальная панель во встроенном браузере Codex | Настоящий замер, показатели и сортировка по памяти проверены кнопками |
| Ресурс установленного MCP в iframe `sandbox="allow-scripts"`, без same-origin, с ограниченным CSP | Проверен в локальном тестовом контейнере во встроенном браузере Codex |
| `ui/initialize`, initialized, tool-result, tools/call, size-changed | Инициализация, передача живого отчёта, повторный замер и изменение высоты проверены |
| Ошибка инструмента, отмена и неполные данные | Сообщения видны; ошибка сбрасывается при последующем успешном отчёте |
| Сортировка по памяти в iframe | Проверена |
| Узкая ширина 480 px | Карточки переходят на две колонки; временный viewport восстановлен |
| JS console после браузерного сценария | Ошибок и предупреждений не обнаружено |
| HTTP и DOM regression | 7 тестов пройдены, включая три теста iframe bridge |
| Остановка процессов пользователя | Не выполнялась; в браузерном и MCP приёмочном тесте вызывалась только диагностика |
| Виджет непосредственно в ленте чата Codex | Не проверен: методы плагина отсутствуют в каталоге инструментов текущего чата; управление окном Codex запрещено инструментом UI, доступного backend control socket нет |

Тестовый контейнер не выдаётся за нативный MCP Apps host Codex. Его кнопки ошибок и
отмены отправляют синтетические сообщения, а измерения выполняет настоящий установленный
MCP-сервер. Скриншоты и фактический JSON замера находятся в `artifacts/` и исключены из архива.
Существующий desktop-экземпляр на стандартных портах не останавливался.

Изменения виджета: видимые ошибки/отмена/неполные данные, очистка старого сообщения при
успешном обновлении, проверка согласованной версии bridge, уведомление host об изменении
высоты. Windows и облачный ChatGPT в этом приёмочном этапе не участвовали.

## Предыдущие проверки версии 0.1.1

Дополнительно к проверкам 0.1.0:

| Проверка | Результат |
| --- | --- |
| Установка в Codex из локального marketplace | `computer-load@computer-load-local`, версия 0.1.1, включён |
| Обнаружение установленного MCP через app-server Codex | Все четыре инструмента обнаружены; чат и модель не запускались |
| Запуск скопированного пакета без ссылок `.venv/bin/python` | Пройдено; изолированный bootstrap использует зависимости пакета |
| Установленный stdio-сервер: diagnose, show, resources/read | Пройдено; настоящий замер 3,09 с на macOS |
| Синтаксис Node.js и изолированный Python bootstrap | Пройдено |
| HTTP и DOM regression | 4 теста пройдены; HTTP повторён вне песочницы после запрета bind тестового порта |
| Остановка в этом приёмочном тесте | Инструменты остановки не вызывались; процессы пользователя не останавливались |
| Рендеринг виджета и загрузка инструментов в уже открытый desktop-чат | Не проверено |

Артефакты текущей проверки: `artifacts/codex-plugin-inventory.json`,
`artifacts/codex-live-scan.json`, `artifacts/codex-installed-verification.json`.
Они остаются локальными и не включаются в архив.

Проверки предыдущей версии 0.1.0 — 1 октября 2026:

| Проверка | Результат |
| --- | --- |
| Node.js / Python syntax | Пройдено |
| HTTP и локальное подтверждение | 2 теста пройдены |
| Отображение панели, сортировка, недоверенные имена, обработка ошибок | 2 DOM-теста пройдены |
| Политика процессов, срок запроса, PID reuse, повторное использование, Windows WM_CLOSE и интерпретация метрик | 21 Python-тест пройден |
| Живая диагностика на macOS | Пройдена; показатели получены через MCP |
| MCP Streamable HTTP: initialize, tools/list, diagnose, show, protected stop rejection, resources/read, unknown status | Пройдено |
| MCP stdio: initialize, tools/list, resources/read и чистый stdout | Пройдено |
| `plugin.json` и `mcp.json` против опубликованных JSON Schema Agent Plugins 1.0.0 | Валидны |
| Отдельный read-only review механизма закрытия | Существенных блокирующих ошибок не обнаружено |
| Настоящее завершение процесса | Проверено только на дочернем процессе, созданном тестом |
| Завершение процессов пользователя | Не выполнялось |
| Панель в настоящем браузере | Начальная страница прочитана; полный сценарий кнопок не проверен из-за недоступности browser automation |
| Windows на настоящей ОС | Не проверено; Windows WinAPI тестируется подставной реализацией |
| ChatGPT: подключение и UI bridge внутри чата | Не проверено |

Достигнут уровень локальной проверки MCP, установки в Codex и логики интерфейса. Это не подтверждение
установки плагина в ChatGPT или совместимости со всеми версиями Windows.
Для следующего приёмочного этапа нужен реальный Windows-компьютер и подключение
из конкретного аккаунта ChatGPT к парному локальному агенту.

Сбор выполняется на компьютере, где работает агент, а не на произвольном устройстве,
с которого открыт чат. В переносимом архиве нет данных живой диагностики, ключей,
node_modules или Python-окружения.
