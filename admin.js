const adminLoader =
    document.querySelector("#admin-loader");

const loginScreen =
    document.querySelector("#login-screen");

const loginForm =
    document.querySelector("#login-form");

const passwordInput =
    document.querySelector("#admin-password");

const loginMessage =
    document.querySelector("#login-message");

const adminPanel =
    document.querySelector("#admin-panel");

const logoutButton =
    document.querySelector("#logout-button");

const bookingsList =
    document.querySelector("#bookings-list");

const searchInput =
    document.querySelector("#booking-search");

const periodButtons =
    document.querySelectorAll(".period-filter");

const statusButtons =
    document.querySelectorAll(".status-filter");

const totalCount =
    document.querySelector("#total-count");

const confirmedCount =
    document.querySelector("#confirmed-count");

const completedCount =
    document.querySelector("#completed-count");

const cancelledCount =
    document.querySelector("#cancelled-count");


let bookings = [];
let bookingsTimer = null;
let bookingsAuthenticated = false;
let bookingsLoadInFlight = null;
let bookingsController = null;
let bookingsEpoch = 0;

function stopBookingsPolling() {
    clearInterval(bookingsTimer);
    bookingsTimer = null;
    bookingsEpoch++;
    bookingsController?.abort();
}
function refreshBookingsSilently() {
    if (bookingsAuthenticated && document.visibilityState === 'visible'
        && loginScreen.classList.contains('hidden') && !adminPanel.classList.contains('hidden')) {
        void loadBookings({silent: true});
    }
}
function startBookingsPolling() {
    if (!bookingsTimer) bookingsTimer = setInterval(refreshBookingsSilently, 12000);
}
document.addEventListener('visibilitychange', refreshBookingsSilently);
window.addEventListener('focus', refreshBookingsSilently);
window.addEventListener('pagehide', stopBookingsPolling);
window.addEventListener('pageshow', () => {
    if (bookingsAuthenticated) { startBookingsPolling(); refreshBookingsSilently(); }
});

let currentPeriod = "all";
let currentStatus = "all";
let currentSearch = "";


function getLocalDateString(date) {
    const year = date.getFullYear();

    const month = String(
        date.getMonth() + 1
    ).padStart(2, "0");

    const day = String(
        date.getDate()
    ).padStart(2, "0");

    return `${year}-${month}-${day}`;
}


function formatDate(dateValue) {
    const date = new Date(
        `${dateValue}T00:00:00`
    );

    return date.toLocaleDateString(
        "ru-RU",
        {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }
    );
}


function getStatusLabel(status) {
    const labels = {
        confirmed: "Подтверждена",
        completed: "Выполнена",
        cancelled: "Отменена"
    };

    return labels[status] || status;
}


function showLogin() {
    bookingsAuthenticated = false;
    stopBookingsPolling();
    stopReminders(true);
    resetAnalytics();
    scheduleVersion++;
    scheduleLoadedBarber = '';
    scheduleContent.hidden = true;
    scheduleDirty = false;
    closeConfirmation(true);
    closeBookingModal(true);
    resetCrmEditors();
    adminLoader.classList.add("hidden");

    loginScreen.classList.remove("hidden");
    adminPanel.classList.add("hidden");

    passwordInput.value = "";
    passwordInput.focus();
}


function showAdmin() {
    if (!remindersPanel.hidden) startReminders();
    if (!analyticsPanel.hidden) loadAnalytics();
    if (!clientsPanel.hidden && !clientsLoaded) loadClients();
    if (!schedulePanel.hidden) loadSchedule();
    adminLoader.classList.add("hidden");

    loginScreen.classList.add("hidden");
    adminPanel.classList.remove("hidden");
    bookingsAuthenticated = true;
    startBookingsPolling();
}


function updateStats() {
    totalCount.textContent =
        bookings.length;

    confirmedCount.textContent =
        bookings.filter(
            booking =>
                booking.status === "confirmed"
        ).length;

    completedCount.textContent =
        bookings.filter(
            booking =>
                booking.status === "completed"
        ).length;

    cancelledCount.textContent =
        bookings.filter(
            booking =>
                booking.status === "cancelled"
        ).length;
}


function matchesPeriod(booking) {
    if (currentPeriod === "all") {
        return true;
    }

    const today = new Date();

    const todayString =
        getLocalDateString(today);

    const tomorrow = new Date(today);

    tomorrow.setDate(
        tomorrow.getDate() + 1
    );

    const tomorrowString =
        getLocalDateString(tomorrow);

    if (currentPeriod === "today") {
        return (
            booking.booking_date ===
            todayString
        );
    }

    if (currentPeriod === "tomorrow") {
        return (
            booking.booking_date ===
            tomorrowString
        );
    }

    if (currentPeriod === "future") {
        return (
            booking.booking_date >
            todayString
        );
    }

    return true;
}


function matchesStatus(booking) {
    if (currentStatus === "all") {
        return true;
    }

    return (
        booking.status ===
        currentStatus
    );
}


function matchesSearch(booking) {
    if (!currentSearch) {
        return true;
    }

    const searchText =
        currentSearch.toLowerCase();

    const clientName =
        String(
            booking.client_name || ""
        ).toLowerCase();

    const clientPhone =
        String(
            booking.client_phone || ""
        ).toLowerCase();

    return (
        clientName.includes(searchText)
        ||
        clientPhone.includes(searchText)
    );
}


function getVisibleBookings() {
    return bookings.filter(
        booking =>
            matchesPeriod(booking)
            &&
            matchesStatus(booking)
            &&
            matchesSearch(booking)
    );
}


function renderBookings() {
    const visibleBookings =
        getVisibleBookings();

    if (visibleBookings.length === 0) {
        bookingsList.innerHTML = `
            <div class="empty-state">
                <strong>
                    Записей не найдено
                </strong>

                <span>
                    Измените фильтры или поиск.
                </span>
            </div>
        `;

        return;
    }

    bookingsList.innerHTML =
        visibleBookings.map(
            booking => `
                <article class="booking-card">

                    <div class="booking-date">
                        ${formatDate(
                            booking.booking_date
                        )}
                    </div>

                    <div class="booking-time">
                        ${escapeBookingHtml(booking.booking_time)}
                    </div>

                    <div class="booking-client">

                        <strong>
                            ${escapeBookingHtml(booking.client_name)}
                        </strong>

                        <span>
                            ${escapeBookingHtml(booking.client_phone)}
                        </span>

                    </div>

                    <div class="booking-service">

                        <strong>
                            ${escapeBookingHtml(booking.barber_name)}
                        </strong>

                        <span>
                            Мастер
                        </span>

                    </div>

                    <div class="booking-service">

                        <strong>
                            ${escapeBookingHtml(booking.service_name)}
                        </strong>

                        <span>
                            ${escapeBookingHtml(booking.service_price)} грн ·
                            ${escapeBookingHtml(booking.service_duration)} мин.
                        </span>

                    </div>

                    <div class="booking-status-area">

                        <span
                            class="
                                status
                                status-${escapeBookingHtml(booking.status)}
                            "
                        >
                            ${escapeBookingHtml(getStatusLabel(booking.status))}
                        </span>

                        <div class="booking-actions">
                            <button type="button" class="crm-comment-button" data-booking-comment="${escapeBookingHtml(booking.id)}">${booking.comment ? 'Комментарий •' : '+ Комментарий'}</button>

                            ${
                                booking.status ===
                                "confirmed"
                                    ? `
                                        <button
                                            data-id="${escapeBookingHtml(booking.id)}"
                                            data-reschedule="true"
                                            type="button"
                                        >
                                            Перенести
                                        </button>

                                        <button
                                            data-id="${escapeBookingHtml(booking.id)}"
                                            data-status="completed"
                                            type="button"
                                        >
                                            Выполнена
                                        </button>

                                        <button
                                            data-id="${escapeBookingHtml(booking.id)}"
                                            data-status="cancelled"
                                            type="button"
                                        >
                                            Отменить
                                        </button>
                                    `
                                    : ""
                            }

                        </div>

                    </div>

                </article>
            `
        ).join("");
}


async function checkAuthentication() {
    try {
        const response = await fetch(
            "/api/admin/auth"
        );

        const data = await response.json();

        if (data.authenticated) {
            if (await loadBookings()) showAdmin();
            return;
        }

        showLogin();

    } catch (error) {
        console.error(error);
        showLogin();
    }
}


async function login(password) {
    loginMessage.textContent =
        "Проверяем...";

    try {
        const response = await fetch(
            "/api/admin/login",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    password: password
                })
            }
        );

        const data =
            await response.json();

        if (!response.ok) {
            loginMessage.textContent =
                data.message ||
                "Не удалось выполнить вход.";

            return;
        }

        loginMessage.textContent = "";

        showAdmin();

        await loadBookings();

    } catch (error) {
        console.error(error);

        loginMessage.textContent =
            "Ошибка соединения с сервером.";
    }
}


async function logout() {
    bookingsAuthenticated = false;
    stopBookingsPolling();
    try {
        await fetch(
            "/api/admin/logout",
            {
                method: "POST"
            }
        );

    } catch (error) {
        console.error(error);
    }

    bookings = [];

    showLogin();
}


async function loadBookings({ silent = false } = {}) {
    const epoch = bookingsEpoch;
    if (bookingsLoadInFlight) {
        if (silent) return bookingsLoadInFlight;
        // A save/manual refresh needs a fresh response after the pending GET.
        await bookingsLoadInFlight;
        if (epoch !== bookingsEpoch) return false;
        return loadBookings({silent});
    }
    if (silent && (!bookingsAuthenticated || document.visibilityState !== 'visible')) return false;
    if (!silent) bookingsList.textContent = 'Загрузка записей...';
    const controller = new AbortController();
    bookingsController = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    const previousData = JSON.stringify(bookings);
    const request = (async () => {
        try {
            const response = await fetch('/api/admin/bookings', {
                credentials: 'same-origin', cache: 'no-store', signal: controller.signal
            });
            if (epoch !== bookingsEpoch) return false;
            if (response.status === 401) { showLogin(); return false; }
            const data = await response.json();
            if (epoch !== bookingsEpoch) return false;
            if (!response.ok || !Array.isArray(data.bookings)) throw new Error(data.message || 'Не удалось загрузить записи.');
            // Do not overwrite a local status mutation with a GET started before it.
            if (silent && previousData !== JSON.stringify(bookings)) return true;
            if (!silent || JSON.stringify(data.bookings) !== JSON.stringify(bookings)) {
                const x = window.scrollX, y = window.scrollY;
                const listTop = bookingsList.scrollTop;
                const focused = document.activeElement;
                const focusData = bookingsList.contains(focused) ? {...focused.dataset} : null;
                bookings = data.bookings;
                updateStats();
                renderBookings();
                if (silent) {
                    if (focusData && Object.keys(focusData).length) {
                        const target = [...bookingsList.querySelectorAll('button')].find(button =>
                            Object.entries(focusData).every(([key, value]) => button.dataset[key] === value));
                        target?.focus({preventScroll: true});
                    }
                    bookingsList.scrollTop = listTop;
                    window.scrollTo({left: x, top: y, behavior: 'instant'});
                }
            }
            return true;
        } catch (error) {
            if (epoch !== bookingsEpoch) return false;
            if (!silent) {
                console.error(error);
                bookingsList.textContent = 'Не удалось загрузить записи.';
            }
            return false;
        } finally {
            clearTimeout(timeout);
        }
    })();
    bookingsLoadInFlight = request;
    try { return await request; }
    finally {
        if (bookingsLoadInFlight === request) {
            bookingsLoadInFlight = null;
            bookingsController = null;
        }
    }
}


async function changeStatus(
    bookingId,
    status
) {
    try {
        const response = await fetch(
            `/api/admin/bookings/${bookingId}/status`,
            {
                method: "PATCH",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    status: status
                })
            }
        );

        const data =
            await response.json();

        if (response.status === 401) {
            showLogin();
            throw new Error("Сессия истекла. Войдите снова.");
        }

        if (!response.ok) {
            throw new Error(
                data.message ||
                "Не удалось изменить статус."
            );
        }

        const booking = bookings.find(
            item =>
                item.id === bookingId
        );

        if (booking) {
            booking.status = status;
        }

        updateStats();
        renderBookings();
        clientsLoaded = false;

    } catch (error) {
        console.error(error);

        throw error;
    }
}


loginForm.addEventListener(
    "submit",
    function(event) {
        event.preventDefault();

        const password =
            passwordInput.value;

        if (!password) {
            loginMessage.textContent =
                "Введите пароль.";

            return;
        }

        login(password);
    }
);


logoutButton.addEventListener(
    "click",
    logout
);


searchInput.addEventListener(
    "input",
    function() {
        currentSearch =
            searchInput.value.trim();

        renderBookings();
    }
);


periodButtons.forEach(button => {
    button.addEventListener(
        "click",
        function() {
            periodButtons.forEach(
                item =>
                    item.classList.remove(
                        "active"
                    )
            );

            button.classList.add("active");

            currentPeriod =
                button.dataset.period;

            renderBookings();
        }
    );
});


statusButtons.forEach(button => {
    button.addEventListener(
        "click",
        function() {
            statusButtons.forEach(
                item =>
                    item.classList.remove(
                        "active"
                    )
            );

            button.classList.add("active");

            currentStatus =
                button.dataset.status;

            renderBookings();
        }
    );
});


bookingsList.addEventListener(
    "click",
    function(event) {
        const rescheduleButton = event.target.closest("button[data-reschedule]");
        if (rescheduleButton) {
            const bookingId = Number(rescheduleButton.dataset.id);
            const booking = bookings.find(item => item.id === bookingId);
            if (booking && booking.status === "confirmed") openRescheduleBooking(booking);
            return;
        }

        const button =
            event.target.closest(
                "button[data-status]"
            );

        if (!button) {
            return;
        }

        const bookingId =
            Number(button.dataset.id);

        const status =
            button.dataset.status;

        const booking = bookings.find(item => item.id === bookingId);
        if (!booking || !["cancelled", "completed"].includes(status)) return;
        const cancelling = status === "cancelled";
        openConfirmation({
            title: cancelling ? "Отменить запись?" : "Отметить запись выполненной?",
            description: cancelling
                ? "Время снова станет доступно для клиентов."
                : "Запись будет отмечена как выполненная.",
            details: [
                ["Клиент", booking.client_name],
                ["Дата", booking.booking_date ? formatDate(booking.booking_date) : ""],
                ["Время", booking.booking_time],
                ["Мастер", booking.barber_name]
            ],
            confirmLabel: cancelling ? "Отменить запись" : "Отметить выполненной",
            busyLabel: cancelling ? "Отменяем…" : "Сохраняем…",
            onConfirm: () => changeStatus(bookingId, status)
        });
    }
);


// Native dialog provides focus trapping, Escape support and focus restoration.
const bookingModal = document.querySelector("#booking-modal");
const bookingForm = document.querySelector("#admin-booking-form");
const bookingFields = document.querySelector("#admin-booking-fields");
const serviceSelect = document.querySelector("#admin-service");
const barberSelect = document.querySelector("#admin-barber");
const bookingDateInput = document.querySelector("#admin-date");
const timeSlots = document.querySelector("#admin-time-slots");
const bookingMessage = document.querySelector("#admin-booking-message");
const bookingSummary = document.querySelector("#admin-booking-summary");
const createButton = document.querySelector("#create-booking-button");
const retryButton = document.querySelector("#booking-retry");
let bookingServices = [];
let selectedTime = "";
let bookingBusy = false;
let bookingSaved = false;
let optionsReady = false;
let requestVersion = 0;
let modalVersion = 0;
let oldBodyOverflow = "";
let bookingMode = "create";
let rescheduleBooking = null;
let pendingBookingPreset = null;

function escapeBookingHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
}

function closeBookingModal(force = false) {
    if (bookingBusy && !force) return;
    if (!bookingModal.open) return;
    requestVersion++;
    modalVersion++;
    bookingModal.close();
    document.body.style.overflow = oldBodyOverflow;
}

function updateBookingSummary() {
    const service = bookingServices.find(item => item.name === serviceSelect.value);
    createButton.disabled = bookingBusy || bookingSaved || !selectedTime;
    bookingSummary.textContent = service && barberSelect.value && selectedTime
        ? `${service.name} · ${barberSelect.value}\n${formatDate(bookingDateInput.value)} · ${selectedTime} · ${service.price} грн · ${service.duration} мин.`
        : "Выберите услугу, мастера, дату и свободное время.";
}

async function bookingJson(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
    if (response.status === 401) {
        showLogin();
        loginMessage.textContent = "Сессия истекла. Войдите снова.";
        throw new Error("Требуется авторизация.");
    }
    const data = await response.json();
    if (!response.ok) {
        const error = new Error(data.message || "Не удалось выполнить запрос.");
        error.status = response.status;
        error.data = data;
        error.conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
        throw error;
    }
    return data;
}

function fillBookingSelect(select, placeholder, items, label) {
    select.replaceChildren(new Option(placeholder, ""));
    items.forEach(item => select.add(new Option(label(item), item.name)));
}

async function loadBookingOptions() {
    const version = modalVersion;
    optionsReady = false;
    bookingFields.disabled = true;
    retryButton.hidden = true;
    bookingMessage.textContent = "Загружаем услуги и мастеров…";
    try {
        const [services, barbers, window] = await Promise.all([
            bookingJson("/api/services"), bookingJson("/api/barbers"), bookingJson("/api/booking-window")
        ]);
        if (version !== modalVersion || !bookingModal.open) return;
        if (!Array.isArray(services) || !Array.isArray(barbers) || !services.length || !barbers.length) {
            throw new Error("Нет доступных услуг или мастеров.");
        }
        bookingDateInput.min = window.min_date;
        bookingDateInput.max = window.max_date;
        bookingDateInput.value = window.min_date;
        bookingDateInput.title = "Запись от сегодня до 30 дней вперёд включительно";
        bookingServices = services;
        fillBookingSelect(serviceSelect, "Выберите услугу", services, item => `${item.name} — ${item.price} грн`);
        fillBookingSelect(barberSelect, "Выберите мастера", barbers, item => item.name);
        optionsReady = true;
        bookingMessage.textContent = "";

        if (pendingBookingPreset) {
            const preset = pendingBookingPreset;
            pendingBookingPreset = null;
            serviceSelect.value = preset.service || "";
            barberSelect.value = preset.master || "";
            if (preset.date) bookingDateInput.value = preset.date;
            await loadBookingAvailability();
        }
    } catch (error) {
        if (version !== modalVersion) return;
        bookingMessage.textContent = error.message || "Не удалось загрузить услуги и мастеров.";
        retryButton.hidden = false;
    } finally {
        if (version === modalVersion) bookingFields.disabled = false;
    }
}

async function loadBookingAvailability() {
    const version = ++requestVersion;
    selectedTime = "";
    retryButton.hidden = true;
    updateBookingSummary();
    if (!optionsReady || !serviceSelect.value || !barberSelect.value || !bookingDateInput.value) {
        timeSlots.textContent = "Сначала выберите услугу, мастера и дату.";
        return;
    }
    if (!bookingDateInput.checkValidity()) {
        timeSlots.textContent = "Выберите дату от сегодня до 30 дней вперёд включительно.";
        return;
    }
    timeSlots.textContent = "Проверяем свободное время…";
    const params = new URLSearchParams({service: serviceSelect.value, barber: barberSelect.value, date: bookingDateInput.value});
    if (bookingMode === "reschedule" && rescheduleBooking) {
        params.set("exclude_booking_id", String(rescheduleBooking.id));
    }
    try {
        const data = await bookingJson(`/api/availability?${params}`);
        if (version !== requestVersion || !bookingModal.open) return;
        if (!Array.isArray(data.available_times)) throw new Error("Некорректный ответ расписания.");
        timeSlots.replaceChildren();
        if (!data.available_times.length) timeSlots.textContent = "На эту дату свободного времени нет.";
        data.available_times.forEach(time => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "admin-time-button";
            button.textContent = time;
            button.dataset.time = time;
            button.setAttribute("aria-pressed", "false");
            timeSlots.append(button);
        });
    } catch (error) {
        if (version !== requestVersion) return;
        timeSlots.textContent = error.message || "Не удалось загрузить свободное время.";
        retryButton.hidden = false;
    }
}

function openNewBooking(prefillClient = null) {
    if (bookingModal.open || bookingBusy) return;
    bookingMode = "create";
    rescheduleBooking = null;
    pendingBookingPreset = null;
    modalVersion++;
    bookingForm.reset();
    document.querySelector("#admin-client-name").readOnly = false;
    document.querySelector("#admin-client-phone").readOnly = false;
    bookingSaved = false;
    selectedTime = "";
    createButton.textContent = "Создать запись";
    bookingMessage.classList.remove("success");
    bookingMessage.textContent = "";
    bookingDateInput.min = getLocalDateString(new Date());
    bookingDateInput.value = bookingDateInput.min;
    timeSlots.textContent = "Сначала выберите услугу, мастера и дату.";

    if (prefillClient) {
        document.querySelector("#admin-client-name").value = prefillClient.name || "";
        document.querySelector("#admin-client-phone").value = prefillClient.phone || "";
    }

    updateBookingSummary();
    oldBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    bookingModal.showModal();
    loadBookingOptions();
}

async function openRescheduleBooking(booking) {
    if (bookingModal.open || bookingBusy || !booking || booking.status !== "confirmed") return;

    bookingMode = "reschedule";
    rescheduleBooking = booking;
    pendingBookingPreset = {
        service: booking.service_name,
        master: booking.barber_name,
        date: booking.booking_date
    };

    modalVersion++;
    bookingForm.reset();
    bookingSaved = false;
    selectedTime = "";
    createButton.textContent = "Перенести запись";
    bookingMessage.classList.remove("success");
    bookingMessage.textContent = "";
    document.querySelector("#admin-client-name").value = booking.client_name || "";
    document.querySelector("#admin-client-phone").value = booking.client_phone || "";
    document.querySelector("#admin-client-name").readOnly = true;
    document.querySelector("#admin-client-phone").readOnly = true;
    timeSlots.textContent = "Загружаем доступное время…";
    updateBookingSummary();

    oldBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    bookingModal.showModal();
    await loadBookingOptions();
}

document.querySelector("#new-booking-button").addEventListener("click", () => {
    openNewBooking();
});
document.querySelector("#booking-modal-close").addEventListener("click", () => closeBookingModal());
bookingModal.addEventListener("cancel", event => { event.preventDefault(); closeBookingModal(); });
bookingModal.addEventListener("click", event => {
    const rect = bookingModal.getBoundingClientRect();
    if (event.target === bookingModal && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeBookingModal();
});
[serviceSelect, barberSelect, bookingDateInput].forEach(input => input.addEventListener("change", () => {
    bookingMessage.textContent = "";
    loadBookingAvailability();
}));
retryButton.addEventListener("click", () => optionsReady ? loadBookingAvailability() : loadBookingOptions());
timeSlots.addEventListener("click", event => {
    const button = event.target.closest("button[data-time]");
    if (!button || bookingBusy || bookingSaved) return;
    selectedTime = button.dataset.time;
    timeSlots.querySelectorAll("button").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    updateBookingSummary();
});

bookingForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (bookingBusy || bookingSaved || !selectedTime || !bookingForm.reportValidity()) return;
    const name = document.querySelector("#admin-client-name").value.trim();
    const phone = document.querySelector("#admin-client-phone").value.trim();
    if (name.length < 2 || !/^\+?\d{10,15}$/.test(phone.replace(/[\s()-]/g, ""))) {
        bookingMessage.textContent = "Введите имя (от двух символов) и корректный телефон (10–15 цифр).";
        return;
    }
    bookingBusy = true;
    bookingFields.disabled = true;
    createButton.textContent = bookingMode === "reschedule" ? "Переносим запись…" : "Создаём запись…";
    bookingMessage.textContent = "";
    updateBookingSummary();
    try {
        const moving = bookingMode === "reschedule" && rescheduleBooking;
        const url = moving
            ? `/api/admin/bookings/${rescheduleBooking.id}/reschedule`
            : "/api/admin/bookings";
        const data = await bookingJson(url, {
            method: moving ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name, phone,
                service: serviceSelect.value,
                master: barberSelect.value,
                date: bookingDateInput.value,
                time: selectedTime
            })
        });
        // Never resubmit a saved mutation if the subsequent refresh fails.
        bookingSaved = true;
        clientsLoaded = false;
        bookingMessage.classList.add("success");
        bookingMessage.textContent = moving
            ? `Запись №${data.booking_id} перенесена. Обновляем список…`
            : `Запись №${data.booking_id} создана. Обновляем список…`;
        const refreshed = await loadBookings();
        if (!bookingModal.open) return;
        bookingMessage.textContent = moving
            ? (refreshed
                ? `Запись №${data.booking_id} перенесена. Список и CRM обновлены.`
                : `Запись №${data.booking_id} перенесена, но список не обновился. Обновите страницу.`)
            : (refreshed
                ? `Запись №${data.booking_id} создана. Список и статистика обновлены. Текущие фильтры сохранены.`
                : `Запись №${data.booking_id} создана, но список не обновился. Обновите страницу; повторно создавать запись не нужно.`);
    } catch (error) {
        if (!bookingModal.open) return;
        bookingMessage.textContent = error.status
            ? error.message
            : "Не удалось получить ответ сервера. Перед повторной отправкой проверьте список записей: запись могла сохраниться.";
        if (error.status === 409) await loadBookingAvailability();
    } finally {
        bookingBusy = false;
        bookingFields.disabled = bookingSaved;
        createButton.textContent = bookingMode === "reschedule"
            ? (bookingSaved ? "Запись перенесена" : "Перенести запись")
            : (bookingSaved ? "Запись создана" : "Создать запись");
        updateBookingSummary();
    }
});


// Reusable async confirmation: text-only details, inline errors, one pending action.
const confirmationModal = document.querySelector("#confirmation-modal");
const confirmationTitle = document.querySelector("#confirmation-title");
const confirmationDescription = document.querySelector("#confirmation-description");
const confirmationDetails = document.querySelector("#confirmation-details");
const confirmationMessage = document.querySelector("#confirmation-message");
const confirmationConflicts = document.querySelector("#confirmation-conflicts");
const confirmationBack = document.querySelector("#confirmation-back");
const confirmationSubmit = document.querySelector("#confirmation-submit");
let confirmationOptions = null;
let confirmationBusy = false;
let confirmationOpener = null;
let confirmationOverflow = "";

function openConfirmation(options) {
    if (confirmationModal.open || confirmationBusy) return;
    confirmationOptions = options;
    confirmationOpener = document.activeElement;
    confirmationTitle.textContent = options.title;
    confirmationDescription.textContent = options.description || "";
    confirmationMessage.textContent = "";
    confirmationConflicts.replaceChildren();
    confirmationConflicts.hidden = true;
    confirmationBack.textContent = "Назад";
    confirmationSubmit.hidden = false;
    confirmationSubmit.textContent = options.confirmLabel || "Подтвердить";
    confirmationDetails.replaceChildren();
    (options.details || []).forEach(([label, value]) => {
        if (value == null || value === "") return;
        const row = document.createElement("div");
        const term = document.createElement("dt");
        const detail = document.createElement("dd");
        term.textContent = label;
        detail.textContent = String(value);
        row.append(term, detail);
        confirmationDetails.append(row);
    });
    confirmationDetails.hidden = !confirmationDetails.children.length;
    confirmationOverflow = document.body.style.overflow;
    confirmationModal.showModal();
    document.body.style.overflow = "hidden";
    confirmationBack.focus();
}

function showScheduleConflict(error) {
    const conflicts = Array.isArray(error.conflicts) ? error.conflicts : [];
    if (error.status !== 409 || !conflicts.length) return false;

    confirmationTitle.textContent = "Нельзя сохранить изменение";
    confirmationDescription.textContent =
        conflicts.length === 1
            ? "В выбранном времени уже есть подтверждённая запись. Сначала отмените или перенесите её."
            : `Найдено ${conflicts.length} подтверждённых записей. Сначала отмените или перенесите их.`;
    confirmationMessage.textContent = "Изменения расписания не сохранены.";
    confirmationDetails.hidden = true;
    confirmationConflicts.replaceChildren();

    conflicts.forEach(conflict => {
        const card = document.createElement("article");
        card.className = "confirmation-conflict-card";

        const title = document.createElement("strong");
        title.textContent = `${conflict.client_name || "Клиент"} · ${conflict.booking_time || ""}`;

        const date = document.createElement("span");
        date.textContent = conflict.booking_date
            ? `${formatDate(conflict.booking_date)} · ${conflict.barber_name || ""}`
            : (conflict.barber_name || "");

        const service = document.createElement("span");
        service.textContent = [
            conflict.service_name,
            conflict.service_duration ? `${conflict.service_duration} мин.` : "",
            conflict.client_phone
        ].filter(Boolean).join(" · ");

        const reason = document.createElement("span");
        reason.className = "conflict-reason";
        reason.textContent = conflict.reason || "Запись пересекается с новым расписанием.";

        card.append(title, date, service, reason);
        confirmationConflicts.append(card);
    });

    confirmationConflicts.hidden = false;
    confirmationSubmit.hidden = true;
    confirmationBack.textContent = "Понятно";
    return true;
}

function closeConfirmation(force = false) {
    if (!confirmationModal.open || (confirmationBusy && !force)) return;
    confirmationModal.close();
    document.body.style.overflow = confirmationOverflow;
    confirmationOptions = null;
    if (!force) {
        const target = confirmationOpener?.isConnected ? confirmationOpener : searchInput;
        target.focus({ preventScroll: true });
    }
}

confirmationBack.addEventListener("click", () => closeConfirmation());
confirmationModal.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    if (confirmationBusy) {
        event.preventDefault();
        return;
    }
    if (event.shiftKey && document.activeElement === confirmationBack) {
        event.preventDefault();
        confirmationSubmit.focus();
    } else if (!event.shiftKey && document.activeElement === confirmationSubmit) {
        event.preventDefault();
        confirmationBack.focus();
    }
});
confirmationModal.addEventListener("cancel", event => {
    event.preventDefault();
    closeConfirmation();
});
let confirmationBackdropPressed = false;
function outsideConfirmation(event) {
    const rect = confirmationModal.getBoundingClientRect();
    return event.target === confirmationModal &&
        (event.clientX < rect.left || event.clientX > rect.right ||
         event.clientY < rect.top || event.clientY > rect.bottom);
}
confirmationModal.addEventListener("pointerdown", event => {
    confirmationBackdropPressed = outsideConfirmation(event);
});
confirmationModal.addEventListener("click", event => {
    if (confirmationBackdropPressed && outsideConfirmation(event)) closeConfirmation();
    confirmationBackdropPressed = false;
});
confirmationSubmit.addEventListener("click", async () => {
    if (confirmationBusy || !confirmationOptions) return;
    const options = confirmationOptions;
    confirmationBusy = true;
    confirmationBack.disabled = true;
    confirmationSubmit.disabled = true;
    confirmationModal.setAttribute("aria-busy", "true");
    confirmationSubmit.textContent = options.busyLabel || "Выполняем…";
    confirmationMessage.textContent = "Сохраняем изменения…";
    try {
        await options.onConfirm();
        confirmationBusy = false;
        closeConfirmation();
    } catch (error) {
        if (confirmationModal.open) {
            if (!showScheduleConflict(error)) {
                confirmationMessage.textContent =
                    error.message || "Не удалось выполнить действие. Попробуйте ещё раз.";
            }
        }
    } finally {
        confirmationBusy = false;
        confirmationBack.disabled = false;
        confirmationSubmit.disabled = false;
        confirmationModal.removeAttribute("aria-busy");
        confirmationSubmit.textContent = options.confirmLabel || "Подтвердить";
        if (confirmationModal.open) confirmationBack.focus();
    }
});



// Schedule editor uses the existing session and reusable custom confirmation.
const schedulePanel = document.querySelector('#schedule-panel');
const scheduleContent = document.querySelector('#schedule-content');
const scheduleBarber = document.querySelector('#schedule-barber');
const scheduleMessage = document.querySelector('#schedule-message');
const scheduleRetry = document.querySelector('#schedule-retry');
const weeklyForm = document.querySelector('#weekly-form');
const exceptionForm = document.querySelector('#exception-form');
const blockForm = document.querySelector('#block-form');
const scheduleEvents = document.querySelector('#schedule-events');
const weekdayNames = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
let scheduleVersion = 0;
let scheduleBusy = false;
let scheduleDirty = false;
let scheduleLoadedBarber = '';
let scheduleSnapshot = null;

function scheduleNotice(text, error=false) {
    scheduleMessage.textContent = text;
    scheduleMessage.classList.toggle('error', error);
}
const clientsPanel = document.querySelector('#clients-panel');
const clientsList = document.querySelector('#clients-list');
const clientsSearch = document.querySelector('#clients-search');
const clientsMessage = document.querySelector('#clients-message');
const clientsCount = document.querySelector('#clients-count');
const clientsVisits = document.querySelector('#clients-visits');
const clientsCancelled = document.querySelector('#clients-cancelled');
const clientsRevenue = document.querySelector('#clients-revenue');
const clientModal = document.querySelector('#client-modal');
const clientModalBody = document.querySelector('#client-modal-body');
const clientModalClose = document.querySelector('#client-modal-close');
let crmClients = [];
let clientsLoaded = false;

function setCrmTab(tab) {
    remindersPanel.hidden = tab !== 'reminders';
    document.querySelector('#nav-reminders').setAttribute('aria-pressed', String(tab === 'reminders'));
    if (tab === 'reminders') startReminders();
    else stopReminders();
    analyticsPanel.hidden = tab !== 'analytics';
    document.querySelector('#nav-analytics').setAttribute('aria-pressed', String(tab === 'analytics'));
    if (tab === 'analytics') loadAnalytics();
    else resetAnalytics();
    document.querySelector('#catalog-panel').hidden = tab !== 'catalog';
    document.querySelector('#nav-catalog').setAttribute('aria-pressed', String(tab === 'catalog'));
    if (tab === 'catalog') loadCatalog();
    const scheduleOpen = tab === 'schedule';
    const clientsOpen = tab === 'clients';
    const bookingsOpen = tab === 'bookings';

    schedulePanel.hidden = !scheduleOpen;
    clientsPanel.hidden = !clientsOpen;
    document.querySelectorAll('.stats,.admin-controls,#bookings-list').forEach(el => el.hidden = !bookingsOpen);

    document.querySelector('#nav-schedule').setAttribute('aria-pressed', String(scheduleOpen));
    document.querySelector('#nav-clients').setAttribute('aria-pressed', String(clientsOpen));
    document.querySelector('#nav-bookings').setAttribute('aria-pressed', String(bookingsOpen));

    if (scheduleOpen && !scheduleLoadedBarber) loadSchedule();
    if (clientsOpen && !clientsLoaded) loadClients();
}

function scheduleTab(open) {
    setCrmTab(open ? 'schedule' : 'bookings');
}

function formatMoney(value) {
    return `${new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2}).format(Number(value) || 0)} грн`;
}

function renderClients() {
    const query = clientsSearch.value.trim().toLowerCase();
    const digits = query.replace(/\D/g, '');
    const visible = crmClients.filter(client => {
        const name = String(client.name || '').toLowerCase();
        const phone = String(client.phone || '').toLowerCase();
        const phoneDigits = phone.replace(/\D/g, '');
        return !query || name.includes(query) || phone.includes(query) || (digits && phoneDigits.includes(digits));
    });

    clientsCount.textContent = crmClients.length;
    clientsVisits.textContent = crmClients.reduce((sum, client) => sum + Number(client.completed || 0), 0);
    clientsCancelled.textContent = crmClients.reduce((sum, client) => sum + Number(client.cancelled || 0), 0);
    clientsRevenue.textContent = formatMoney(crmClients.reduce((sum, client) => sum + Number(client.total_spent || 0), 0));

    if (!visible.length) {
        clientsList.innerHTML = '<div class="empty-state"><strong>Клиенты не найдены</strong><span>Измените поиск или создайте первую запись.</span></div>';
        return;
    }

    clientsList.innerHTML = visible.map(client => `
        <article class="client-row">
            <div>
                <strong>${escapeBookingHtml(client.name)}</strong>
                <small>${escapeBookingHtml(client.phone)}</small>
            </div>
            <div class="client-metric"><span>Записей</span><b>${escapeBookingHtml(client.total_bookings)}</b></div>
            <div class="client-metric"><span>Визитов</span><b>${escapeBookingHtml(client.completed)}</b></div>
            <div class="client-metric"><span>Потрачено</span><b>${escapeBookingHtml(formatMoney(client.total_spent))}</b></div>
            <button class="client-open" type="button" data-client-key="${escapeBookingHtml(client.key)}">Открыть</button>
        </article>
    `).join('');
}

async function loadClients(force = false) {
    if (clientsLoaded && !force) {
        renderClients();
        return;
    }
    clientsMessage.textContent = 'Загружаем клиентскую базу…';
    try {
        const response = await fetch('/api/admin/clients');
        const data = await response.json();
        if (response.status === 401) {
            showLogin();
            return;
        }
        if (!response.ok) throw new Error(data.message || 'Не удалось загрузить клиентов.');
        crmClients = Array.isArray(data.clients) ? data.clients : [];
        clientsLoaded = true;
        clientsMessage.textContent = '';
        renderClients();
    } catch (error) {
        console.error(error);
        clientsMessage.textContent = error.message || 'Не удалось загрузить клиентов.';
    }
}

function openClient(client) {
    activeCrmClient = client;
    const history = Array.isArray(client.history) ? client.history : [];
    clientModalBody.innerHTML = `
        <section class="client-profile">
            <div>
                <h3>${escapeBookingHtml(client.name)}</h3>
                <p>${escapeBookingHtml(client.phone)}</p>
                <p>Последний визит: <strong>${client.last_visit ? escapeBookingHtml(formatDate(client.last_visit)) : 'ещё не было'}</strong></p>
                <p>Частый мастер: <strong>${escapeBookingHtml(client.favorite_barber || '—')}</strong></p>
                <button class="new-booking-button client-repeat-booking" type="button" data-repeat-booking="true">+ Новая запись</button>
            </div>
            <div class="client-profile-stats">
                <div><span>Всего записей</span><strong>${escapeBookingHtml(client.total_bookings)}</strong></div>
                <div><span>Выполнено</span><strong>${escapeBookingHtml(client.completed)}</strong></div>
                <div><span>Отменено</span><strong>${escapeBookingHtml(client.cancelled)}</strong></div>
                <div><span>Сумма визитов</span><strong>${escapeBookingHtml(formatMoney(client.total_spent))}</strong></div>
            </div>
        </section>
        <div id="crm-profile-editor"></div>
        <h3 class="client-history-title">История записей</h3>
        <div class="client-history">
            ${history.map(item => `
                <article class="client-history-item">
                    <div class="history-date">${escapeBookingHtml(formatDate(item.date))}</div>
                    <strong>${escapeBookingHtml(item.time)}</strong>
                    <div>${escapeBookingHtml(item.service)}<small>${escapeBookingHtml(item.duration)} мин. · ${escapeBookingHtml(formatMoney(item.price))}</small></div>
                    <div>${escapeBookingHtml(item.barber)}<small>Мастер</small></div>
                    <span class="status status-${escapeBookingHtml(item.status)}">${escapeBookingHtml(getStatusLabel(item.status))}</span>
                    <div class="crm-history-comment"><p data-comment-preview="${escapeBookingHtml(item.id)}">${escapeBookingHtml(item.comment || 'Комментарий пока не добавлен')}</p><button type="button" class="crm-comment-button" data-booking-comment="${escapeBookingHtml(item.id)}">Редактировать комментарий</button></div>
                </article>
            `).join('') || '<div class="empty-state">История пуста.</div>'}
        </div>
    `;
    clientModal.showModal();
    mountCrmProfile(client);

    const repeatButton = clientModalBody.querySelector('[data-repeat-booking]');
    repeatButton?.addEventListener('click', () => {
        closeCrmClient(() => openNewBooking({name: client.name, phone: client.phone}));
    });
}

document.querySelector('#nav-schedule').addEventListener('click',()=>setCrmTab('schedule'));
document.querySelector('#nav-clients').addEventListener('click',()=>setCrmTab('clients'));
document.querySelector('#nav-bookings').addEventListener('click',()=>setCrmTab('bookings'));
clientsSearch.addEventListener('input', renderClients);
clientsList.addEventListener('click', event => {
    const button = event.target.closest('[data-client-key]');
    if (!button) return;
    const client = crmClients.find(item => item.key === button.dataset.clientKey);
    if (client) openClient(client);
});
clientModalClose.addEventListener('click', () => closeCrmClient());
clientModal.addEventListener('cancel', event => { event.preventDefault(); closeCrmClient(); });
clientModal.addEventListener('click', event => {
    const rect = clientModal.getBoundingClientRect();
    if (event.target === clientModal && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeCrmClient();
});
scheduleRetry.addEventListener('click',()=>loadSchedule());

function renderSchedule(data) {
    scheduleSnapshot = data;
    const rows = document.querySelector('#weekly-rows');
    rows.replaceChildren();
    data.weekly.forEach(day => {
        const row = document.createElement('div');
        row.className = 'weekly-row';
        row.dataset.weekday = day.weekday;
        row.innerHTML = `<strong>${weekdayNames[day.weekday]}</strong>
            <label class="weekly-toggle"><input type="checkbox" ${day.working ? 'checked' : ''}><span>${day.working ? 'Рабочий' : 'Выходной'}</span></label>
            <label>С<input type="time" name="start" required></label>
            <label>До<input type="time" name="end" required></label>`;
        row.querySelector('[name=start]').value = day.start || '10:00';
        row.querySelector('[name=end]').value = day.end || '19:00';
        row.querySelectorAll('[type=time]').forEach(el => el.disabled = !day.working);
        row.querySelector('[type=checkbox]').setAttribute('aria-label',`${weekdayNames[day.weekday]}: рабочий день`);
        row.querySelectorAll('[type=time]').forEach(el=>el.setAttribute('aria-label',`${weekdayNames[day.weekday]}: ${el.name==='start'?'начало':'окончание'}`));
        rows.append(row);
    });
    [exceptionForm,blockForm].forEach(form=>{
        form.elements.date.min=data.today;
        if (!form.elements.date.value || form.elements.date.value<data.today) form.elements.date.value=data.today;
    });
    scheduleEvents.replaceChildren();
    const events = [
        ...data.exceptions.map(item=>({...item,kind:'exceptions'})),
        ...data.blocks.map(item=>({...item,kind:'blocks'}))
    ].sort((a,b)=>a.date.localeCompare(b.date)||(a.start||'').localeCompare(b.start||''));
    if (!events.length) scheduleEvents.textContent='Исключений и блокировок пока нет.';
    events.forEach(item=>{
        const row=document.createElement('div'); row.className='schedule-event';
        const body=document.createElement('div');
        const title=document.createElement('strong'); title.textContent=formatDate(item.date);
        const detail=document.createElement('p');
        detail.textContent=item.kind==='blocks' ? `Блокировка · ${item.start}–${item.end}` : item.working ? `Особые часы · ${item.start}–${item.end}` : 'Выходной';
        body.append(title,detail);
        if(item.reason) { const reason=document.createElement('p'); reason.className='schedule-muted'; reason.textContent=item.reason; body.append(reason); }
        const button=document.createElement('button'); button.type='button'; button.textContent='Удалить';
        button.setAttribute('aria-label',`Удалить: ${title.textContent}, ${detail.textContent}`);
        button.addEventListener('click',()=>{
            if(scheduleBusy) return;
            const barber=scheduleLoadedBarber;
            openConfirmation({title:'Удалить изменение расписания?',description:'Свободное время будет пересчитано. Подтверждённые записи сохранятся.',
                details:[['Мастер',scheduleBarber.selectedOptions[0].textContent],['Дата',formatDate(item.date)],['Изменение',detail.textContent]],
                confirmLabel:'Удалить',onConfirm:()=>saveSchedule(item.kind,'DELETE',item.kind==='blocks'?{id:item.id}:{date:item.date},barber)});
        });
        row.append(body,button); scheduleEvents.append(row);
    });
    scheduleDirty=false;
    scheduleContent.hidden=false;
}

async function loadSchedule() {
    const version=++scheduleVersion;
    scheduleLoadedBarber='';
    scheduleContent.hidden=true;
    scheduleRetry.hidden=true;
    scheduleBarber.disabled=true;
    scheduleNotice('Загружаем расписание…');
    try {
        if(!scheduleBarber.options.length) {
            const barbers=await bookingJson('/api/barbers');
            if(version!==scheduleVersion) return;
            if(!Array.isArray(barbers)||!barbers.length) throw new Error('Мастера не найдены.');
            barbers.forEach(item=>scheduleBarber.add(new Option(item.name,String(item.id))));
        }
        const barber=scheduleBarber.value;
        const data=await bookingJson(`/api/admin/schedules/${barber}`);
        if(version!==scheduleVersion) return;
        scheduleLoadedBarber=barber;
        renderSchedule(data);
        scheduleNotice('');
    } catch(error) {
        if(version!==scheduleVersion) return;
        scheduleNotice(error.message || 'Не удалось загрузить расписание.',true);
        scheduleRetry.hidden=false;
    } finally { if(version===scheduleVersion) scheduleBarber.disabled=false; }
}

scheduleBarber.addEventListener('change',()=>{
    const next=scheduleBarber.value;
    if(scheduleDirty && scheduleLoadedBarber) {
        scheduleBarber.value=scheduleLoadedBarber;
        openConfirmation({title:'Перейти к другому мастеру?',description:'Несохранённые изменения недели будут потеряны.',confirmLabel:'Перейти',onConfirm:async()=>{
            scheduleBarber.value=next; await loadSchedule();
        }});
    } else loadSchedule();
});
weeklyForm.addEventListener('change',event=>{
    scheduleDirty=true;
    if(event.target.type==='checkbox') {
        const row=event.target.closest('.weekly-row');
        row.querySelector('span').textContent=event.target.checked?'Рабочий':'Выходной';
        row.querySelectorAll('[type=time]').forEach(el=>el.disabled=!event.target.checked);
    }
});
exceptionForm.elements.mode.addEventListener('change',()=>{
    const off=exceptionForm.elements.mode.value==='off';
    document.querySelector('#exception-times').hidden=off;
    exceptionForm.elements.start.disabled=off; exceptionForm.elements.end.disabled=off;
});

async function saveSchedule(kind,method,payload,barber=scheduleLoadedBarber) {
    if(scheduleBusy || !barber) throw new Error('Дождитесь загрузки расписания.');
    scheduleBusy=true;
    const version=scheduleVersion;
    const controls=[...schedulePanel.querySelectorAll('input,select,button')];
    const disabled=controls.map(el=>el.disabled);
    controls.forEach(el=>el.disabled=true);
    scheduleNotice('Сохраняем изменения…');
    try {
        const data=await bookingJson(`/api/admin/schedules/${barber}${kind?'/'+kind:''}`,{
            method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
        });
        if(version!==scheduleVersion) return;
        // Preserve a pending weekly draft when only a dated entry was changed.
        const draft=kind && scheduleDirty ? readWeekly() : null;
        renderSchedule(data);
        if(draft) {
            renderSchedule({...data,weekly:draft}); scheduleDirty=true;
        }
        scheduleNotice('Сохранено. Свободное время обновлено.');
        if(bookingModal.open) loadBookingAvailability();
    } catch(error) {
        if(version===scheduleVersion) scheduleNotice(error.message || 'Не удалось получить ответ. Повторите загрузку перед новой попыткой.',true);
        throw error;
    } finally {
        scheduleBusy=false;
        controls.forEach((el,i)=>{if(el.isConnected) el.disabled=disabled[i];});
    }
}
function readWeekly() {
    return [...document.querySelectorAll('.weekly-row')].map(row=>{
        const working=row.querySelector('[type=checkbox]').checked;
        return {weekday:Number(row.dataset.weekday),working,start:working?row.querySelector('[name=start]').value:null,end:working?row.querySelector('[name=end]').value:null};
    });
}
weeklyForm.addEventListener('submit',event=>{
    event.preventDefault(); if(scheduleBusy || !weeklyForm.reportValidity()) return;
    const payload={weekly:readWeekly()};
    openConfirmation({title:'Сохранить недельный график?',description:'Новые часы будут действовать каждую неделю. Исключения на даты сохранятся.',
        details:[['Мастер',scheduleBarber.selectedOptions[0].textContent]],confirmLabel:'Сохранить',onConfirm:()=>saveSchedule('','PUT',payload)});
});
[exceptionForm,blockForm].forEach(form=>form.addEventListener('submit',event=>{
    event.preventDefault(); if(scheduleBusy || !form.reportValidity()) return;
    const isBlock=form===blockForm;
    const working=isBlock || form.elements.mode.value==='hours';
    const payload={date:form.elements.date.value,working,start:working?form.elements.start.value:null,end:working?form.elements.end.value:null};
    if(isBlock) payload.reason=form.elements.reason.value.trim();
    const kind=isBlock?'blocks':'exceptions';
    const replaced=!isBlock && scheduleSnapshot.exceptions.some(item=>item.date===payload.date);
    openConfirmation({title:isBlock?'Заблокировать время?':replaced?'Заменить исключение?':'Сохранить исключение?',
        description:'Клиентский сайт будет учитывать это изменение при выборе времени.',
        details:[['Мастер',scheduleBarber.selectedOptions[0].textContent],['Дата',formatDate(payload.date)],['Время',working?`${payload.start}–${payload.end}`:'Выходной']],
        confirmLabel:'Сохранить',onConfirm:()=>saveSchedule(kind,'POST',payload)});
}));


const catalogDialog = document.querySelector('#catalog-dialog');
const catalogForm = document.querySelector('#catalog-form');
const catalogMessage = document.querySelector('#catalog-message');
let catalogItems = {services: [], barbers: []};
let catalogEditing = null;
let catalogSaving = false;
let catalogVersion = 0;

async function loadCatalog() {
    const version = ++catalogVersion;
    catalogMessage.textContent = 'Загрузка…';
    try {
        const [services, barbers] = await Promise.all([
            bookingJson('/api/admin/services'), bookingJson('/api/admin/barbers')
        ]);
        if (version !== catalogVersion) return;
        catalogItems = {services: services.items, barbers: barbers.items};
        for (const kind of ['services', 'barbers']) {
            const list = document.querySelector(`#catalog-${kind}`);
            list.replaceChildren();
            if (!catalogItems[kind].length) list.textContent = 'Список пока пуст.';
            for (const item of catalogItems[kind]) {
                const card = document.createElement('article');
                card.className = 'catalog-card' + (item.active ? '' : ' catalog-inactive');
                const title = document.createElement('h4');
                title.textContent = item.name;
                const details = document.createElement('p');
                details.textContent = kind === 'services'
                    ? `${formatMoney(item.price)} · ${item.duration} мин.`
                    : `${item.position} · Опыт: ${item.experience} лет`;
                const status = document.createElement('span');
                status.className = 'catalog-status';
                status.textContent = item.active ? 'Активен' : 'Отключён';
                const edit = document.createElement('button');
                edit.type = 'button'; edit.textContent = 'Редактировать';
                edit.addEventListener('click', () => editCatalog(kind, item));
                card.append(title, details, status, edit);
                list.append(card);
            }
        }
        catalogMessage.textContent = '';
    } catch (error) {
        if (version === catalogVersion) catalogMessage.textContent = error.message;
    }
}

function editCatalog(kind, item = null) {
    if (catalogSaving) return;
    catalogEditing = {kind, id: item?.id};
    catalogForm.reset();
    document.querySelector('#catalog-editor-title').textContent =
        `${item ? 'Редактировать' : 'Добавить'} ${kind === 'services' ? 'услугу' : 'мастера'}`;
    document.querySelector('#catalog-form-message').textContent = '';
    for (const group of ['service', 'barber']) {
        const visible = (group === 'service') === (kind === 'services');
        const section = document.querySelector(`#catalog-${group}-fields`);
        section.hidden = !visible;
        section.querySelectorAll('input').forEach(input => { input.disabled = !visible; input.required = visible; });
    }
    for (const key of ['name', 'price', 'duration', 'position', 'experience']) {
        catalogForm.elements[key].value = item?.[key] ?? ({duration:60, experience:0}[key] ?? '');
    }
    catalogForm.elements.active.checked = item ? Boolean(item.active) : true;
    catalogDialog.showModal();
    catalogForm.elements.name.focus();
}

document.querySelector('#nav-catalog').addEventListener('click', () => {
    if (scheduleBusy) return;
    if (scheduleDirty) {
        openConfirmation({title:'Оставить несохранённый график?', description:'Изменения графика будут сброшены.',
            confirmLabel:'Продолжить', onConfirm:async () => {
                scheduleDirty=false; scheduleLoadedBarber=''; setCrmTab('catalog');
            }});
    } else setCrmTab('catalog');
});
document.querySelector('#catalog-refresh').addEventListener('click', loadCatalog);
document.querySelectorAll('[data-catalog-add]').forEach(button => button.addEventListener('click', () => editCatalog(button.dataset.catalogAdd)));
document.querySelector('#catalog-cancel').addEventListener('click', () => { if (!catalogSaving) catalogDialog.close(); });
catalogDialog.addEventListener('cancel', event => { if (catalogSaving) event.preventDefault(); });
catalogForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (catalogSaving || !catalogForm.reportValidity()) return;
    const {kind, id} = catalogEditing;
    const payload = {name:catalogForm.elements.name.value.trim(), active:catalogForm.elements.active.checked};
    for (const key of (kind === 'services' ? ['price','duration'] : ['experience'])) payload[key] = Number(catalogForm.elements[key].value);
    if (kind === 'barbers') payload.position = catalogForm.elements.position.value.trim();
    catalogSaving = true;
    document.querySelector('#catalog-fields').disabled = true;
    document.querySelector('#catalog-submit').disabled = true;
    document.querySelector('#catalog-form-message').textContent = 'Сохранение…';
    try {
        await bookingJson(`/api/admin/${kind}${id ? '/' + id : ''}`, {
            method:id ? 'PATCH' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
        });
        catalogDialog.close();
        // Rebuild selectors next time; keep historical cards and CRM snapshots intact.
        scheduleBarber.replaceChildren(); scheduleLoadedBarber=''; scheduleSnapshot=null;
        scheduleVersion++; scheduleContent.hidden=true;
        await loadCatalog();
        catalogMessage.textContent = kind === 'barbers' && !id
            ? 'Мастер добавлен. Настройте его рабочие часы во вкладке «Расписание мастеров».'
            : 'Сохранено. История визитов не изменилась.';
    } catch (error) {
        const message = document.querySelector('#catalog-form-message');
        message.replaceChildren(document.createTextNode(error.message));
        if (error.conflicts?.length) {
            const list = document.createElement('ul');
            for (const booking of error.conflicts) {
                const row = document.createElement('li');
                row.textContent = `№${booking.booking_id} · ${formatDate(booking.booking_date)} ${booking.booking_time} · ${booking.client_name} · ${booking.service_name} · ${booking.barber_name}`;
                list.append(row);
            }
            message.append(list);
        }
        if (error.status === 401) catalogDialog.close();
    } finally {
        catalogSaving = false;
        document.querySelector('#catalog-fields').disabled = false;
        document.querySelector('#catalog-submit').disabled = false;
    }
});

// CRM 2.0. Keep this initialization before the final authentication check.
let activeCrmClient = null;
let crmProfileDirty = false;
let crmProfileBusy = false;
let crmEpoch = 0;
let crmCommentEpoch = 0;
let crmCommentState = null;
let crmCommentBusy = false;
const crmCommentModal = document.querySelector('#crm-comment-modal');
const crmCommentText = document.querySelector('#crm-comment-text');
const crmCommentMessage = document.querySelector('#crm-comment-message');
const crmCommentSave = document.querySelector('#crm-comment-save');

function resetCrmEditors() {
    crmEpoch++;
    crmCommentEpoch++;
    clientModal.close();
    crmCommentModal.close();
    clientModalBody.replaceChildren();
    crmCommentText.value = '';
    activeCrmClient = null;
    crmCommentState = null;
    crmProfileDirty = crmProfileBusy = crmCommentBusy = false;
    crmClients = [];
    clientsLoaded = false;
    clientsList.replaceChildren();
}

function closeCrmClient(afterClose = null) {
    if (crmProfileBusy) return;
    const close = () => {
        crmEpoch++;
        clientModal.close();
        crmProfileDirty = false;
        activeCrmClient = null;
        if (afterClose) afterClose();
    };
    if (crmProfileDirty) {
        openConfirmation({title: 'Закрыть без сохранения?',
            description: 'Изменения заметки и тегов ещё не сохранены.',
            confirmLabel: 'Не сохранять', onConfirm: async () => close()});
    } else close();
}

async function mountCrmProfile(client) {
    const epoch = ++crmEpoch;
    crmProfileDirty = crmProfileBusy = false;
    const host = document.querySelector('#crm-profile-editor');
    host.innerHTML = '<p class="crm-message" role="status">Загружаем заметку и теги…</p>';
    try {
        const data = await bookingJson(`/api/admin/clients/${encodeURIComponent(client.key)}/profile`);
        if (epoch !== crmEpoch || !clientModal.open) return;
        Object.assign(client, data.profile);
        let tags = [...client.tags];
        let saved = JSON.stringify([client.note, tags]);
        host.innerHTML = `
            <form class="crm-editor" id="crm-profile-form">
                <h3>О клиенте</h3>
                <label for="crm-client-note">Постоянная заметка</label>
                <textarea id="crm-client-note" maxlength="4000" rows="4" aria-describedby="crm-note-hint"></textarea>
                <p id="crm-note-hint" class="clients-muted">До 4 000 символов. Сохраняется для всех записей этого телефона.</p>
                <label for="crm-tag-input">Теги клиента</label>
                <div id="crm-tag-list" class="crm-tags" aria-label="Теги клиента"></div>
                <div class="crm-tag-entry"><input id="crm-tag-input" maxlength="32" placeholder="Например, VIP" autocomplete="off" aria-describedby="crm-tags-hint"><button id="crm-add-tag" type="button">Добавить</button></div>
                <p id="crm-tags-hint" class="clients-muted">Любые названия: до 12 тегов, до 32 символов каждый. Enter добавляет тег.</p>
                <p class="crm-message" id="crm-profile-message" role="status" aria-live="polite"></p>
                <button type="submit" id="crm-profile-save">Сохранить заметку и теги</button>
            </form>`;
        const form = host.querySelector('form');
        const note = host.querySelector('textarea');
        const input = host.querySelector('#crm-tag-input');
        const list = host.querySelector('#crm-tag-list');
        const message = host.querySelector('#crm-profile-message');
        const save = host.querySelector('#crm-profile-save');
        note.value = client.note;
        const markDirty = () => {
            crmProfileDirty = JSON.stringify([note.value, tags]) !== saved || !!input.value;
            message.textContent = crmProfileDirty ? 'Есть несохранённые изменения.' : '';
        };
        const drawTags = () => {
            list.replaceChildren();
            for (const [index, tag] of tags.entries()) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'crm-tag';
                button.textContent = `${tag} ×`;
                button.setAttribute('aria-label', `Удалить тег ${tag}`);
                button.addEventListener('click', () => { tags.splice(index, 1); drawTags(); markDirty(); input.focus(); });
                list.append(button);
            }
        };
        const addTag = () => {
            const tag = input.value.normalize('NFC').trim().replace(/\s+/g, ' ');
            if (!tag) { input.value = ''; markDirty(); return true; }
            if (/[\p{Cc}\p{Cf}]/u.test(input.value)) { message.textContent = 'Тег не должен содержать управляющие символы.'; return false; }
            if (tags.some(value => value.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
                input.value = ''; markDirty(); message.textContent = 'Этот тег уже добавлен.'; return true;
            }
            if (tags.length >= 12 || [...tag].length > 32) { message.textContent = 'Максимум 12 тегов, до 32 символов каждый.'; return false; }
            tags.push(tag); input.value = ''; drawTags(); markDirty(); input.focus(); return true;
        };
        drawTags();
        note.addEventListener('input', markDirty);
        input.addEventListener('input', markDirty);
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); addTag(); }
        });
        host.querySelector('#crm-add-tag').addEventListener('click', addTag);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (crmProfileBusy || !addTag() || !form.reportValidity()) return;
            crmProfileBusy = true;
            form.querySelectorAll('input,textarea,button').forEach(el => el.disabled = true);
            form.setAttribute('aria-busy', 'true');
            save.textContent = 'Сохраняем…';
            message.textContent = '';
            try {
                const result = await bookingJson(`/api/admin/clients/${encodeURIComponent(client.key)}/profile`, {
                    method: 'PUT', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({note: note.value, tags, revision: client.revision})
                });
                if (epoch !== crmEpoch) return;
                Object.assign(client, result.profile);
                note.value = client.note;
                tags = [...client.tags];
                saved = JSON.stringify([client.note, tags]);
                crmProfileDirty = false;
                drawTags();
                clientsLoaded = false;
                message.textContent = 'Заметка и теги сохранены.';
            } catch (error) {
                if (epoch === crmEpoch) message.textContent = error.message || 'Не удалось сохранить. Ваши правки остались в форме.';
            } finally {
                if (epoch === crmEpoch) {
                    crmProfileBusy = false;
                    form.querySelectorAll('input,textarea,button').forEach(el => el.disabled = false);
                    form.removeAttribute('aria-busy');
                    save.textContent = 'Сохранить заметку и теги';
                }
            }
        });
    } catch (error) {
        if (epoch !== crmEpoch) return;
        host.replaceChildren();
        const message = document.createElement('p');
        message.className = 'crm-message'; message.textContent = error.message;
        const retry = document.createElement('button');
        retry.type = 'button'; retry.className = 'crm-comment-button'; retry.textContent = 'Повторить загрузку';
        retry.addEventListener('click', () => mountCrmProfile(client));
        host.append(message, retry);
    }
}

async function openCrmComment(id) {
    if (crmCommentModal.open) return;
    const epoch = ++crmCommentEpoch;
    const booking = bookings.find(item => item.id === id);
    const visit = activeCrmClient?.history?.find(item => item.id === id);
    document.querySelector('#crm-comment-context').textContent = booking
        ? `№${id} · ${booking.client_name} · ${formatDate(booking.booking_date)} ${booking.booking_time} · ${booking.service_name}`
        : `№${id} · ${activeCrmClient?.name || ''} · ${visit ? `${formatDate(visit.date)} ${visit.time} · ${visit.service}` : ''}`;
    crmCommentState = null;
    crmCommentText.value = '';
    crmCommentText.disabled = crmCommentSave.disabled = true;
    crmCommentMessage.textContent = 'Загружаем комментарий…';
    crmCommentModal.showModal();
    try {
        const data = await bookingJson(`/api/admin/bookings/${id}/comment`);
        if (epoch !== crmCommentEpoch || !crmCommentModal.open) return;
        crmCommentState = {id, comment: data.comment, revision: data.revision};
        crmCommentText.value = data.comment;
        crmCommentText.disabled = crmCommentSave.disabled = false;
        crmCommentMessage.textContent = '';
        crmCommentText.focus();
    } catch (error) {
        if (epoch === crmCommentEpoch) crmCommentMessage.textContent = `${error.message} Закройте окно и попробуйте снова.`;
    }
}

function closeCrmComment() {
    if (crmCommentBusy) return;
    const close = () => { crmCommentEpoch++; crmCommentModal.close(); crmCommentState = null; };
    if (crmCommentState && crmCommentText.value !== crmCommentState.comment) {
        openConfirmation({title: 'Закрыть без сохранения?', description: 'Комментарий ещё не сохранён.',
            confirmLabel: 'Не сохранять', onConfirm: async () => close()});
    } else close();
}

document.querySelector('#crm-comment-close').addEventListener('click', closeCrmComment);
crmCommentModal.addEventListener('cancel', event => { event.preventDefault(); closeCrmComment(); });
crmCommentText.addEventListener('input', () => { crmCommentMessage.textContent = 'Есть несохранённые изменения.'; });
document.querySelector('#crm-comment-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!crmCommentState || crmCommentBusy) return;
    const epoch = crmCommentEpoch;
    const {id, revision} = crmCommentState;
    crmCommentBusy = true;
    crmCommentText.disabled = crmCommentSave.disabled = true;
    crmCommentMessage.textContent = 'Сохраняем…';
    try {
        const data = await bookingJson(`/api/admin/bookings/${id}/comment`, {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({comment: crmCommentText.value, revision})
        });
        if (epoch !== crmCommentEpoch) return;
        crmCommentState = {id, comment: data.comment, revision: data.revision};
        crmCommentText.value = data.comment;
        const booking = bookings.find(item => item.id === id);
        if (booking) Object.assign(booking, {comment: data.comment, comment_revision: data.revision});
        for (const client of crmClients) {
            const item = client.history?.find(visit => visit.id === id);
            if (item) Object.assign(item, {comment: data.comment, comment_revision: data.revision});
        }
        clientModalBody.querySelectorAll('[data-comment-preview]').forEach(el => {
            if (Number(el.dataset.commentPreview) === id) el.textContent = data.comment || 'Комментарий пока не добавлен';
        });
        renderBookings();
        clientsLoaded = false;
        crmCommentMessage.textContent = 'Комментарий сохранён.';
    } catch (error) {
        if (epoch === crmCommentEpoch) crmCommentMessage.textContent = error.message;
    } finally {
        if (epoch === crmCommentEpoch) {
            crmCommentBusy = false;
            crmCommentText.disabled = crmCommentSave.disabled = false;
        }
    }
});
function handleCrmCommentClick(event) {
    const button = event.target.closest('[data-booking-comment]');
    if (button) openCrmComment(Number(button.dataset.bookingComment));
}
bookingsList.addEventListener('click', handleCrmCommentClick);
clientModalBody.addEventListener('click', handleCrmCommentClick);



// Analytics is fetched afresh on entry and period change.
let analyticsRequest = 0;
let analyticsController = null;
const analyticsPanel = document.querySelector('#analytics-panel');
const analyticsContent = document.querySelector('#analytics-content');
const analyticsMessage = document.querySelector('#analytics-message');
const analyticsPeriod = document.querySelector('#analytics-period');

function resetAnalytics() {
    analyticsRequest++;
    analyticsController?.abort();
    analyticsController = null;
    analyticsPeriod.disabled = false;
    analyticsContent.hidden = true;
    analyticsMessage.textContent = '';
    document.querySelector('#analytics-range').textContent = '';
    analyticsPanel.removeAttribute('aria-busy');
}

function analyticsTable(target, rows, masters) {
    const host = document.querySelector(target);
    host.replaceChildren();
    if (!rows.length) { host.textContent = 'За этот период нет выполненных визитов.'; return; }
    const scroll = document.createElement('div'); scroll.className = 'analytics-table-scroll';
    scroll.tabIndex = 0; scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', masters ? 'Результаты мастеров' : 'Популярные услуги');
    const table = document.createElement('table');
    const header = table.createTHead().insertRow();
    const columns = masters ? ['Мастер на дату визита', 'Визиты', 'Выручка', 'Средний чек', 'Минуты'] : ['Услуга на дату визита', 'Визиты', 'Выручка'];
    columns.forEach(text => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = text; header.append(th); });
    const body = table.createTBody();
    rows.forEach(item => {
        const row = body.insertRow();
        const values = [item.name, item.completed, formatMoney(item.revenue)];
        if (masters) values.push(formatMoney(item.average_check), `${item.completed_minutes}${item.missing_durations ? ' (неполные данные)' : ''}`);
        values.forEach(value => { row.insertCell().textContent = value; });
    });
    scroll.append(table); host.append(scroll);
}

function renderAnalytics(data) {
    const {kpi, period} = data;
    document.querySelector('#analytics-range').textContent = `${formatDate(period.start)} — ${formatDate(period.end)}. ${data.definitions.period}`;
    const host = document.querySelector('#analytics-kpis'); host.replaceChildren();
    const metrics = [['Выручка', formatMoney(kpi.revenue)], ['Выполненные визиты', kpi.completed], ['Средний чек', formatMoney(kpi.average_check)], ['Отменённые визиты', kpi.cancelled], ['Новые клиенты', kpi.new_clients], ['Повторные клиенты', kpi.returning_clients]];
    metrics.forEach(([label, value]) => {
        const card = document.createElement('article'); card.className = 'analytics-kpi';
        const title = document.createElement('span'); title.textContent = label;
        const number = document.createElement('strong'); number.textContent = value;
        card.append(title, number); host.append(card);
    });
    document.querySelector('#analytics-clients-note').textContent = data.definitions.clients;
    document.querySelector('#analytics-masters-note').textContent = data.definitions.masters;
    analyticsTable('#analytics-services', data.services, false);
    analyticsTable('#analytics-barbers', data.barbers, true);
    const chart = document.querySelector('#analytics-dynamics'); chart.replaceChildren();
    if (!kpi.completed) chart.textContent = 'Выполненных визитов пока нет. Выберите другой период или «Всё время».';
    else {
        const series = document.createElement('div'); series.className = 'analytics-series';
        series.tabIndex = 0; series.setAttribute('role', 'region'); series.setAttribute('aria-label', 'Динамика по датам');
        const maxRevenue = Math.max(1, ...data.dynamics.map(item => item.revenue));
        const maxVisits = Math.max(1, ...data.dynamics.map(item => item.completed));
        data.dynamics.forEach(item => {
            const row = document.createElement('div'); row.className = 'analytics-day';
            const date = document.createElement('span'); date.textContent = period.granularity === 'month' ? `${item.date.slice(5)}.${item.date.slice(0,4)}` : formatDate(item.date);
            const tracks = document.createElement('div'); tracks.setAttribute('aria-hidden', 'true');
            [[item.revenue / maxRevenue, ''], [item.completed / maxVisits, ' visits']].forEach(([ratio, className]) => {
                const track = document.createElement('div'); track.className = 'analytics-track';
                const bar = document.createElement('div'); bar.className = `analytics-bar${className}`; bar.style.width = `${Math.max(0,Math.min(100,ratio*100))}%`;
                track.append(bar); tracks.append(track);
            });
            const value = document.createElement('span'); value.className = 'analytics-day-value'; value.textContent = `${formatMoney(item.revenue)} · ${item.completed} виз.`;
            row.append(date, tracks, value); series.append(row);
        });
        chart.append(series);
    }
    const warnings = [];
    if (kpi.missing_prices) warnings.push(`Нет сохранённой цены у ${kpi.missing_prices} визитов: выручка и средний чек неполные.`);
    if (kpi.missing_phones) warnings.push(`Без телефона: ${kpi.missing_phones} визитов; они не входят в количество клиентов.`);
    document.querySelector('#analytics-warnings').textContent = warnings.join(' ');
    analyticsMessage.textContent = '';
    analyticsContent.hidden = false;
}

async function loadAnalytics() {
    const requestId = ++analyticsRequest;
    analyticsController?.abort();
    analyticsController = new AbortController();
    analyticsPeriod.disabled = true;
    analyticsMessage.textContent = analyticsContent.hidden ? 'Загружаем аналитику…' : 'Обновляем…';
    analyticsPanel.setAttribute('aria-busy', 'true');
    try {
        const response = await fetch(`/api/admin/analytics?period=${encodeURIComponent(analyticsPeriod.value)}`, {
            credentials: 'same-origin', cache: 'no-store', signal: analyticsController.signal
        });
        if (requestId !== analyticsRequest) return;
        if (response.status === 401) { showLogin(); return; }
        if (!response.ok) throw new Error('Не удалось загрузить аналитику. Выберите другой период, чтобы повторить.');
        const data = await response.json();
        if (requestId !== analyticsRequest) return;
        renderAnalytics(data);
    } catch (error) {
        if (requestId === analyticsRequest && error.name !== 'AbortError') analyticsMessage.textContent = error.message || 'Ошибка загрузки. Выберите другой период, чтобы повторить.';
    } finally {
        if (requestId === analyticsRequest) {
            analyticsPeriod.disabled = false;
            analyticsController = null;
            analyticsPanel.removeAttribute('aria-busy');
        }
    }
}
document.querySelector('#nav-analytics').addEventListener('click', () => setCrmTab('analytics'));
analyticsPeriod.addEventListener('change', loadAnalytics);



// Notifications 1.0: manual contact tracking; refresh only while this tab is visible.
const remindersPanel = document.querySelector('#reminders-panel');
const remindersList = document.querySelector('#reminders-list');
const remindersMessage = document.querySelector('#reminders-message');
let remindersData = null;
let remindersDay = 'today';
let remindersTimer = null;
let remindersEpoch = 0;
let remindersLoading = false;
let remindersSaving = false;

function stopReminders(clear = false) {
    clearInterval(remindersTimer);
    remindersTimer = null;
    remindersEpoch++;
    remindersLoading = false;
    remindersSaving = false;
    if (clear) {
        remindersData = null;
        remindersList.replaceChildren();
        remindersMessage.textContent = '';
    }
}

function startReminders() {
    stopReminders();
    loadReminders();
    remindersTimer = setInterval(() => {
        if (!document.hidden) loadReminders();
    }, 30000);
}

function reminderElement(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
}

function renderReminders() {
    if (!remindersData) return;
    for (const day of ['today', 'tomorrow']) {
        const rows = remindersData.reminders.filter(row => row.booking_date === remindersData[day]);
        const button = document.querySelector(`#reminders-${day}`);
        button.textContent = `${day === 'today' ? 'Сегодня' : 'Завтра'} · ${formatDate(remindersData[day])} · Не напоминали: ${rows.filter(row => !row.reminded_at).length} / ${rows.length}`;
        button.setAttribute('aria-pressed', String(remindersDay === day));
    }
    const filter = document.querySelector('#reminders-filter').value;
    const rows = remindersData.reminders.filter(row => row.booking_date === remindersData[remindersDay]
        && (filter === 'all' || (filter === 'done' ? !!row.reminded_at : !row.reminded_at)));
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
        const card = reminderElement('article', '', 'reminder-card');
        const details = reminderElement('div', '', 'reminder-details');
        details.append(reminderElement('h3', `${row.booking_time} · ${row.client_name}`));
        details.append(reminderElement('p', `${formatDate(row.booking_date)} · ${row.service_name || 'Услуга'} · ${row.barber_name || 'Мастер'}`));
        const telephone = String(row.client_phone || '').replace(/[^+0-9]/g, '');
        if (/^\+?\d{7,15}$/.test(telephone)) {
            const link = reminderElement('a', row.client_phone, 'reminder-phone');
            link.href = `tel:${telephone}`;
            details.append(link);
        } else details.append(reminderElement('span', row.client_phone || 'Телефон не указан'));
        const state = reminderElement('div', '', 'reminder-state');
        state.append(reminderElement('span', row.reminded_at ? 'Напомнили' : 'Не напоминали', row.reminded_at ? 'reminder-done' : 'reminder-pending'));
        if (row.reminded_at) state.append(reminderElement('small', new Date(row.reminded_at).toLocaleString('ru-RU')));
        const button = reminderElement('button', row.reminded_at ? 'Снять отметку' : 'Отметить «Напомнили»');
        button.type = 'button';
        button.dataset.reminderId = row.id;
        button.disabled = remindersSaving;
        button.setAttribute('aria-label', `${button.textContent}: ${row.client_name}, ${row.booking_time}`);
        state.append(button);
        card.append(details, state);
        fragment.append(card);
    }
    if (!rows.length) fragment.append(reminderElement('p', filter === 'all'
        ? 'На этот день нет подтверждённых записей.' : 'Нет записей с выбранным состоянием.', 'reminders-empty'));
    const focusedId = document.activeElement?.dataset?.reminderId;
    remindersList.replaceChildren(fragment);
    if (focusedId) remindersList.querySelector(`[data-reminder-id="${Number(focusedId)}"]`)?.focus();
}

async function loadReminders() {
    if (remindersPanel.hidden || remindersLoading || remindersSaving) return;
    const epoch = remindersEpoch;
    remindersLoading = true;
    if (!remindersData) remindersMessage.textContent = 'Загружаем напоминания…';
    try {
        const data = await bookingJson('/api/admin/reminders');
        if (epoch !== remindersEpoch) return;
        const changed = JSON.stringify(data) !== JSON.stringify(remindersData);
        remindersData = data;
        if (changed) renderReminders();
        remindersMessage.textContent = '';
    } catch (error) {
        if (epoch === remindersEpoch) remindersMessage.textContent = `${error.message} Нажмите «Обновить список».`;
    } finally {
        if (epoch === remindersEpoch) remindersLoading = false;
    }
}

remindersList.addEventListener('click', async event => {
    const button = event.target.closest('button[data-reminder-id]');
    if (!button || remindersSaving) return;
    const row = remindersData?.reminders.find(item => item.id === Number(button.dataset.reminderId));
    if (!row) return;
    const epoch = ++remindersEpoch; // Ignore any GET started before this mutation.
    remindersLoading = false;
    remindersSaving = true;
    remindersList.querySelectorAll('button').forEach(item => item.disabled = true);
    remindersMessage.textContent = 'Сохраняем…';
    let failure = '';
    try {
        const data = await bookingJson(`/api/admin/bookings/${row.id}/reminder`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reminded: !row.reminded_at, revision: row.reminder_revision })
        });
        if (epoch === remindersEpoch) Object.assign(row, data.reminder);
    } catch (error) { failure = error.message; }
    finally {
        if (epoch === remindersEpoch) {
            remindersSaving = false;
            renderReminders();
            await loadReminders();
            if (failure) remindersMessage.textContent = failure;
        }
    }
});
document.querySelector('#nav-reminders').addEventListener('click', () => setCrmTab('reminders'));
document.querySelector('#reminders-refresh').addEventListener('click', loadReminders);
document.querySelector('#reminders-filter').addEventListener('change', renderReminders);
for (const day of ['today', 'tomorrow']) document.querySelector(`#reminders-${day}`).addEventListener('click', () => {
    remindersDay = day;
    renderReminders();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && remindersTimer) loadReminders(); });
window.addEventListener('focus', () => { if (remindersTimer) loadReminders(); });


checkAuthentication();
