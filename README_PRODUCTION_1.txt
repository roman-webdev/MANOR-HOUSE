MANOR HOUSE — Production Block 1

Заменить в проекте:
- server.py
- database.py
- requirements.txt

Локальный .env НЕ публиковать и НЕ заменять.

Для production:
APP_ENV=production
BUSINESS_TIMEZONE=Europe/Kyiv
DATABASE_PATH=/var/data/manor_house.db

Render Build Command:
pip install -r requirements.txt

Render Start Command:
gunicorn --workers 1 --threads 4 --timeout 60 --bind 0.0.0.0:$PORT server:app

Важно:
SQLite для реальных записей должен находиться на persistent disk.
На Render Free локальная SQLite-база не подходит для реальных данных,
потому что локальная файловая система эфемерная.
