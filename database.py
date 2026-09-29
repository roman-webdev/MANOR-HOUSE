import os
import sqlite3
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


DEFAULT_DATABASE_PATH = Path(__file__).with_name("manor_house.db")
DATABASE_PATH = Path(
    os.getenv("DATABASE_PATH", str(DEFAULT_DATABASE_PATH))
).expanduser()

BUSINESS_TIMEZONE = os.getenv(
    "BUSINESS_TIMEZONE",
    "Europe/Kyiv"
)
BUSINESS_TZ = ZoneInfo(BUSINESS_TIMEZONE)


def business_today():
    return datetime.now(BUSINESS_TZ).date()


def business_now():
    return datetime.now(BUSINESS_TZ)


def get_connection():
    DATABASE_PATH.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    connection = sqlite3.connect(
        DATABASE_PATH,
        timeout=30
    )
    connection.row_factory = sqlite3.Row

    connection.execute(
        "PRAGMA foreign_keys = ON"
    )
    connection.execute(
        "PRAGMA busy_timeout = 30000"
    )

    return connection


def init_database():
    connection = get_connection()
    cursor = connection.cursor()

    cursor.executescript(
        """
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            price INTEGER NOT NULL,
            duration INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS barbers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            position TEXT NOT NULL,
            experience INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            client_name TEXT NOT NULL,
            client_phone TEXT NOT NULL,

            service_id INTEGER NOT NULL,
            barber_id INTEGER NOT NULL,

            booking_date TEXT NOT NULL,
            booking_time TEXT NOT NULL,

            status TEXT NOT NULL DEFAULT 'confirmed',

            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (service_id)
                REFERENCES services(id),

            FOREIGN KEY (barber_id)
                REFERENCES barbers(id)
        );

        CREATE INDEX IF NOT EXISTS idx_bookings_barber_date
        ON bookings (
            barber_id,
            booking_date
        );
        """
    )

    # Seed only empty catalogs; renamed items must not reappear on restart.
    if not cursor.execute('SELECT 1 FROM services LIMIT 1').fetchone():
        seed_services(cursor)
    if not cursor.execute('SELECT 1 FROM barbers LIMIT 1').fetchone():
        seed_barbers(cursor)

    connection.commit()
    connection.close()
    migrate_catalog()
    migrate_crm()
    migrate_reminders()


def seed_services(cursor):
    services = [
        (
            "Мужская стрижка",
            600,
            60
        ),
        (
            "Стрижка бороды",
            350,
            30
        ),
        (
            "Стрижка + борода",
            850,
            90
        ),
        (
            "Королевское бритьё",
            500,
            45
        )
    ]

    cursor.executemany(
        """
        INSERT OR IGNORE INTO services (
            name,
            price,
            duration
        )
        VALUES (?, ?, ?)
        """,
        services
    )


def seed_barbers(cursor):
    barbers = [
        (
            "Максим",
            "Barber",
            5
        ),
        (
            "Александр",
            "Senior Barber",
            8
        ),
        (
            "Артём",
            "Barber",
            4
        )
    ]

    cursor.executemany(
        """
        INSERT OR IGNORE INTO barbers (
            name,
            position,
            experience
        )
        VALUES (?, ?, ?)
        """,
        barbers
    )


def get_services():
    connection = get_connection()

    rows = connection.execute(
        """
        SELECT
            id,
            name,
            price,
            duration
        FROM services
        WHERE active=1
        ORDER BY id
        """
    ).fetchall()

    connection.close()

    return [
        dict(row)
        for row in rows
    ]


def get_barbers():
    connection = get_connection()

    rows = connection.execute(
        """
        SELECT
            id,
            name,
            position,
            experience
        FROM barbers
        WHERE active=1
        ORDER BY id
        """
    ).fetchall()

    connection.close()

    return [
        dict(row)
        for row in rows
    ]


def find_service_by_name(name):
    connection = get_connection()

    row = connection.execute(
        """
        SELECT
            id,
            name,
            price,
            duration
        FROM services
        WHERE name = ? AND active=1
        """,
        (name,)
    ).fetchone()

    connection.close()

    return dict(row) if row else None


def find_barber_by_name(name):
    connection = get_connection()

    row = connection.execute(
        """
        SELECT
            id,
            name,
            position,
            experience
        FROM barbers
        WHERE name = ? AND active=1
        """,
        (name,)
    ).fetchone()

    connection.close()

    return dict(row) if row else None


def get_bookings_for_barber_date(
    barber_id,
    booking_date
):
    connection = get_connection()

    rows = connection.execute(
        """
        SELECT
            b.id,
            b.booking_time,
            b.status,
            b.service_duration AS duration
        FROM bookings AS b


        WHERE
            b.barber_id = ?
            AND b.booking_date = ?
            AND b.status = 'confirmed'

        ORDER BY b.booking_time
        """,
        (
            barber_id,
            booking_date
        )
    ).fetchall()

    connection.close()

    return [
        dict(row)
        for row in rows
    ]


def create_booking(client_name, client_phone, service_id, barber_id, booking_date, booking_time):
    return create_booking_safely(client_name, client_phone, service_id, barber_id,
                                 booking_date, booking_time, None)


def get_all_bookings():
    connection = get_connection()

    rows = connection.execute(
        """
        SELECT
            b.id,
            b.client_name,
            b.client_phone,
            b.booking_date,
            b.booking_time,
            b.status,
            b.created_at,
            b.comment,
            b.comment_revision,

            b.service_name AS service_name,
            b.service_price AS service_price,
            b.service_duration AS service_duration,

            b.barber_name AS barber_name

        FROM bookings AS b



        ORDER BY
            b.booking_date ASC,
            b.booking_time ASC
        """
    ).fetchall()

    connection.close()

    return [
        dict(row)
        for row in rows
    ]


def update_booking_status(
    booking_id,
    new_status
):
    connection = get_connection()

    try:
        connection.execute('BEGIN IMMEDIATE')
        if new_status == 'confirmed':
            inactive = connection.execute('''SELECT b.id FROM bookings b
                JOIN services s ON s.id=b.service_id JOIN barbers br ON br.id=b.barber_id
                WHERE b.id=? AND b.status!='confirmed' AND (s.active=0 OR br.active=0)''', (booking_id,)).fetchone()
            if inactive:
                raise ValueError('Услуга или мастер отключены. Сначала включите их или создайте новую запись.')
            row = connection.execute('SELECT barber_id,booking_date,booking_time FROM bookings WHERE id=?', (booking_id,)).fetchone()
            if row:
                overlaps = connection.execute('''SELECT other.id FROM bookings current
                    JOIN bookings other ON other.barber_id=current.barber_id AND other.booking_date=current.booking_date
                    WHERE current.id=? AND other.id!=current.id AND other.status='confirmed'
                    AND (CAST(substr(current.booking_time,1,2) AS INTEGER)*60+CAST(substr(current.booking_time,4,2) AS INTEGER))
                        < (CAST(substr(other.booking_time,1,2) AS INTEGER)*60+CAST(substr(other.booking_time,4,2) AS INTEGER)+other.service_duration)
                    AND (CAST(substr(other.booking_time,1,2) AS INTEGER)*60+CAST(substr(other.booking_time,4,2) AS INTEGER))
                        < (CAST(substr(current.booking_time,1,2) AS INTEGER)*60+CAST(substr(current.booking_time,4,2) AS INTEGER)+current.service_duration)
                    LIMIT 1''', (booking_id,)).fetchone()
                if overlaps:
                    raise ValueError('Время уже занято другой подтверждённой записью.')
        cursor = connection.execute('UPDATE bookings SET status=? WHERE id=?', (new_status,booking_id))
        if new_status == 'confirmed' and row:
            check_schedule_conflicts(connection,row['barber_id'])
        connection.commit()
        return cursor.rowcount>0
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

def create_booking_safely(
    client_name,
    client_phone,
    service_id,
    barber_id,
    booking_date,
    booking_time,
    service_duration,
    availability_guard=None
):
    connection = get_connection()

    try:
        connection.execute(
            "BEGIN IMMEDIATE"
        )

        service = connection.execute('SELECT * FROM services WHERE id=? AND active=1', (service_id,)).fetchone()
        barber = connection.execute('SELECT * FROM barbers WHERE id=? AND active=1', (barber_id,)).fetchone()
        if not service or not barber or (service_duration is not None and service_duration != service['duration']):
            return None
        service_duration = service['duration']
        # Check the current schedule while holding the same write lock as catalog edits.
        hours, blocks = schedule_day(connection, barber_id, booking_date)
        def mins(value):
            h, m = map(int, value.split(':'))
            return h * 60 + m
        start = mins(booking_time)
        end = start + service_duration
        if (not hours or start < mins(hours[0]) or end > mins(hours[1]) or
                any(start < mins(block['end']) and mins(block['start']) < end for block in blocks)):
            return None

        if availability_guard is not None and not availability_guard(connection):
            connection.rollback()
            return None

        rows = connection.execute(
            """
            SELECT
                b.booking_time,
                b.service_duration AS duration
            FROM bookings AS b


            WHERE
                b.barber_id = ?
                AND b.booking_date = ?
                AND b.status = 'confirmed'
            """,
            (
                barber_id,
                booking_date
            )
        ).fetchall()


        new_hours, new_minutes = map(
            int,
            booking_time.split(":")
        )

        new_start = (
            new_hours * 60
            + new_minutes
        )

        new_end = (
            new_start
            + service_duration
        )


        for row in rows:

            hours, minutes = map(
                int,
                row["booking_time"].split(":")
            )

            existing_start = (
                hours * 60
                + minutes
            )

            existing_end = (
                existing_start
                + row["duration"]
            )

            overlaps = (
                new_start < existing_end
                and existing_start < new_end
            )

            if overlaps:
                connection.rollback()
                return None


        cursor = connection.execute(
            """
            INSERT INTO bookings (
                client_name,
                client_phone,
                service_id,
                barber_id,
                booking_date,
                booking_time, service_name, service_price, service_duration, barber_name
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                client_name,
                client_phone,
                service_id,
                barber_id,
                booking_date,
                booking_time, service['name'], service['price'], service['duration'], barber['name']
            )
        )

        booking_id = cursor.lastrowid

        connection.commit()

        return booking_id

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()

# Schedule tables share the existing database and booking transaction lock.
def init_schedules(defaults):
    from contextlib import closing
    with closing(get_connection()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        hours_check = "CHECK ((working=0 AND start IS NULL AND end IS NULL) OR (working=1 AND start IS NOT NULL AND end IS NOT NULL AND start<end))"
        connection.execute(f"""CREATE TABLE IF NOT EXISTS barber_weekly (
            barber_id INTEGER NOT NULL REFERENCES barbers(id),
            weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
            working INTEGER NOT NULL CHECK(working IN (0,1)),
            start TEXT, end TEXT, PRIMARY KEY(barber_id,weekday), {hours_check})""")
        connection.execute(f"""CREATE TABLE IF NOT EXISTS barber_exceptions (
            barber_id INTEGER NOT NULL REFERENCES barbers(id),
            date TEXT NOT NULL, working INTEGER NOT NULL CHECK(working IN (0,1)),
            start TEXT, end TEXT, PRIMARY KEY(barber_id,date), {hours_check})""")
        connection.execute("""CREATE TABLE IF NOT EXISTS barber_blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barber_id INTEGER NOT NULL REFERENCES barbers(id), date TEXT NOT NULL,
            start TEXT NOT NULL, end TEXT NOT NULL CHECK(start<end),
            reason TEXT NOT NULL DEFAULT '', UNIQUE(barber_id,date,start,end))""")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_barber_blocks_day ON barber_blocks(barber_id,date)")
        for barber in connection.execute("SELECT id,name FROM barbers").fetchall():
            for weekday in range(7):
                hours = defaults.get(barber['name'], {}).get(weekday)
                connection.execute("""INSERT OR IGNORE INTO barber_weekly
                    (barber_id,weekday,working,start,end) VALUES (?,?,?,?,?)""",
                    (barber['id'], weekday, int(bool(hours)), hours[0] if hours else None, hours[1] if hours else None))


def schedule_day(connection, barber_id, day):
    from datetime import date
    row = connection.execute("SELECT working,start,end FROM barber_exceptions WHERE barber_id=? AND date=?",
                             (barber_id, day)).fetchone()
    if row is None:
        row = connection.execute("SELECT working,start,end FROM barber_weekly WHERE barber_id=? AND weekday=?",
                                 (barber_id, date.fromisoformat(day).weekday())).fetchone()
    blocks = connection.execute("SELECT start,end FROM barber_blocks WHERE barber_id=? AND date=?",
                                (barber_id, day)).fetchall()
    return ((row['start'], row['end']) if row and row['working'] else None), blocks


def schedule_snapshot(connection, barber_id):
    from datetime import date
    today = business_today().isoformat()
    return {
        'weekly': [dict(r) for r in connection.execute('SELECT weekday,working,start,end FROM barber_weekly WHERE barber_id=? ORDER BY weekday', (barber_id,))],
        'exceptions': [dict(r) for r in connection.execute('SELECT date,working,start,end FROM barber_exceptions WHERE barber_id=? AND date>=? ORDER BY date', (barber_id,today))],
        'blocks': [dict(r) for r in connection.execute('SELECT id,date,start,end,reason FROM barber_blocks WHERE barber_id=? AND date>=? ORDER BY date,start', (barber_id,today))],
        'today': today
    }


def check_schedule_conflicts(connection, barber_id):
    """Reject edits that would strand future confirmed appointments. Never cancel them."""
    from datetime import datetime
    now = business_now()
    def minutes(value):
        h,m = map(int,value.split(':'))
        return h*60+m
    rows = connection.execute("""SELECT b.id,b.booking_date,b.booking_time,b.service_duration AS duration
        FROM bookings b
        WHERE b.barber_id=? AND b.status='confirmed' AND b.booking_date>=?
        ORDER BY b.booking_date,b.booking_time""", (barber_id,now.date().isoformat())).fetchall()
    for row in rows:
        start = minutes(row['booking_time'])
        end = start + row['duration']
        if row['booking_date']==now.date().isoformat() and end<=now.hour*60+now.minute:
            continue
        hours, blocks = schedule_day(connection,barber_id,row['booking_date'])
        if (not hours or start<minutes(hours[0]) or end>minutes(hours[1]) or
                any(start<minutes(b['end']) and minutes(b['start'])<end for b in blocks)):
            raise ValueError(f"Изменение пересекается с подтверждённой записью №{row['id']} ({row['booking_date']} в {row['booking_time']}). Сначала перенесите или отмените эту запись.")


def migrate_catalog():
    """Idempotent atomic migration; never overwrite an existing visit snapshot."""
    from contextlib import closing
    with closing(get_connection()) as connection, connection:
        connection.execute('BEGIN IMMEDIATE')
        for table in ('services', 'barbers'):
            columns = {row['name'] for row in connection.execute(f'PRAGMA table_info({table})')}
            if 'active' not in columns:
                connection.execute(f'ALTER TABLE {table} ADD COLUMN active INTEGER NOT NULL DEFAULT 1')
        columns = {row['name'] for row in connection.execute('PRAGMA table_info(bookings)')}
        for name, kind in (('service_name','TEXT'), ('service_price','INTEGER'),
                           ('service_duration','INTEGER'), ('barber_name','TEXT')):
            if name not in columns:
                connection.execute(f'ALTER TABLE bookings ADD COLUMN {name} {kind}')
        connection.execute("""UPDATE bookings SET
            service_name=COALESCE(service_name,(SELECT name FROM services WHERE id=bookings.service_id)),
            service_price=COALESCE(service_price,(SELECT price FROM services WHERE id=bookings.service_id)),
            service_duration=COALESCE(service_duration,(SELECT duration FROM services WHERE id=bookings.service_id)),
            barber_name=COALESCE(barber_name,(SELECT name FROM barbers WHERE id=bookings.barber_id))
            WHERE service_name IS NULL OR service_price IS NULL OR service_duration IS NULL OR barber_name IS NULL""")
        if connection.execute("""SELECT 1 FROM bookings WHERE service_name IS NULL OR service_price IS NULL
                OR service_duration IS NULL OR barber_name IS NULL LIMIT 1""").fetchone():
            raise ValueError('Не удалось восстановить данные записи: проверьте ссылки на услуги и мастеров.')



def migrate_crm():
    """Additive, atomic and repeatable; keep catalog snapshots and booking IDs intact."""
    from contextlib import closing
    with closing(get_connection()) as connection, connection:
        connection.execute('BEGIN IMMEDIATE')
        connection.execute("""CREATE TABLE IF NOT EXISTS client_profiles (
            phone_key TEXT PRIMARY KEY,
            note TEXT NOT NULL DEFAULT '',
            tags_json TEXT NOT NULL DEFAULT '[]',
            revision INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        columns = {row['name'] for row in connection.execute('PRAGMA table_info(bookings)')}
        if 'comment' not in columns:
            connection.execute("ALTER TABLE bookings ADD COLUMN comment TEXT NOT NULL DEFAULT ''")
        if 'comment_revision' not in columns:
            connection.execute('ALTER TABLE bookings ADD COLUMN comment_revision INTEGER NOT NULL DEFAULT 0')



def migrate_reminders():
    """Add reminder state atomically; repeat startup never rewrites existing data."""
    connection = get_connection()
    try:
        connection.execute('BEGIN IMMEDIATE')
        columns = {row['name'] for row in connection.execute('PRAGMA table_info(bookings)')}
        for name, definition in (
            ('reminded_at', 'TEXT'),
            ('reminder_revision', 'INTEGER NOT NULL DEFAULT 0'),
        ):
            if name not in columns:
                connection.execute(f'ALTER TABLE bookings ADD COLUMN {name} {definition}')
        connection.execute("""CREATE TABLE IF NOT EXISTS booking_reminder_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id INTEGER NOT NULL REFERENCES bookings(id),
            action TEXT NOT NULL,
            reminded_at TEXT,
            booking_date TEXT NOT NULL,
            booking_time TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        connection.execute('CREATE INDEX IF NOT EXISTS idx_reminder_history_booking ON booking_reminder_history(booking_id,id)')
        connection.execute('CREATE INDEX IF NOT EXISTS idx_reminder_dates ON bookings(status,booking_date,booking_time)')
        connection.execute("""CREATE TRIGGER IF NOT EXISTS booking_reminder_reschedule
            AFTER UPDATE OF booking_date,booking_time,service_id,barber_id ON bookings
            WHEN OLD.booking_date IS NOT NEW.booking_date OR OLD.booking_time IS NOT NEW.booking_time
                OR OLD.service_id IS NOT NEW.service_id OR OLD.barber_id IS NOT NEW.barber_id
            BEGIN
                INSERT INTO booking_reminder_history(booking_id,action,reminded_at,booking_date,booking_time)
                VALUES(OLD.id,'reschedule_reset',OLD.reminded_at,OLD.booking_date,OLD.booking_time);
                UPDATE bookings SET reminded_at=NULL,reminder_revision=reminder_revision+1 WHERE id=NEW.id;
            END""")
        connection.execute("""CREATE TRIGGER IF NOT EXISTS booking_reminder_status_revision
            AFTER UPDATE OF status ON bookings WHEN OLD.status IS NOT NEW.status
            BEGIN
                UPDATE bookings SET reminder_revision=reminder_revision+1 WHERE id=NEW.id;
            END""")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == '__main__':
    init_database()
    print(f'База создана: {DATABASE_PATH}')


def get_business_analytics(period='30d', today=None):
    """Read-only snapshot accounting by booking date, in server-local calendar days.

    New = first-ever completed date in range; returning = first completed before
    range plus a completed visit in range. Phone identity matches CRM (digits).
    All-time includes future-dated records already marked completed.
    """
    from datetime import date, timedelta
    from contextlib import closing
    import re

    if period not in ('7d', '30d', 'month', 'previous_month', 'all'):
        raise ValueError('Неизвестный период аналитики.')
    today = today or business_today()
    with closing(get_connection()) as connection:
        connection.create_function('analytics_phone', 1,
                                   lambda value: re.sub(r'\D', '', str(value or '')))
        # One consistent read transaction for all report sections.
        connection.execute('BEGIN')
        bounds = connection.execute(
            'SELECT MIN(booking_date), MAX(booking_date) FROM bookings').fetchone()
        end = today
        if period == 'all':
            start = date.fromisoformat(bounds[0]) if bounds[0] else today
            end = date.fromisoformat(bounds[1]) if bounds[1] else today
        elif period in ('7d', '30d'):
            start = today - timedelta(days=6 if period == '7d' else 29)
        elif period == 'month':
            start = today.replace(day=1)
        else:
            end = today.replace(day=1) - timedelta(days=1)
            start = end.replace(day=1)
        params = (start.isoformat(), end.isoformat())
        scope = 'booking_date BETWEEN ? AND ?'
        kpi = dict(connection.execute(f"""
            SELECT COALESCE(SUM(CASE WHEN status='completed' THEN service_price ELSE 0 END),0) AS revenue,
                   COUNT(CASE WHEN status='completed' THEN 1 END) AS completed,
                   COUNT(CASE WHEN status='cancelled' THEN 1 END) AS cancelled,
                   COUNT(CASE WHEN status='completed' AND service_price IS NULL THEN 1 END) AS missing_prices,
                   COUNT(CASE WHEN status='completed' AND analytics_phone(client_phone)='' THEN 1 END) AS missing_phones
            FROM bookings WHERE {scope}
        """, params).fetchone())
        kpi['average_check'] = kpi['revenue'] / kpi['completed'] if kpi['completed'] else 0
        clients = connection.execute("""
            WITH first_visits AS (
                SELECT analytics_phone(client_phone) AS phone, MIN(booking_date) AS first_date
                FROM bookings WHERE status='completed' AND analytics_phone(client_phone)<>''
                GROUP BY analytics_phone(client_phone)
            ), period_clients AS (
                SELECT DISTINCT analytics_phone(client_phone) AS phone
                FROM bookings WHERE status='completed' AND booking_date BETWEEN ? AND ?
                    AND analytics_phone(client_phone)<>''
            )
            SELECT COUNT(CASE WHEN f.first_date>=? THEN 1 END) AS new_clients,
                   COUNT(CASE WHEN f.first_date<? THEN 1 END) AS returning_clients
            FROM period_clients p JOIN first_visits f ON p.phone=f.phone
        """, params + (params[0], params[0])).fetchone()
        kpi.update(dict(clients))
        def breakdown(kind):
            # Identifiers are fixed internal values, never request input.
            name = 'service_name' if kind == 'services' else 'barber_name'
            identity = 'service_id' if kind == 'services' else 'barber_id'
            return [dict(row) for row in connection.execute(f"""
                SELECT {identity} AS id, COALESCE({name}, 'Без названия') AS name,
                       COUNT(*) AS completed, COALESCE(SUM(service_price),0) AS revenue,
                       COALESCE(SUM(service_price),0)*1.0/COUNT(*) AS average_check,
                       COALESCE(SUM(service_duration),0) AS completed_minutes,
                       COUNT(CASE WHEN service_duration IS NULL THEN 1 END) AS missing_durations
                FROM bookings WHERE {scope} AND status='completed'
                GROUP BY {identity}, {name}
                ORDER BY completed DESC, revenue DESC, name
            """, params)]
        granularity = 'month' if (end-start).days > 92 else 'day'
        expression = "substr(booking_date,1,7)" if granularity == 'month' else 'booking_date'
        grouped = {row['date']: dict(row) for row in connection.execute(f"""
            SELECT {expression} AS date, COUNT(*) AS completed,
                   COALESCE(SUM(service_price),0) AS revenue
            FROM bookings WHERE {scope} AND status='completed'
            GROUP BY {expression} ORDER BY {expression}
        """, params)}
        dynamics = []
        cursor = start.replace(day=1) if granularity == 'month' else start
        while cursor <= end:
            key = cursor.strftime('%Y-%m') if granularity == 'month' else cursor.isoformat()
            dynamics.append(grouped.get(key, {'date': key, 'completed': 0, 'revenue': 0}))
            if granularity == 'month':
                cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
            else:
                cursor += timedelta(days=1)
        return {
            'period': {'key': period, 'start': params[0], 'end': params[1],
                       'inclusive': True, 'timezone': BUSINESS_TIMEZONE, 'date_basis': 'booking_date',
                       'as_of': today.isoformat(), 'granularity': granularity},
            'definitions': {
                'revenue': 'Только completed: сумма сохранённых service_price. Дата — дата визита, не оплаты.',
                'clients': 'Телефон: только цифры, как в CRM. Новые — первый выполненный визит в периоде. Повторные — выполненный визит в периоде и первый выполненный до начала периода. Категории не пересекаются; пустые телефоны исключены.',
                'masters': 'Группы по ID и сохранённому имени: переименование даёт отдельную строку истории. Минуты — сумма длительности выполненных визитов, не процент загрузки.',
                'period': f'Границы включительно, часовой пояс {BUSINESS_TIMEZONE}. Текущий месяц — по сегодня. Всё время — все даты записей, включая будущие.',
                'snapshots': 'Услуги и мастера сгруппированы по ID и snapshot-имени; текущий каталог не используется.'
            },
            'kpi': kpi, 'services': breakdown('services'), 'barbers': breakdown('barbers'),
            'dynamics': dynamics
        }
