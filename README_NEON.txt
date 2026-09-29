MANOR HOUSE — PostgreSQL / Neon migration block

1. In local .env keep your existing variables and add:
   DATABASE_URL=<Neon connection string>

   Do not send DATABASE_URL, SECRET_KEY, ADMIN_PASSWORD or Telegram secrets in chat.

2. Replace these project files with the supplied versions:
   database.py
   server.py
   requirements.txt

3. Install the new dependency:
   .\venv\Scripts\python.exe -m pip install -r requirements.txt

4. Start locally:
   .\venv\Scripts\python.exe server.py

5. Open:
   http://127.0.0.1:5000/api/health

   Expected JSON contains:
   "status": "ok"
   "service": "MANOR HOUSE API"
   "database": "postgresql"

6. Then test:
   - public services and masters
   - create a booking
   - Telegram notification
   - admin login
   - booking appears in admin
   - Clients
   - reschedule
   - schedule / blocks / exceptions
   - catalog
   - Analytics
   - Reminders

7. Only after local Neon tests pass:
   git add database.py server.py requirements.txt
   git commit -m "Migrate MANOR HOUSE to PostgreSQL"
   git push

8. On Render add the SAME DATABASE_URL as an Environment Variable.
   Do not set DATABASE_PATH for PostgreSQL.
   Render will redeploy from GitHub and should then use Neon.

Notes:
- If DATABASE_URL is absent, the project deliberately falls back to SQLite.
- The PostgreSQL path keeps the existing booking/schedule/catalog write operations serialized with a PostgreSQL advisory transaction lock. This preserves the atomic behavior previously provided by SQLite BEGIN IMMEDIATE and prevents concurrent booking races in this small CRM.
- Neon starts with a clean database. The app creates schema, base services, base barbers and schedules automatically on first start.
- Existing local SQLite test records are not copied to Neon by this block.
