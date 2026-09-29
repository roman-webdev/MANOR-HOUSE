from datetime import datetime, date, timedelta
import hmac
import os
import re
import sqlite3
import json
import unicodedata
from functools import wraps
from contextlib import closing as close_connection
from zoneinfo import ZoneInfo

import requests

from flask import (
    Flask,
    jsonify,
    request,
    send_from_directory,
    session
)

from flask_cors import CORS
from dotenv import load_dotenv

from database import (
    get_connection, init_schedules, schedule_day, schedule_snapshot,
    check_schedule_conflicts,
    init_database,
    get_services,
    get_barbers,
    find_service_by_name,
    find_barber_by_name,
    get_bookings_for_barber_date,
    create_booking_safely,
    get_all_bookings,
    update_booking_status
)


load_dotenv()


APP_ENV = os.getenv(
    "APP_ENV",
    "development"
).strip().lower()

BUSINESS_TIMEZONE = os.getenv(
    "BUSINESS_TIMEZONE",
    "Europe/Kyiv"
)
BUSINESS_TZ = ZoneInfo(BUSINESS_TIMEZONE)


def business_now():
    return datetime.now(BUSINESS_TZ)


def business_today():
    return business_now().date()


SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY не настроен. Добавьте его в .env локально "
        "или в Environment на сервере."
    )

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
if not ADMIN_PASSWORD:
    raise RuntimeError(
        "ADMIN_PASSWORD не настроен. Добавьте его в .env локально "
        "или в Environment на сервере."
    )

TELEGRAM_BOT_TOKEN = os.getenv(
    "TELEGRAM_BOT_TOKEN"
)

TELEGRAM_CHAT_ID = os.getenv(
    "TELEGRAM_CHAT_ID"
)


app = Flask(__name__)
app.secret_key = SECRET_KEY

app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=(APP_ENV == "production"),
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12)
)

@app.route("/")
def frontend():
    return send_from_directory(
        ".",
        "index.html"
    )


@app.route("/<path:filename>")
def frontend_files(filename):
    allowed_extensions = {
        ".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".webp",
        ".svg", ".ico", ".gif", ".avif", ".woff", ".woff2", ".ttf"
    }
    parts = filename.replace("\\", "/").split("/")
    if (any(part.startswith(".") for part in parts)
            or os.path.splitext(filename)[1].lower() not in allowed_extensions):
        return "Not found", 404
    return send_from_directory(
        ".",
        filename
    )

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "http://127.0.0.1:5500",
                "http://localhost:5500"
            ]
        }
    }
)


@app.after_request
def add_security_headers(response):
    response.headers.setdefault(
        "X-Content-Type-Options",
        "nosniff"
    )
    response.headers.setdefault(
        "X-Frame-Options",
        "DENY"
    )
    response.headers.setdefault(
        "Referrer-Policy",
        "strict-origin-when-cross-origin"
    )
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()"
    )

    if request.path.startswith("/api/admin/"):
        response.headers["Cache-Control"] = "no-store"

    return response


BARBER_SCHEDULES = {
    "Максим": {
        0: ("10:00", "19:00"),
        1: ("10:00", "19:00"),
        2: ("10:00", "19:00"),
        3: ("10:00", "19:00"),
        4: ("10:00", "20:00"),
        5: ("10:00", "20:00")
    },

    "Александр": {
        1: ("11:00", "20:00"),
        2: ("11:00", "20:00"),
        3: ("11:00", "20:00"),
        4: ("11:00", "21:00"),
        5: ("10:00", "20:00"),
        6: ("10:00", "18:00")
    },

    "Артём": {
        0: ("10:00", "19:00"),
        1: ("10:00", "19:00"),
        3: ("10:00", "19:00"),
        4: ("10:00", "20:00"),
        5: ("10:00", "20:00"),
        6: ("10:00", "18:00")
    }
}

SLOT_INTERVAL_MINUTES = 30
BOOKING_HORIZON_DAYS = 30


def clean_text(value):
    return str(value or "").strip()


def is_valid_phone(phone):
    cleaned_phone = re.sub(
        r"[\s()-]",
        "",
        phone
    )

    return bool(
        re.fullmatch(
            r"\+?\d{10,15}",
            cleaned_phone
        )
    )


def time_to_minutes(time_value):
    hours, minutes = map(
        int,
        time_value.split(":")
    )

    return hours * 60 + minutes


def minutes_to_time(total_minutes):
    hours = total_minutes // 60
    minutes = total_minutes % 60

    return f"{hours:02d}:{minutes:02d}"


def is_valid_booking_date(date_value):
    try:
        parsed_date = datetime.strptime(
            date_value,
            "%Y-%m-%d"
        ).date()

    except ValueError:
        return False

    today = business_today()
    return today <= parsed_date <= today + timedelta(days=BOOKING_HORIZON_DAYS)


@app.route("/api/booking-window", methods=["GET"])
def booking_window():
    today = business_today()
    response = jsonify({
        "min_date": today.isoformat(),
        "max_date": (today + timedelta(days=BOOKING_HORIZON_DAYS)).isoformat()
    })
    response.headers["Cache-Control"] = "no-store"
    return response


def intervals_overlap(
    start_a,
    end_a,
    start_b,
    end_b
):
    return (
        start_a < end_b
        and start_b < end_a
    )


def get_available_times(
    barber_id,
    barber_name,
    booking_date,
    service_duration,
    connection=None,
    exclude_booking_id=None
):
    if connection is None:
        with close_connection(get_connection()) as connection:
            connection.execute("BEGIN")
            return get_available_times(
                barber_id, barber_name, booking_date, service_duration,
                connection, exclude_booking_id
            )
    parsed_date = datetime.strptime(
        booking_date,
        "%Y-%m-%d"
    ).date()

    working_hours, blocks = schedule_day(connection, barber_id, booking_date)

    if not working_hours:
        return []


    opening_time, closing_time = (
        working_hours
    )

    opening = time_to_minutes(
        opening_time
    )

    closing = time_to_minutes(
        closing_time
    )


    booking_sql = """
        SELECT b.booking_time, b.service_duration AS duration FROM bookings b
        WHERE b.barber_id=? AND b.booking_date=? AND b.status='confirmed'
    """
    booking_params = [barber_id, booking_date]
    if exclude_booking_id is not None:
        booking_sql += " AND b.id != ?"
        booking_params.append(exclude_booking_id)
    bookings = connection.execute(booking_sql, booking_params).fetchall()
    occupied_intervals = [(time_to_minutes(b["start"]), time_to_minutes(b["end"])) for b in blocks]

    for booking in bookings:

        start = time_to_minutes(
            booking["booking_time"]
        )

        end = (
            start
            + booking["duration"]
        )

        occupied_intervals.append(
            (start, end)
        )


    now = business_now()

    is_today = (
        parsed_date == now.date()
    )

    current_minutes_now = (
        now.hour * 60
        + now.minute
    )


    available_times = []

    current = opening


    while (
        current + service_duration
        <= closing
    ):

        candidate_end = (
            current
            + service_duration
        )


        if (
            is_today
            and current <= current_minutes_now
        ):
            current += SLOT_INTERVAL_MINUTES
            continue


        has_conflict = False

        for (
            occupied_start,
            occupied_end
        ) in occupied_intervals:

            if intervals_overlap(
                current,
                candidate_end,
                occupied_start,
                occupied_end
            ):
                has_conflict = True
                break


        if not has_conflict:
            available_times.append(
                minutes_to_time(current)
            )


        current += SLOT_INTERVAL_MINUTES


    return available_times

def send_telegram_booking(
    booking_id,
    client_name,
    client_phone,
    service_name,
    service_price,
    service_duration,
    barber_name,
    booking_date,
    booking_time
):
    if (
        not TELEGRAM_BOT_TOKEN
        or not TELEGRAM_CHAT_ID
    ):
        print(
            "Telegram: TELEGRAM_BOT_TOKEN "
            "или TELEGRAM_CHAT_ID не настроены."
        )
        return False

    try:
        parsed_date = datetime.strptime(
            booking_date,
            "%Y-%m-%d"
        )

        formatted_date = parsed_date.strftime(
            "%d.%m.%Y"
        )

    except ValueError:
        formatted_date = booking_date

    message = (
        "✂️ Новая запись MANOR HOUSE\n\n"

        f"👤 Клиент: {client_name}\n"
        f"📞 Телефон: {client_phone}\n\n"

        f"✂️ Услуга: {service_name}\n"
        f"💈 Мастер: {barber_name}\n"
        f"📅 Дата: {formatted_date}\n"
        f"🕐 Время: {booking_time}\n"
        f"⏱ Длительность: "
        f"{service_duration} мин.\n"
        f"💰 Стоимость: "
        f"{service_price} ₴\n\n"

        f"🆔 Booking ID: {booking_id}"
    )

    telegram_url = (
        "https://api.telegram.org/"
        f"bot{TELEGRAM_BOT_TOKEN}/"
        "sendMessage"
    )

    try:
        response = requests.post(
            telegram_url,
            json={
                "chat_id": TELEGRAM_CHAT_ID,
                "text": message
            },
            timeout=10
        )

        if not response.ok:
            print(
                "Telegram API error:",
                response.status_code
            )
            return False

        print(
            f"Telegram: уведомление отправлено "
            f"для booking #{booking_id}"
        )

        return True

    except requests.RequestException:
        print(
            "Telegram connection error"
        )
        return False


def send_telegram_reschedule(
    booking_id,
    client_name,
    client_phone,
    old_service,
    old_barber,
    old_date,
    old_time,
    new_service,
    new_barber,
    new_date,
    new_time
):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return False

    def display_date(value):
        try:
            return datetime.strptime(value, "%Y-%m-%d").strftime("%d.%m.%Y")
        except ValueError:
            return value

    message = (
        "🔄 Запись перенесена MANOR HOUSE\n\n"
        f"👤 Клиент: {client_name}\n"
        f"📞 Телефон: {client_phone}\n\n"
        f"Было: {display_date(old_date)} · {old_time} · {old_barber} · {old_service}\n"
        f"Стало: {display_date(new_date)} · {new_time} · {new_barber} · {new_service}\n\n"
        f"🆔 Booking ID: {booking_id}"
    )

    try:
        response = requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": message},
            timeout=10
        )
        return response.ok
    except requests.RequestException:
        return False


@app.route(
    "/api/health",
    methods=["GET"]
)
def health():
    return jsonify({
        "status": "ok",
        "service": "MANOR HOUSE API"
    }), 200


@app.route(
    "/api/services",
    methods=["GET"]
)
def services():
    return jsonify(
        get_services()
    ), 200


@app.route(
    "/api/barbers",
    methods=["GET"]
)
def barbers():
    return jsonify(
        get_barbers()
    ), 200


@app.route(
    "/api/availability",
    methods=["GET"]
)
def availability():

    barber_name = clean_text(
        request.args.get("barber")
    )

    service_name = clean_text(
        request.args.get("service")
    )

    booking_date = clean_text(
        request.args.get("date")
    )

    if not barber_name:
        return jsonify({
            "success": False,
            "message": "Не указан мастер."
        }), 400

    if not service_name:
        return jsonify({
            "success": False,
            "message": "Не указана услуга."
        }), 400

    if not is_valid_booking_date(
        booking_date
    ):
        return jsonify({
            "success": False,
            "message": "Выберите дату от сегодня до 30 дней вперёд включительно."
        }), 400

    barber = find_barber_by_name(
        barber_name
    )

    service = find_service_by_name(
        service_name
    )

    if not barber:
        return jsonify({
            "success": False,
            "message": "Мастер не найден."
        }), 404

    if not service:
        return jsonify({
            "success": False,
            "message": "Услуга не найдена."
        }), 404

    exclude_booking_id = None
    raw_exclude = clean_text(request.args.get("exclude_booking_id"))
    if raw_exclude and is_admin_authenticated():
        try:
            exclude_booking_id = int(raw_exclude)
        except ValueError:
            return jsonify({
                "success": False,
                "message": "Некорректный ID записи."
            }), 400

    available_times = get_available_times(
        barber["id"],
        barber["name"],
        booking_date,
        service["duration"],
        exclude_booking_id=exclude_booking_id
    )

    return jsonify({
        "success": True,
        "barber": barber["name"],
        "service": service["name"],
        "date": booking_date,
        "available_times": available_times
    }), 200


@app.route(
    "/api/bookings",
    methods=["POST"]
)
def bookings():
    return create_booking_response()


@app.route("/api/admin/bookings", methods=["POST"])
def admin_create_booking():
    if not is_admin_authenticated():
        return jsonify({
            "success": False,
            "message": "Требуется авторизация."
        }), 401
    return create_booking_response()


def create_booking_response():
    """Shared validation, atomic reservation and notification for both forms."""

    if not request.is_json:
        return jsonify({
            "success": False,
            "message": "Ожидаются данные JSON."
        }), 415

    data = request.get_json(
        silent=True
    )

    if not isinstance(data, dict):
        return jsonify({
            "success": False,
            "message": "Некорректные данные."
        }), 400

    client_name = clean_text(
        data.get("name")
    )

    client_phone = clean_text(
        data.get("phone")
    )

    service_name = clean_text(
        data.get("service")
    )

    barber_name = clean_text(
        data.get("master")
    )

    booking_date = clean_text(
        data.get("date")
    )

    booking_time = clean_text(
        data.get("time")
    )


    if len(client_name) < 2:
        return jsonify({
            "success": False,
            "message": "Введите корректное имя."
        }), 400


    if not is_valid_phone(
        client_phone
    ):
        return jsonify({
            "success": False,
            "message": "Введите корректный телефон."
        }), 400


    if not is_valid_booking_date(
        booking_date
    ):
        return jsonify({
            "success": False,
            "message": "Выберите дату от сегодня до 30 дней вперёд включительно."
        }), 400


    barber = find_barber_by_name(
        barber_name
    )

    service = find_service_by_name(
        service_name
    )


    if not barber:
        return jsonify({
            "success": False,
            "message": "Мастер не найден."
        }), 404


    if not service:
        return jsonify({
            "success": False,
            "message": "Услуга не найдена."
        }), 404


    available_times = get_available_times(
        barber["id"],
        barber["name"],
        booking_date,
        service["duration"]
    )


    if booking_time not in available_times:
        return jsonify({
            "success": False,
            "message": (
                "Это время уже занято "
                "или недоступно."
            )
        }), 409


    booking_id = create_booking_safely(
        client_name=client_name,
        client_phone=client_phone,
        service_id=service["id"],
        barber_id=barber["id"],
        booking_date=booking_date,
        booking_time=booking_time,
        service_duration=service["duration"],
        availability_guard=lambda connection: (
            is_valid_booking_date(booking_date) and booking_time in get_available_times(
                barber["id"], barber["name"], booking_date, service["duration"], connection
            )
        )
    )


    if booking_id is None:
        return jsonify({
            "success": False,
            "message": (
                "К сожалению, это время "
                "только что занял другой клиент. "
                "Выберите другое время."
            )
        }), 409

    # Use the committed visit snapshot, including changes made during request validation.
    with close_connection(get_connection()) as connection:
        saved = connection.execute('SELECT service_name,service_price,service_duration,barber_name FROM bookings WHERE id=?', (booking_id,)).fetchone()
    service = {**service, 'name':saved['service_name'], 'price':saved['service_price'], 'duration':saved['service_duration']}
    barber = {**barber, 'name':saved['barber_name']}
    telegram_sent = send_telegram_booking(
        booking_id=booking_id,
        client_name=client_name,
        client_phone=client_phone,
        service_name=service["name"],
        service_price=service["price"],
        service_duration=service["duration"],
        barber_name=barber["name"],
        booking_date=booking_date,
        booking_time=booking_time
    )

    return jsonify({
        "success": True,
        "booking_id": booking_id,
        "notification_sent": telegram_sent,
        "message": "Запись успешно создана.",
        "booking": {
            "name": client_name,
            "phone": client_phone,
            "service": service["name"],
            "price": service["price"],
            "duration": service["duration"],
            "master": barber["name"],
            "date": booking_date,
            "time": booking_time
        }
    }), 201

def is_admin_authenticated():
    return (
        session.get("admin_authenticated")
        is True
    )


@app.route(
    "/api/admin/auth",
    methods=["GET"]
)
def admin_auth_status():
    return jsonify({
        "authenticated":
            is_admin_authenticated()
    }), 200


@app.route(
    "/api/admin/login",
    methods=["POST"]
)
def admin_login():

    if not ADMIN_PASSWORD:
        return jsonify({
            "success": False,
            "message":
                "Пароль администратора не настроен."
        }), 500

    if not request.is_json:
        return jsonify({
            "success": False,
            "message": "Ожидаются данные JSON."
        }), 415

    data = request.get_json(
        silent=True
    )

    if not isinstance(data, dict):
        return jsonify({
            "success": False,
            "message": "Некорректные данные."
        }), 400

    password = clean_text(
        data.get("password")
    )

    if not hmac.compare_digest(password, ADMIN_PASSWORD):
        return jsonify({
            "success": False,
            "message": "Неверный пароль."
        }), 401

    session.clear()

    session.permanent = True
    session["admin_authenticated"] = True

    return jsonify({
        "success": True,
        "message": "Вход выполнен."
    }), 200


@app.route(
    "/api/admin/logout",
    methods=["POST"]
)
def admin_logout():

    session.clear()

    return jsonify({
        "success": True,
        "message": "Вы вышли из системы."
    }), 200


def normalize_client_phone(phone):
    """Stable CRM key: compare phone numbers by digits only."""
    return re.sub(r"\D", "", str(phone or ""))



# CRM metadata is separate from visit accounting and catalog snapshots.
def crm_profile(row=None):
    return {
        "note": row["note"] if row else "",
        "tags": json.loads(row["tags_json"]) if row else [],
        "revision": row["revision"] if row else 0
    }


def crm_text(value, limit, label):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f"{label}: не более {limit} символов.")
    value = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if any(unicodedata.category(char) in ('Cc', 'Cs') and char not in '\n\t' for char in value):
        raise ValueError(f"{label}: недопустимые управляющие символы.")
    return value


def crm_payload():
    # JSON-only writes also prevent cross-site HTML form submissions.
    if request.content_length and request.content_length > 65536:
        raise ValueError("Слишком большой запрос.")
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValueError("Ожидается JSON-объект.")
    revision = data.get('revision')
    if type(revision) is not int or revision < 0:
        raise ValueError("Обновите карточку перед сохранением.")
    return data


@app.route('/api/admin/clients/<phone>/profile', methods=['GET', 'PUT'])
def admin_client_profile(phone):
    if not is_admin_authenticated():
        return jsonify(success=False, message='Требуется авторизация.'), 401
    key = normalize_client_phone(phone)
    if not key or len(key) > 32:
        return jsonify(success=False, message='Некорректный телефон.'), 400
    try:
        with close_connection(get_connection()) as connection, connection:
            if request.method == 'PUT':
                data = crm_payload()
                note = crm_text(data.get('note'), 4000, 'Заметка')
                tags = data.get('tags')
                if not isinstance(tags, list) or len(tags) > 12:
                    raise ValueError('Можно добавить не более 12 тегов.')
                cleaned, seen = [], set()
                for tag in tags:
                    tag = unicodedata.normalize('NFC', crm_text(tag, 32, 'Тег'))
                    if not tag or any(unicodedata.category(c).startswith('C') for c in tag):
                        raise ValueError('Тег должен содержать 1–32 символа без переносов строк.')
                    tag = ' '.join(tag.split())
                    if tag.casefold() not in seen:
                        cleaned.append(tag)
                        seen.add(tag.casefold())
                connection.execute('BEGIN IMMEDIATE')
            row = connection.execute('SELECT * FROM client_profiles WHERE phone_key=?', (key,)).fetchone()
            # Use precisely the same phone normalization as Clients aggregation.
            exists = row is not None or any(normalize_client_phone(r['client_phone']) == key
                for r in connection.execute('SELECT DISTINCT client_phone FROM bookings'))
            if not exists:
                return jsonify(success=False, message='Клиент не найден.'), 404
            if request.method == 'PUT':
                if data['revision'] != (row['revision'] if row else 0):
                    return jsonify(success=False, message='Карточка изменена в другой вкладке. Скопируйте свои правки и откройте карточку заново.'), 409
                connection.execute("""INSERT INTO client_profiles(phone_key,note,tags_json,revision)
                    VALUES(?,?,?,1) ON CONFLICT(phone_key) DO UPDATE SET
                    note=excluded.note,tags_json=excluded.tags_json,
                    revision=client_profiles.revision+1,updated_at=CURRENT_TIMESTAMP""",
                    (key, note, json.dumps(cleaned, ensure_ascii=False)))
                row = connection.execute('SELECT * FROM client_profiles WHERE phone_key=?', (key,)).fetchone()
            response = jsonify(success=True, profile=crm_profile(row))
            response.headers['Cache-Control'] = 'no-store'
            return response
    except sqlite3.OperationalError:
        return jsonify(success=False, message='База временно недоступна. Повторите сохранение.'), 503
    except ValueError as error:
        return jsonify(success=False, message=str(error)), 400


@app.route('/api/admin/bookings/<int:booking_id>/comment', methods=['GET', 'PUT'])
def admin_booking_comment(booking_id):
    if not is_admin_authenticated():
        return jsonify(success=False, message='Требуется авторизация.'), 401
    try:
        with close_connection(get_connection()) as connection, connection:
            if request.method == 'PUT':
                data = crm_payload()
                comment = crm_text(data.get('comment'), 2000, 'Комментарий')
                connection.execute('BEGIN IMMEDIATE')
            row = connection.execute('SELECT comment,comment_revision FROM bookings WHERE id=?', (booking_id,)).fetchone()
            if row is None:
                return jsonify(success=False, message='Запись не найдена.'), 404
            if request.method == 'PUT':
                if data['revision'] != row['comment_revision']:
                    return jsonify(success=False, message='Комментарий изменён в другой вкладке. Скопируйте свои правки и откройте его заново.'), 409
                connection.execute('UPDATE bookings SET comment=?,comment_revision=comment_revision+1 WHERE id=?', (comment, booking_id))
                row = connection.execute('SELECT comment,comment_revision FROM bookings WHERE id=?', (booking_id,)).fetchone()
            response = jsonify(success=True, comment=row['comment'], revision=row['comment_revision'])
            response.headers['Cache-Control'] = 'no-store'
            return response
    except sqlite3.OperationalError:
        return jsonify(success=False, message='База временно недоступна. Повторите сохранение.'), 503
    except ValueError as error:
        return jsonify(success=False, message=str(error)), 400


def build_clients_crm():
    """Aggregate visit snapshots and attach persistent CRM metadata."""
    with close_connection(get_connection()) as connection:
        rows = connection.execute("""
            SELECT
                b.id,
                b.comment,
                b.comment_revision,
                b.client_name,
                b.client_phone,
                b.booking_date,
                b.booking_time,
                b.status,
                b.barber_name AS barber_name,
                b.service_name AS service_name,
                b.service_price AS service_price,
                b.service_duration AS service_duration
            FROM bookings b
            ORDER BY b.booking_date DESC, b.booking_time DESC, b.id DESC
        """).fetchall()

        profiles = {r['phone_key']: crm_profile(r) for r in
                    connection.execute('SELECT * FROM client_profiles')}

    clients = {}

    for row in rows:
        item = dict(row)
        phone_key = normalize_client_phone(item["client_phone"])
        if not phone_key:
            continue

        client = clients.setdefault(phone_key, {
            "key": phone_key,
            **profiles.get(phone_key, crm_profile()),
            "name": item["client_name"],
            "phone": item["client_phone"],
            "total_bookings": 0,
            "completed": 0,
            "cancelled": 0,
            "confirmed": 0,
            "total_spent": 0,
            "last_visit": None,
            "favorite_barber": None,
            "history": [],
            "_barbers": {}
        })

        # Rows are newest first, so the first occurrence supplies current display data.
        if client["total_bookings"] == 0:
            client["name"] = item["client_name"]
            client["phone"] = item["client_phone"]

        client["total_bookings"] += 1

        status = item["status"]
        if status == "completed":
            client["completed"] += 1
            client["total_spent"] += float(item["service_price"] or 0)
            if client["last_visit"] is None:
                client["last_visit"] = item["booking_date"]
            barber_name = item["barber_name"]
            client["_barbers"][barber_name] = client["_barbers"].get(barber_name, 0) + 1
        elif status == "cancelled":
            client["cancelled"] += 1
        elif status == "confirmed":
            client["confirmed"] += 1

        client["history"].append({
            "id": item["id"],
            "comment": item["comment"],
            "comment_revision": item["comment_revision"],
            "date": item["booking_date"],
            "time": item["booking_time"],
            "status": status,
            "barber": item["barber_name"],
            "service": item["service_name"],
            "price": item["service_price"],
            "duration": item["service_duration"]
        })

    result = []
    for client in clients.values():
        if client["_barbers"]:
            client["favorite_barber"] = sorted(
                client["_barbers"].items(),
                key=lambda pair: (-pair[1], pair[0].lower())
            )[0][0]
        client.pop("_barbers", None)
        result.append(client)

    result.sort(key=lambda item: (item["name"] or "").lower())
    return result


@app.route("/api/admin/clients", methods=["GET"])
def admin_clients():
    if not is_admin_authenticated():
        return jsonify({
            "success": False,
            "message": "Требуется авторизация."
        }), 401

    clients = build_clients_crm()
    return jsonify({
        "success": True,
        "clients": clients,
        "count": len(clients)
    }), 200


@app.route(
    "/api/admin/bookings",
    methods=["GET"]
)
def admin_bookings():

    if not is_admin_authenticated():
        return jsonify({
            "success": False,
            "message":
                "Требуется авторизация."
        }), 401

    bookings_list = get_all_bookings()

    return jsonify({
        "success": True,
        "bookings": bookings_list
    }), 200


@app.route("/api/admin/bookings/<int:booking_id>/reschedule", methods=["PATCH"])
def admin_reschedule_booking(booking_id):
    if not is_admin_authenticated():
        return jsonify(success=False, message="Требуется авторизация."), 401
    if not request.is_json:
        return jsonify(success=False, message="Ожидаются данные JSON."), 415

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(success=False, message="Некорректные данные."), 400

    service_name = clean_text(data.get("service"))
    barber_name = clean_text(data.get("master"))
    booking_date = clean_text(data.get("date"))
    booking_time = clean_text(data.get("time"))

    if not is_valid_booking_date(booking_date):
        return jsonify(
            success=False,
            message="Выберите дату от сегодня до 30 дней вперёд включительно."
        ), 400

    service = find_service_by_name(service_name)
    barber = find_barber_by_name(barber_name)
    if not service:
        return jsonify(success=False, message="Услуга не найдена."), 404
    if not barber:
        return jsonify(success=False, message="Мастер не найден."), 404

    telegram_payload = None

    try:
        with close_connection(get_connection()) as connection:
            connection.execute("BEGIN IMMEDIATE")

            service = connection.execute('SELECT * FROM services WHERE id=? AND active=1', (service['id'],)).fetchone()
            barber = connection.execute('SELECT * FROM barbers WHERE id=? AND active=1', (barber['id'],)).fetchone()
            if not service or not barber:
                return jsonify(success=False, message='Услуга или мастер отключены. Обновите список.'), 409

            current = connection.execute("""
                SELECT
                    b.id, b.client_name, b.client_phone, b.booking_date,
                    b.booking_time, b.status,
                    b.service_name AS service_name,
                    b.barber_name AS barber_name
                FROM bookings b
                WHERE b.id = ?
            """, (booking_id,)).fetchone()

            if not current:
                connection.rollback()
                return jsonify(success=False, message="Запись не найдена."), 404

            if current["status"] != "confirmed":
                connection.rollback()
                return jsonify(
                    success=False,
                    message="Переносить можно только подтверждённую запись."
                ), 409

            available_times = get_available_times(
                barber["id"],
                barber["name"],
                booking_date,
                service["duration"],
                connection=connection,
                exclude_booking_id=booking_id
            )

            if booking_time not in available_times:
                connection.rollback()
                return jsonify(
                    success=False,
                    message="Это время уже занято или недоступно."
                ), 409

            connection.execute("""
                UPDATE bookings
                SET service_id = ?, barber_id = ?, booking_date = ?, booking_time = ?,
                    service_name = ?, service_price = ?, service_duration = ?, barber_name = ?
                WHERE id = ? AND status = 'confirmed'
            """, (
                service["id"], barber["id"], booking_date, booking_time,
                service["name"], service["price"], service["duration"], barber["name"], booking_id
            ))
            connection.commit()

            telegram_payload = {
                "booking_id": booking_id,
                "client_name": current["client_name"],
                "client_phone": current["client_phone"],
                "old_service": current["service_name"],
                "old_barber": current["barber_name"],
                "old_date": current["booking_date"],
                "old_time": current["booking_time"],
                "new_service": service["name"],
                "new_barber": barber["name"],
                "new_date": booking_date,
                "new_time": booking_time
            }

    except sqlite3.OperationalError:
        return jsonify(
            success=False,
            message="База временно недоступна. Повторите действие."
        ), 503

    telegram_sent = send_telegram_reschedule(**telegram_payload)

    return jsonify(
        success=True,
        booking_id=booking_id,
        notification_sent=telegram_sent,
        message="Запись успешно перенесена."
    ), 200


@app.route(
    "/api/admin/bookings/<int:booking_id>/status",
    methods=["PATCH"]
)
def admin_update_booking_status(
    booking_id
):

    if not is_admin_authenticated():
        return jsonify({
            "success": False,
            "message":
                "Требуется авторизация."
        }), 401
    
    if not request.is_json:
        return jsonify({
            "success": False,
            "message": "Ожидаются данные JSON."
        }), 415

    data = request.get_json(
        silent=True
    )

    if not isinstance(data, dict):
        return jsonify({
            "success": False,
            "message": "Некорректные данные."
        }), 400

    new_status = clean_text(
        data.get("status")
    )

    allowed_statuses = {
        "confirmed",
        "completed",
        "cancelled"
    }

    if new_status not in allowed_statuses:
        return jsonify({
            "success": False,
            "message": "Некорректный статус."
        }), 400

    try:
        changed = update_booking_status(booking_id, new_status)
    except ValueError as error:
        return jsonify(success=False, message=str(error)), 409

    if not changed:
        return jsonify({
            "success": False,
            "message": "Запись не найдена."
        }), 404

    return jsonify({
        "success": True,
        "booking_id": booking_id,
        "status": new_status
    }), 200

class ScheduleConflictError(Exception):
    def __init__(self, conflicts):
        self.conflicts = conflicts
        count = len(conflicts)
        if count == 1:
            message = (
                "Изменение не сохранено: оно конфликтует с "
                "подтверждённой записью клиента."
            )
        else:
            message = (
                f"Изменение не сохранено: найдено {count} "
                "конфликтующих подтверждённых записей."
            )
        super().__init__(message)


def schedule_admin_only(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not is_admin_authenticated():
            return jsonify(success=False, message="Требуется авторизация."), 401
        # Mutations require same-origin JSON, including DELETE; cross-site forms cannot submit them.
        if request.method != "GET" and not request.is_json:
            return jsonify(success=False, message="Ожидаются данные JSON."), 415
        try:
            return fn(*args, **kwargs)
        except ScheduleConflictError as error:
            return jsonify(
                success=False,
                message=str(error),
                conflicts=error.conflicts
            ), 409
        except ValueError as error:
            return jsonify(success=False, message=str(error)), 400
        except sqlite3.OperationalError:
            return jsonify(success=False, message="База временно недоступна. Повторите действие."), 503
    return wrapped


def schedule_payload():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValueError("Некорректные данные.")
    return data


def schedule_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Укажите дату в формате ГГГГ-ММ-ДД.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ValueError("Некорректная дата.")
    if parsed < business_today():
        raise ValueError("Нельзя изменять прошедшие даты.")
    return value


def schedule_hours(data, block=False):
    working = True if block else data.get('working')
    if type(working) is not bool:
        raise ValueError("Укажите рабочий или выходной день.")
    if not working:
        if data.get('start') is not None or data.get('end') is not None:
            raise ValueError("Для выходного дня часы должны быть пустыми.")
        return 0, None, None
    start, end = data.get('start'), data.get('end')
    for value in (start, end):
        if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            raise ValueError("Укажите время в формате ЧЧ:ММ (00:00–23:59).")
    if start >= end:
        raise ValueError("Время окончания должно быть позже начала. Интервалы через полночь не поддерживаются.")
    return 1, start, end


def find_schedule_booking_conflicts(connection, barber_id, affected_dates=None):
    """Return confirmed future bookings invalidated by the proposed schedule."""
    params = [barber_id, business_today().isoformat()]
    date_filter = ""

    if affected_dates:
        unique_dates = sorted(set(affected_dates))
        placeholders = ",".join("?" for _ in unique_dates)
        date_filter = f" AND b.booking_date IN ({placeholders})"
        params.extend(unique_dates)

    rows = connection.execute(
        f"""
        SELECT
            b.id,
            b.client_name,
            b.client_phone,
            b.booking_date,
            b.booking_time,
            b.service_name AS service_name,
            b.service_duration AS service_duration,
            b.barber_name AS barber_name
        FROM bookings b
        WHERE b.barber_id = ?
          AND b.status = 'confirmed'
          AND b.booking_date >= ?
          {date_filter}
        ORDER BY b.booking_date, b.booking_time, b.id
        """,
        params
    ).fetchall()

    conflicts = []

    for booking in rows:
        working_hours, blocks = schedule_day(
            connection,
            barber_id,
            booking["booking_date"]
        )

        booking_start = time_to_minutes(booking["booking_time"])
        booking_end = booking_start + int(booking["service_duration"])
        reason = None

        if not working_hours:
            reason = "На эту дату мастер отмечен как выходной."
        else:
            opening = time_to_minutes(working_hours[0])
            closing = time_to_minutes(working_hours[1])

            if booking_start < opening or booking_end > closing:
                reason = (
                    "Запись выходит за новые рабочие часы "
                    f"{working_hours[0]}–{working_hours[1]}."
                )
            else:
                for block in blocks:
                    block_start = time_to_minutes(block["start"])
                    block_end = time_to_minutes(block["end"])
                    if intervals_overlap(
                        booking_start,
                        booking_end,
                        block_start,
                        block_end
                    ):
                        reason = (
                            "Запись пересекается с блокировкой "
                            f"{block['start']}–{block['end']}."
                        )
                        break

        if reason:
            conflicts.append({
                "booking_id": booking["id"],
                "client_name": booking["client_name"],
                "client_phone": booking["client_phone"],
                "booking_date": booking["booking_date"],
                "booking_time": booking["booking_time"],
                "service_name": booking["service_name"],
                "service_duration": booking["service_duration"],
                "barber_name": booking["barber_name"],
                "reason": reason
            })

    return conflicts


@app.route('/api/admin/schedules/<int:barber_id>', methods=['GET', 'PUT'])
@app.route('/api/admin/schedules/<int:barber_id>/<kind>', methods=['POST', 'DELETE'])
@schedule_admin_only
def admin_schedule(barber_id, kind=None):
    if kind not in (None, 'exceptions', 'blocks'):
        return jsonify(success=False, message="Раздел не найден."), 404

    with close_connection(get_connection()) as connection, connection:
        connection.execute(
            'BEGIN' if request.method == 'GET' else 'BEGIN IMMEDIATE'
        )

        if not connection.execute(
            'SELECT id FROM barbers WHERE id=? AND (active=1 OR ?=1)',
            (barber_id, int(request.method == 'GET'))
        ).fetchone():
            return jsonify(success=False, message="Мастер не найден."), 404

        if request.method != 'GET':
            data = schedule_payload()
            affected_dates = None
            can_reduce_availability = False

            if kind is None:
                weekly = data.get('weekly')
                if not isinstance(weekly, list) or len(weekly) != 7:
                    raise ValueError("Нужен график на все семь дней недели.")

                seen = set()
                for item in weekly:
                    if (
                        not isinstance(item, dict)
                        or type(item.get('weekday')) is not int
                        or item['weekday'] not in range(7)
                        or item['weekday'] in seen
                    ):
                        raise ValueError(
                            "Дни недели должны быть уникальными: от 0 до 6."
                        )

                    seen.add(item['weekday'])
                    working, start, end = schedule_hours(item)
                    connection.execute(
                        '''UPDATE barber_weekly
                           SET working=?, start=?, end=?
                           WHERE barber_id=? AND weekday=?''',
                        (working, start, end, barber_id, item['weekday'])
                    )

                can_reduce_availability = True

            elif kind == 'exceptions':
                day = schedule_date(data.get('date'))

                if request.method == 'DELETE':
                    connection.execute(
                        'DELETE FROM barber_exceptions WHERE barber_id=? AND date=?',
                        (barber_id, day)
                    )
                else:
                    working, start, end = schedule_hours(data)
                    connection.execute(
                        '''INSERT INTO barber_exceptions(
                               barber_id, date, working, start, end
                           ) VALUES(?,?,?,?,?)
                           ON CONFLICT(barber_id,date) DO UPDATE SET
                               working=excluded.working,
                               start=excluded.start,
                               end=excluded.end''',
                        (barber_id, day, working, start, end)
                    )
                    affected_dates = [day]
                    can_reduce_availability = True

            elif request.method == 'DELETE':
                if type(data.get('id')) is not int or data['id'] <= 0:
                    raise ValueError("Некорректная блокировка.")

                connection.execute(
                    'DELETE FROM barber_blocks WHERE barber_id=? AND id=?',
                    (barber_id, data['id'])
                )

            else:
                day = schedule_date(data.get('date'))
                _, start, end = schedule_hours(data, block=True)
                reason = data.get('reason', '')

                if not isinstance(reason, str) or len(reason) > 200:
                    raise ValueError(
                        "Причина должна содержать не более 200 символов."
                    )

                connection.execute(
                    '''INSERT INTO barber_blocks(
                           barber_id, date, start, end, reason
                       ) VALUES(?,?,?,?,?)
                       ON CONFLICT(barber_id,date,start,end) DO UPDATE SET
                           reason=excluded.reason''',
                    (barber_id, day, start, end, reason.strip())
                )
                affected_dates = [day]
                can_reduce_availability = True

            # Validate the proposed schedule before commit. Any conflict raises
            # inside this transaction, so SQLite rolls the schedule change back.
            if can_reduce_availability:
                conflicts = find_schedule_booking_conflicts(
                    connection,
                    barber_id,
                    affected_dates
                )
                if conflicts:
                    raise ScheduleConflictError(conflicts)

            # Keep the project's original invariant check as a second defence.
            check_schedule_conflicts(connection, barber_id)

        snapshot = schedule_snapshot(connection, barber_id)

    return jsonify(success=True, **snapshot)


@app.after_request
def schedule_no_cache(response):
    if request.path.startswith('/api/admin/') or request.path in ('/api/availability', '/api/services', '/api/barbers'):
        response.headers['Cache-Control'] = 'no-store'
    return response



@app.route('/api/admin/<catalog>', methods=['GET', 'POST'])
@app.route('/api/admin/<catalog>/<int:item_id>', methods=['PATCH'])
@schedule_admin_only
def admin_catalog(catalog, item_id=None):
    if catalog not in ('services', 'barbers'):
        return jsonify(success=False, message='Раздел не найден.'), 404
    with close_connection(get_connection()) as connection, connection:
        connection.execute('BEGIN' if request.method == 'GET' else 'BEGIN IMMEDIATE')
        if request.method == 'GET':
            return jsonify(success=True, items=[dict(r) for r in connection.execute(f'SELECT * FROM {catalog} ORDER BY active DESC,id')])
        current = None
        if item_id is not None:
            current = connection.execute(f'SELECT * FROM {catalog} WHERE id=?', (item_id,)).fetchone()
            if current is None:
                return jsonify(success=False, message='Услуга или мастер не найдены.'), 404
        data = schedule_payload()
        allowed = {'name','active','price','duration'} if catalog == 'services' else {'name','active','position','experience'}
        if set(data) - allowed or not data:
            raise ValueError('Некорректные поля.')
        values = dict(current) if current else {'active': 1}
        values.update(data)
        for field, label in [('name','Название / имя')] + ([('position','Должность')] if catalog == 'barbers' else []):
            value = values.get(field)
            if not isinstance(value, str) or not value.strip() or len(value.strip()) > 120:
                raise ValueError(f'{label}: укажите от 1 до 120 символов.')
            values[field] = value.strip()
        active = values.get('active')
        if type(active) not in (bool, int) or active not in (0,1):
            raise ValueError('Активность должна быть 0 или 1.')
        values['active'] = int(active)
        if catalog == 'services':
            import math
            price = values.get('price')
            if type(price) not in (int,float) or not math.isfinite(price) or price <= 0 or price > 1000000000:
                raise ValueError('Цена должна быть больше 0 и не превышать 1 000 000 000 грн.')
            if type(values.get('duration')) is not int or not 15 <= values['duration'] <= 480:
                raise ValueError('Длительность: целое число от 15 до 480 минут.')
        elif type(values.get('experience')) is not int or not 0 <= values['experience'] <= 2147483647:
            raise ValueError('Опыт: неотрицательное целое число.')
        # Python casefold supports Cyrillic names, unlike SQLite's built-in NOCASE.
        if any(r['id'] != item_id and r['name'].strip().casefold() == values['name'].casefold()
               for r in connection.execute(f'SELECT id,name FROM {catalog}')):
            return jsonify(success=False, message='Такое название / имя уже существует, в том числе среди отключённых.'), 409
        if current and not values['active']:
            key = 'service_id' if catalog == 'services' else 'barber_id'
            now = business_now()
            conflicts = []
            for row in connection.execute(f"SELECT * FROM bookings WHERE {key}=? AND status='confirmed' AND booking_date>=? ORDER BY booking_date,booking_time,id", (item_id,now.date().isoformat())):
                end = datetime.fromisoformat(row['booking_date']+'T'+row['booking_time']) + timedelta(minutes=row['service_duration'])
                if end > now:
                    conflicts.append({**dict(row), 'booking_id':row['id'], 'reason':'Сначала перенесите или отмените запись.'})
            if conflicts:
                return jsonify(success=False, message='Нельзя отключить: есть предстоящие или текущие подтверждённые записи. Сначала перенесите или отмените их.', conflicts=conflicts), 409
        fields = ['name','price','duration','active'] if catalog == 'services' else ['name','position','experience','active']
        try:
            if current:
                connection.execute(f"UPDATE {catalog} SET " + ','.join(f'{key}=?' for key in fields) + ' WHERE id=?', [values[key] for key in fields]+[item_id])
            else:
                cursor = connection.execute(f"INSERT INTO {catalog} ("+','.join(fields)+') VALUES ('+','.join('?' for _ in fields)+')', [values[key] for key in fields])
                item_id = cursor.lastrowid
                if catalog == 'barbers':
                    connection.executemany('INSERT INTO barber_weekly(barber_id,weekday,working,start,end) VALUES(?,?,0,NULL,NULL)', [(item_id,day) for day in range(7)])
        except sqlite3.IntegrityError:
            return jsonify(success=False, message='Такое название / имя уже существует.'), 409
        item = dict(connection.execute(f'SELECT * FROM {catalog} WHERE id=?', (item_id,)).fetchone())
    return jsonify(success=True, item=item), (200 if current else 201)



@app.route('/api/admin/analytics', methods=['GET'])
def admin_business_analytics():
    if not is_admin_authenticated():
        response = jsonify(success=False, message='Требуется авторизация.')
        response.headers['Cache-Control'] = 'no-store'
        return response, 401
    from database import get_business_analytics
    try:
        data = get_business_analytics(request.args.get('period', '30d'))
    except ValueError as error:
        response = jsonify(success=False, message=str(error))
        response.headers['Cache-Control'] = 'no-store'
        return response, 400
    response = jsonify(success=True, **data)
    response.headers['Cache-Control'] = 'no-store'
    return response



@app.route('/api/admin/reminders', methods=['GET'])
def admin_reminders():
    if not is_admin_authenticated():
        return jsonify(success=False, message='Требуется авторизация.'), 401
    today = business_today()
    tomorrow = today + timedelta(days=1)
    try:
        with close_connection(get_connection()) as connection:
            rows = connection.execute("""SELECT id,client_name,client_phone,booking_date,
                booking_time,service_name,barber_name,reminded_at,reminder_revision
                FROM bookings WHERE status='confirmed' AND booking_date IN (?,?)
                ORDER BY booking_date,booking_time,id""", (today.isoformat(), tomorrow.isoformat())).fetchall()
        response = jsonify(success=True, today=today.isoformat(), tomorrow=tomorrow.isoformat(),
                           timezone=BUSINESS_TIMEZONE, reminders=[dict(row) for row in rows])
        response.headers['Cache-Control'] = 'no-store'
        return response
    except sqlite3.OperationalError:
        return jsonify(success=False, message='База временно недоступна. Повторите действие.'), 503


@app.route('/api/admin/bookings/<int:booking_id>/reminder', methods=['PATCH'])
def admin_booking_reminder(booking_id):
    if not is_admin_authenticated():
        return jsonify(success=False, message='Требуется авторизация.'), 401
    if not request.is_json:
        return jsonify(success=False, message='Ожидаются данные JSON.'), 415
    data = request.get_json(silent=True)
    if (not isinstance(data, dict) or type(data.get('reminded')) is not bool
            or type(data.get('revision')) is not int or data['revision'] < 0
            or set(data) != {'reminded', 'revision'}):
        return jsonify(success=False, message='Нужны reminded (boolean) и revision (целое число).'), 400
    try:
        with close_connection(get_connection()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            row = connection.execute('SELECT * FROM bookings WHERE id=?', (booking_id,)).fetchone()
            if row is None:
                return jsonify(success=False, message='Запись не найдена.'), 404
            today = business_today()
            if row['status'] != 'confirmed' or row['booking_date'] not in (
                    today.isoformat(), (today + timedelta(days=1)).isoformat()):
                return jsonify(success=False, message='Запись больше не входит в напоминания на сегодня и завтра.'), 409
            if row['reminder_revision'] != data['revision']:
                return jsonify(success=False, message='Запись изменена. Список обновлён — проверьте новое состояние.'), 409
            if bool(row['reminded_at']) != data['reminded']:
                connection.execute("""UPDATE bookings SET
                    reminded_at=CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
                    reminder_revision=reminder_revision+1 WHERE id=?""", (data['reminded'], booking_id))
                connection.execute("""INSERT INTO booking_reminder_history
                    (booking_id,action,reminded_at,booking_date,booking_time)
                    SELECT id,?,reminded_at,booking_date,booking_time FROM bookings WHERE id=?""",
                    ('marked' if data['reminded'] else 'unmarked', booking_id))
            result = connection.execute('SELECT id,reminded_at,reminder_revision FROM bookings WHERE id=?', (booking_id,)).fetchone()
            response = jsonify(success=True, reminder=dict(result))
            response.headers['Cache-Control'] = 'no-store'
            return response
    except sqlite3.OperationalError:
        return jsonify(success=False, message='База временно недоступна. Повторите действие.'), 503


init_database()
init_schedules(BARBER_SCHEDULES)


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )

