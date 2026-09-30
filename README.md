# MANOR HOUSE — Barbershop Booking & CRM

A full-stack portfolio project for a premium barbershop: a cinematic
public website, online booking system, Telegram notifications, and a
protected admin CRM for managing appointments, clients, schedules,
services, reminders, and business analytics.

**Live demo:** https://manor-house.onrender.com
**Health check:** https://manor-house.onrender.com/api/health
**Admin panel:** `/admin.html` — protected by authentication;
credentials are not published.

> The live service uses Render Free and may need extra time to wake up
> after a period of inactivity.

## Project overview

MANOR HOUSE started as a premium barbershop landing page and evolved
into a complete booking and management system.

The public side lets a client choose a service, barber, date, available
time, and contact details. The backend validates the request, prevents
conflicting reservations, stores the booking in PostgreSQL, and sends a
Telegram notification. The admin side provides a compact CRM for
day-to-day barbershop operations.

## Key features

### Public website

-   Premium dark/gold responsive design with cinematic imagery.
-   Dynamic services and barber catalog loaded from the backend.
-   Five-step booking flow: service → barber → date → time → contacts.
-   30-day booking horizon with 30-minute slot intervals.
-   Availability calculated from service duration, barber schedule,
    exceptions, blocked time, and existing confirmed bookings.
-   Booking validation on both the client and server side.
-   Clear booking confirmation state after a successful request.

### Booking management

-   Create bookings from the public website or manually from the admin
    panel.
-   Confirmed, completed, and cancelled booking statuses.
-   Reschedule an existing booking without creating a duplicate record.
-   Availability is rechecked during rescheduling.
-   Historical service/barber snapshots preserve old booking data after
    catalog changes.
-   Conflict protection prevents two bookings from occupying the same
    time.

### Client CRM

-   Client profiles aggregated by normalized phone number.
-   Visit history, completed visits, revenue, last visit, and favorite
    barber.
-   Persistent client notes and tags.
-   Booking-specific comments.
-   Repeat booking with prefilled client data.
-   Archive and restore clients without deleting their history.
-   Archived clients are hidden from the operational bookings view.
-   A client with a current or future confirmed booking cannot be
    archived.

### Barber schedules

-   Weekly recurring schedule for every barber.
-   Individual days off.
-   Special working hours for a specific date.
-   Time blocks with an optional reason.
-   Conflict checks protect existing confirmed bookings when a schedule
    is changed.

### Services and barbers

-   Admin catalog for services and barbers.
-   Add and edit catalog items.
-   Activate/deactivate items instead of hard deleting them.
-   Public booking shows only active services and barbers.
-   Deactivation is protected when it would conflict with future
    confirmed bookings.

### Reminders

-   Admin reminder center for confirmed bookings scheduled for today and
    tomorrow.
-   Manual "contacted/reminded" state.
-   Reminder state persists in the database.
-   Rescheduling resets the reminder state when appropriate.
-   No automatic client messages are sent from this module.

### Analytics

-   Periods: last 7 days, last 30 days, current month, previous month,
    and all time.
-   Revenue from completed visits.
-   Completed visits and average check.
-   Cancellation count.
-   New vs repeat clients.
-   Popular services.
-   Barber performance metrics.
-   Revenue/visit dynamics.

### Telegram integration

The owner receives Telegram notifications for important booking events,
including new bookings and rescheduling. Telegram credentials are stored
only in environment variables and are not committed to the repository.

## Screenshots

### Public website

![MANOR HOUSE public website](docs/screenshots/01-home.png)

### Online booking

![MANOR HOUSE online booking](docs/screenshots/02-booking.png)

### Admin CRM

![MANOR HOUSE admin CRM](docs/screenshots/03-admin-crm.png)

### Business analytics

![MANOR HOUSE business analytics](docs/screenshots/04-analytics.png)

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Backend | Python, Flask |
| Database | PostgreSQL / Neon |
| Local database fallback | SQLite |
| PostgreSQL driver | Psycopg 3 |
| Production server | Gunicorn |
| Hosting | Render |
| Notifications | Telegram Bot API |
| Configuration | python-dotenv |
| Timezone | Europe/Kyiv via zoneinfo / tzdata |

## Architecture

``` mermaid
flowchart LR
    Client[Public website] --> API[Flask API]
    Admin[Admin CRM] --> API
    API --> DB[(Neon PostgreSQL)]
    API --> TG[Telegram Bot API]
    API --> Static[HTML / CSS / JavaScript]
```

Production request flow:

``` text
Browser
  ↓
Render / Gunicorn
  ↓
Flask API
  ├── Neon PostgreSQL
  ├── Telegram Bot API
  └── Public site / Admin CRM
```

## Database and booking safety

Production uses PostgreSQL through `DATABASE_URL`. If `DATABASE_URL` is
not configured, the project can fall back to a local SQLite database for
development.

The database layer keeps the application code compatible with both
backends. PostgreSQL write flows use a transaction-level advisory lock
for operations that require serialized writes, preserving the atomic
booking and schedule behavior used by the project.

Availability is checked again inside the booking transaction before the
booking is committed. This prevents a client from reserving a slot that
became unavailable after the page originally loaded.

## Security

-   Secrets are loaded from environment variables.
-   `.env` files and local database files are excluded from Git.
-   `SECRET_KEY` and `ADMIN_PASSWORD` are required; there are no
    production fallback credentials.
-   Admin authentication uses server-side session state.
-   Session cookies use `HttpOnly`, `SameSite=Lax`, and `Secure` in
    production.
-   Password comparison uses a timing-safe comparison.
-   Admin API responses use `Cache-Control: no-store`.
-   Security headers include `X-Content-Type-Options`,
    `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`.
-   Admin credentials, Telegram token, Telegram chat ID, and database
    connection string are never published in the repository.

## Project structure

``` text
MANOR-HOUSE/
├── images/                  # Public website images
├── index.html               # Public website
├── style.css                # Public website styles
├── script.js                # Booking UI and public frontend logic
├── admin.html               # Protected admin interface
├── admin.css                # Admin styles
├── admin.js                 # CRM/admin frontend logic
├── server.py                # Flask routes, API, auth and Telegram integration
├── database.py              # PostgreSQL/SQLite data layer and migrations
├── requirements.txt         # Python dependencies
├── .env.production.example  # Environment variable example
├── .gitignore
└── README.md
```

## Local setup

### 1. Clone the repository

``` bash
git clone git@github.com:roman-webdev/MANOR-HOUSE.git
cd MANOR-HOUSE
```

### 2. Create a virtual environment

Windows:

``` powershell
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```

macOS / Linux:

``` bash
python3 -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
```

### 3. Configure environment variables

Create a local `.env` file:

``` env
APP_ENV=development
BUSINESS_TIMEZONE=Europe/Kyiv

SECRET_KEY=replace-with-a-random-secret
ADMIN_PASSWORD=replace-with-an-admin-password

TELEGRAM_BOT_TOKEN=optional-for-local-development
TELEGRAM_CHAT_ID=optional-for-local-development

DATABASE_URL=postgresql://user:password@host/database
```

Do not commit `.env`.

`DATABASE_URL` is used for PostgreSQL. Without it, the application can
use the local SQLite fallback.

### 4. Start the application

Windows:

``` powershell
.\venv\Scripts\python.exe server.py
```

macOS / Linux:

``` bash
python server.py
```

Open:

``` text
http://127.0.0.1:5000
http://127.0.0.1:5000/admin.html
http://127.0.0.1:5000/api/health
```

A PostgreSQL connection is visible in the health response as:

``` json
{
  "database": "postgresql",
  "service": "MANOR HOUSE API",
  "status": "ok"
}
```

## Production deployment

The project is deployed as a Render Web Service.

Build command:

``` bash
pip install -r requirements.txt
```

Start command:

``` bash
gunicorn --workers 1 --threads 4 --timeout 60 --bind 0.0.0.0:$PORT server:app
```

Required production environment variables:

``` text
APP_ENV=production
BUSINESS_TIMEZONE=Europe/Kyiv
SECRET_KEY=...
ADMIN_PASSWORD=...
DATABASE_URL=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Secrets must be configured in the hosting environment and must never be
committed to Git.

## Production verification

The deployed version has been tested for:

-   PostgreSQL connection through the production health endpoint.
-   Public booking creation.
-   Telegram notification delivery.
-   Booking visibility in the admin CRM.
-   Rescheduling and status changes.
-   CRM notes, tags, and booking comments.
-   Schedule conflict protection.
-   Reminder persistence.
-   Analytics updates.
-   Client archive/restore behavior.
-   Data persistence after restarting the Render service.

## Design

The visual direction combines a dark editorial layout, warm gold
accents, cinematic barbershop photography, large typography, and
restrained motion. The goal was to make the public site feel like a real
premium service rather than a generic training landing page, while
keeping the booking flow clear and usable.

## Project status

**Completed portfolio project.**

The current version includes the public website, production backend,
persistent PostgreSQL database, Telegram integration, protected admin
CRM, schedules, client management, reminders, catalog management, and
analytics.

The focus from this point is portfolio presentation and maintenance
rather than adding more CRM features.
