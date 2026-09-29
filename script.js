console.log("MANOR SCRIPT VERSION 2 LOADED");

const menuButton = document.querySelector("#menu-button");
const nav = document.querySelector("#nav");
const navLinks = document.querySelectorAll("#nav a");

menuButton.addEventListener("click", function() {
    nav.classList.toggle("active");
    menuButton.classList.toggle("active");
});

navLinks.forEach(function(link) {
    link.addEventListener("click", function() {
        nav.classList.remove("active");
        menuButton.classList.remove("active");
    });
});

// BOOKING

const bookingForm = document.querySelector("#booking-form");
const bookingSteps = document.querySelectorAll(".booking-step");
const progressItems = document.querySelectorAll(".progress-item");
const bookingBack = document.querySelector("#booking-back");
// Normalize the label once; keep the existing navigation listener and visibility rules.
const backArrow = document.createElement('span');
backArrow.className = 'booking-back-arrow';
backArrow.textContent = '←';
backArrow.setAttribute('aria-hidden', 'true');
bookingBack.replaceChildren(backArrow, document.createTextNode(' НАЗАД'));

const datesGrid = document.querySelector("#dates-grid");
const timesGrid = document.querySelector("#times-grid");

const bookingName = document.querySelector("#booking-name");
const bookingPhone = document.querySelector("#booking-phone");
const bookingMessage = document.querySelector("#booking-message");

const bookingData = {
    service: "",
    price: "",
    duration: 0,
    master: "",
    date: "",
    dateLabel: "",
    time: ""
};

let currentBookingStep = 1;
let preferredMaster = "";
let bookingConfirmed = false;
let catalogReady = false;
let catalog = { services: [], barbers: [] };


function showBookingStep(step) {
    currentBookingStep = step;
    updateBookingSummary();
    document.querySelectorAll('[data-service-id],[data-barber-id]').forEach(button => {
        const selected = button.dataset.serviceId ? Number(button.dataset.serviceId) === bookingData.serviceId : Number(button.dataset.barberId) === bookingData.barberId;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
    requestAnimationFrame(() => {
        const title = document.querySelector(`.booking-step[data-step="${step}"] .step-title h3`);
        if (title && document.activeElement && bookingForm.contains(document.activeElement)) { title.tabIndex = -1; title.focus({preventScroll:true}); }
    });
    if (step === 3) createDates();

    bookingSteps.forEach(function(item) {
        item.classList.toggle(
            "active",
            Number(item.dataset.step) === step
        );
    });

    progressItems.forEach(function(item) {
        const progressStep = Number(item.dataset.progress);
        if (progressStep === step) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');

        item.classList.toggle(
            "active",
            progressStep === step
        );

        item.classList.toggle(
            "completed",
            progressStep < step
        );
    });

    bookingBack.style.display =
        step === 1 ? "none" : "inline-block";
}


function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}


const datesPrevious = document.querySelector("#dates-previous");
const datesNext = document.querySelector("#dates-next");
const datesPeriod = document.querySelector("#dates-period");
const datesStatus = document.querySelector("#dates-status");
const datesRetry = document.querySelector("#dates-retry");
let dateWindow = null;
let datePage = 0;
let datesRequest = 0;
let timesRequest = 0;

function parseCalendarDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
}

function calendarDateAt(offset) {
    const day = parseCalendarDate(dateWindow.min_date);
    day.setDate(day.getDate() + offset);
    return day;
}

async function createDates() {
    const version = ++datesRequest;
    datesPrevious.disabled = datesNext.disabled = true;
    datesRetry.hidden = true;
    datesGrid.replaceChildren();
    datesStatus.textContent = "Загружаем календарь…";
    try {
        const response = await fetch("/api/booking-window", { cache: "no-store" });
        if (!response.ok) throw new Error("Calendar unavailable");
        const data = await response.json();
        if (version !== datesRequest) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.min_date) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(data.max_date) || data.max_date < data.min_date) {
            throw new Error("Invalid calendar");
        }
        if (dateWindow && dateWindow.min_date !== data.min_date) datePage = 0;
        dateWindow = data;
        if (bookingData.date && (bookingData.date < data.min_date || bookingData.date > data.max_date)) {
            bookingData.date = bookingData.dateLabel = bookingData.time = "";
        }
        renderDates();
        updateBookingSummary();
    } catch (error) {
        if (version !== datesRequest) return;
        datesStatus.textContent = "Не удалось загрузить календарь. Попробуйте ещё раз.";
        datesRetry.hidden = false;
    }
}

function renderDates() {
    datesGrid.replaceChildren();
    const first = calendarDateAt(datePage * 7);
    let last = first;
    for (let i = 0; i < 7; i++) {
        const day = calendarDateAt(datePage * 7 + i);
        const value = formatLocalDate(day);
        if (value > dateWindow.max_date) break;
        last = day;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "date-button";
        button.dataset.date = value;
        button.setAttribute("aria-label", day.toLocaleDateString("ru-RU", {
            weekday: "long", day: "numeric", month: "long", year: "numeric"
        }));
        button.setAttribute("aria-pressed", String(value === bookingData.date));
        if (value === dateWindow.min_date) button.setAttribute("aria-current", "date");
        const number = document.createElement("strong");
        number.textContent = day.getDate();
        const weekday = document.createElement("span");
        weekday.textContent = day.toLocaleDateString("ru-RU", { weekday: "short" });
        const month = document.createElement('span');
        month.textContent = day.toLocaleDateString('ru-RU', { month: 'short' });
        button.append(weekday, number, month);
        button.addEventListener("click", () => {
            bookingData.date = value;
            bookingData.dateLabel = day.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
            bookingData.time = "";
            createTimes();
            showBookingStep(4);
        });
        datesGrid.appendChild(button);
    }
    const month = day => day.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    datesPeriod.textContent = month(first) === month(last) ? month(first) : `${month(first)} — ${month(last)}`;
    datesStatus.textContent = `Запись доступна до ${parseCalendarDate(dateWindow.max_date).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} включительно.`;
    datesPrevious.disabled = datePage === 0;
    datesNext.disabled = formatLocalDate(calendarDateAt((datePage + 1) * 7)) > dateWindow.max_date;
}
datesPrevious.addEventListener("click", () => { if (datePage > 0) { datePage--; renderDates(); } });
datesNext.addEventListener("click", () => { if (!datesNext.disabled) { datePage++; renderDates(); } });
datesRetry.addEventListener("click", createDates);


async function createTimes() {
    const version = ++timesRequest;
    timesGrid.innerHTML = `
        <p class="loading-times">
            Проверяем свободное время...
        </p>
    `;

    const params = new URLSearchParams({
        barber: bookingData.master,
        service: bookingData.service,
        date: bookingData.date
    });

    try {
        const response = await fetch(
            `/api/availability?${params}`, { cache: "no-store" }
        );

        const data = await response.json();

        if (version !== timesRequest) return;
        if (!response.ok) {
            throw new Error(
                data.message ||
                "Не удалось получить расписание."
            );
        }

        timesGrid.innerHTML = "";

        if (data.available_times.length === 0) {
            timesGrid.innerHTML = `
                <p class="no-times">
                    На эту дату свободного времени нет.
                    Выберите другую дату.
                </p>
            `;

            return;
        }

        data.available_times.forEach(function(time) {
            const button = document.createElement("button");

            button.type = "button";
            button.className = "time-button";
            button.textContent = time;
            button.setAttribute('aria-pressed', String(time === bookingData.time));

            button.addEventListener("click", function() {
                bookingData.time = time;
                timesGrid.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));

                updateBookingSummary();
                showBookingStep(5);
            });

            timesGrid.appendChild(button);
        });

    } catch (error) {
        if (version !== timesRequest) return;
        console.error(
            "Ошибка получения времени:",
            error
        );

        timesGrid.innerHTML = `
            <p class="no-times">
                Не удалось загрузить свободное время.
            </p>
        `;
    }
}


function updateBookingSummary() {
    const values = {
        service: bookingData.service, master: bookingData.master,
        date: bookingData.dateLabel, time: bookingData.time,
        price: bookingData.service ? `${bookingData.price} ₴` : '',
        duration: bookingData.duration ? `${bookingData.duration} мин` : ''
    };
    for (const [key, value] of Object.entries(values)) {
        const target = document.querySelector(`#summary-${key}`);
        const text = value || '—';
        if (target.textContent !== text) {
            target.textContent = text;
            if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
                target.animate([{opacity: .35}, {opacity: 1}], {duration: 280});
            }
        }
    }
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// IDs verified against the current local catalog (read-only); paths from current HTML.
// Both ID and name must match so reusing an old name cannot assign its portrait.
// New or renamed masters receive a neutral placeholder, never another portrait.
const portraitAssets = new Map([
    [1, {name: 'Максим', path: 'images/barber-maxim.png'}],
    [2, {name: 'Александр', path: 'images/barber-alexander.png'}],
    [3, {name: 'Артём', path: 'images/barber-artem.png'}]
]);
function portrait(barber, className, number) {
    const box = element('span', `catalog-portrait ${className}`);
    const placeholder = element('span', 'portrait-placeholder');
    if (number) placeholder.append(element('span', 'portrait-number', number));
    placeholder.append(element('span', 'portrait-monogram', 'MH'), element('span', 'portrait-label', 'MANOR HOUSE'));
    placeholder.setAttribute('aria-hidden', 'true');
    box.append(placeholder);
    const asset = portraitAssets.get(barber.id);
    const path = asset?.name === barber.name ? asset.path : null;
    if (path) {
        const img = element('img');
        img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
        img.addEventListener('error', () => img.remove(), {once: true});
        img.src = path; box.append(img);
    }
    return box;
}
function experienceText(value) {
    if (!Number.isInteger(value) || value < 0) return '';
    const mod = value % 100, last = value % 10;
    const unit = mod >= 11 && mod <= 14 ? 'лет' : last === 1 ? 'год' : last >= 2 && last <= 4 ? 'года' : 'лет';
    return `${value} ${unit} опыта`;
}
function checkmark(button) {
    const mark = element('span', 'selection-check', '✓');
    mark.setAttribute('aria-hidden', 'true'); button.append(mark);
}
function empty(container, text) {
    const state = element('p', 'catalog-state', text);
    state.setAttribute('role', 'status'); container.replaceChildren(state);
}
function renderCatalog() {
    const services = document.querySelector('.services-grid');
    const serviceOptions = document.querySelector('.services-options');
    const barbers = document.querySelector('.barbers-grid');
    const masterOptions = document.querySelector('.masters-options');
    [services, serviceOptions, barbers, masterOptions].forEach(node => node.replaceChildren());
    catalog.services.forEach((service, i) => {
        const number = String(i + 1).padStart(2, '0');
        const card = element('article', 'service-card');
        card.append(element('span', 'service-number', number), element('h3', '', service.name));
        // Preserve editorial geometry without inventing a service description.
        card.append(element('p', '', service.description || ''));
        const bottom = element('div', 'service-bottom');
        bottom.append(element('strong', '', `${service.price} ₴`), element('span', '', `${service.duration} мин`));
        const link = element('a', 'service-link', 'Выбрать услугу ');
        link.href = '#booking';
        const plus = element('span', 'service-plus', '+'); plus.setAttribute('aria-hidden', 'true'); link.append(plus);
        link.addEventListener('click', () => selectService(service));
        card.append(bottom, link); services.append(card);
        const button = element('button', 'booking-option service-option');
        button.type = 'button'; button.dataset.serviceId = service.id;
        button.append(element('span', 'option-number', number), element('strong', '', service.name),
            element('span', 'option-duration', `${service.duration} мин`), element('b', '', `${service.price} ₴`));
        checkmark(button); button.addEventListener('click', () => selectService(service)); serviceOptions.append(button);
    });
    catalog.barbers.forEach((barber, index) => {
        const number = String(index + 1).padStart(2, '0');
        const card = element('article', 'barber-card');
        card.append(portrait(barber, 'barber-photo', number));
        const info = element('div', 'barber-info');
        info.append(element('p', 'barber-eyebrow', number + ' / ' + (barber.position || 'МАСТЕР')));
        info.append(element('h3', '', barber.name));
        const experience = experienceText(barber.experience);
        if (experience) info.append(element('span', 'barber-experience', experience));
        const divider = element('span', 'barber-divider');
        divider.setAttribute('aria-hidden', 'true'); info.append(divider);
        const link = element('a', 'master-cta', 'Записаться к мастеру');
        link.href = '#booking'; link.dataset.preselectMaster = barber.name;
        link.addEventListener('click', () => {
            if (bookingConfirmed || !catalogReady) return;
            preferredMaster = barber.name; bookingData.master = barber.name; bookingData.barberId = barber.id;
            clearSlot();
            document.querySelector('#preferred-master').textContent = `Вы выбрали мастера: ${barber.name}. Выберите услугу, затем подтвердите мастера на шаге 2.`;
            showBookingStep(1);
        });
        card.append(info, link); barbers.append(card);
        const button = element('button', 'booking-option master-option');
        button.type = 'button'; button.dataset.barberId = barber.id;
        button.append(portrait(barber, 'booking-portrait', number), element('strong', '', barber.name));
        if (barber.position) button.append(element('span', '', barber.position));
        if (experienceText(barber.experience)) button.append(element('span', '', experienceText(barber.experience)));
        checkmark(button);
        button.addEventListener('click', () => {
            if (bookingConfirmed || !catalogReady) return;
            bookingData.master = barber.name; bookingData.barberId = barber.id;
            preferredMaster = ''; document.querySelector('#preferred-master').textContent = '';
            clearSlot(); showBookingStep(3);
        });
        masterOptions.append(button);
    });
    if (!catalog.services.length) [services, serviceOptions].forEach(node => empty(node, 'Сейчас нет доступных услуг.'));
    if (!catalog.barbers.length) [barbers, masterOptions].forEach(node => empty(node, 'Сейчас нет доступных мастеров.'));
    syncSelection();
    document.dispatchEvent(new Event('catalog-rendered'));
}
function syncSelection() {
    document.querySelectorAll('[data-service-id],[data-barber-id]').forEach(button => {
        const chosen = button.dataset.serviceId ? Number(button.dataset.serviceId) === bookingData.serviceId : Number(button.dataset.barberId) === bookingData.barberId;
        button.classList.toggle('selected', chosen); button.setAttribute('aria-pressed', String(chosen));
    });
}
function clearSlot() {
    bookingData.date = bookingData.dateLabel = bookingData.time = '';
    ++timesRequest; ++datesRequest;
    timesGrid.replaceChildren();
}
function selectService(service) {
    if (bookingConfirmed || !catalogReady) return;
    bookingData.serviceId = service.id; bookingData.service = service.name;
    bookingData.price = service.price; bookingData.duration = service.duration;
    clearSlot(); showBookingStep(2);
}

let catalogRequest = null;
async function loadCatalog() {
    if (catalogRequest) return catalogRequest;
    catalogRequest = (async () => {
        const notice = document.querySelector('#catalog-notice');
        const retry = document.querySelector('#catalog-retry');
        const previousFocus = document.activeElement;
        const focusKey = previousFocus && (previousFocus.dataset.serviceId ? ['serviceId', previousFocus.dataset.serviceId] : previousFocus.dataset.barberId ? ['barberId', previousFocus.dataset.barberId] : null);
        try {
            const result = await Promise.all(['/api/services', '/api/barbers'].map(async url => {
                const response = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(15000)});
                if (!response.ok) throw new Error('Catalog unavailable');
                const data = await response.json();
                if (!Array.isArray(data)) throw new Error('Invalid catalog');
                return data.filter(item => item.active !== false && item.active !== 0);
            }));
            if (result.some(items => items.some(item => !Number.isInteger(item.id) || typeof item.name !== 'string' || !item.name.trim())) ||
                result[0].some(item => !Number.isFinite(item.price) || !Number.isFinite(item.duration) || item.duration <= 0)) throw new Error('Invalid catalog');
            const next = {services: result[0], barbers: result[1]};
            const changed = !catalogReady || JSON.stringify(next) !== JSON.stringify(catalog);
            catalogReady = true; retry.hidden = true;
            if (changed) {
                catalog = next;
                let reset = false;
                if (!bookingConfirmed) {
                    const service = catalog.services.find(item => item.id === bookingData.serviceId);
                    const barber = catalog.barbers.find(item => item.id === bookingData.barberId);
                    if (bookingData.serviceId && (!service || service.name !== bookingData.service || service.price !== bookingData.price || service.duration !== bookingData.duration)) {
                        reset = true;
                        bookingData.serviceId = service?.id; bookingData.service = service?.name || '';
                        bookingData.price = service?.price ?? ''; bookingData.duration = service?.duration || 0;
                    }
                    if (bookingData.barberId && (!barber || barber.name !== bookingData.master)) {
                        reset = true; bookingData.barberId = barber?.id; bookingData.master = barber?.name || '';
                        preferredMaster = ''; document.querySelector('#preferred-master').textContent = '';
                    }
                    if (reset) { clearSlot(); showBookingStep(1); }
                }
                renderCatalog(); updateBookingSummary();
                if (focusKey && !reset) {
                    const [key, value] = focusKey;
                    [...document.querySelectorAll('button')].find(button => button.dataset[key] === value)?.focus({preventScroll: true});
                }
                notice.textContent = reset ? 'Каталог обновился. Проверьте выбор и выберите время заново.' : '';
            }
        } catch (error) {
            catalogReady = false;
            notice.textContent = 'Не удалось загрузить каталог. Повторите попытку.'; retry.hidden = false;
            ['.services-grid', '.barbers-grid', '.services-options', '.masters-options'].forEach(selector => empty(document.querySelector(selector), 'Каталог временно недоступен.'));
            if (!bookingConfirmed) {
                bookingData.serviceId = bookingData.barberId = undefined;
                bookingData.service = bookingData.master = bookingData.price = ''; bookingData.duration = 0;
                preferredMaster = ''; document.querySelector('#preferred-master').textContent = '';
                clearSlot(); showBookingStep(1);
            }
            document.dispatchEvent(new Event('catalog-rendered'));
        }
    })();
    try { await catalogRequest; } finally { catalogRequest = null; }
}
document.querySelector('#catalog-retry').addEventListener('click', loadCatalog);
function refreshCatalogWhenIdle() {
    // A background refresh must not change the summary while POST is in flight.
    if (document.querySelector('.confirm-booking').disabled && !bookingConfirmed) return;
    loadCatalog();
}
addEventListener('focus', refreshCatalogWhenIdle);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCatalogWhenIdle(); });
setInterval(() => { if (!document.hidden) refreshCatalogWhenIdle(); }, 60000);


bookingBack.addEventListener("click", function() {
    if (currentBookingStep > 1) {
        showBookingStep(currentBookingStep - 1);
    }
});


bookingForm.addEventListener(
    "submit",
    async function(event) {

        event.preventDefault();
        if (bookingConfirmed || !catalogReady || currentBookingStep !== 5) return;
        // Recheck the catalog before sending; the backend remains the final authority.
        const catalogGuard = bookingForm.querySelector('.confirm-booking');
        if (catalogGuard.disabled) return;
        catalogGuard.disabled = true;
        await loadCatalog();
        catalogGuard.disabled = false;
        if (!catalogReady || currentBookingStep !== 5) return;
        console.log("NEW SUBMIT HANDLER STARTED");

        const name = bookingName.value.trim();
        const phone = bookingPhone.value.trim();

        if (name.length < 2) {
            showBookingMessage(
                "Введите корректное имя.",
                "error"
            );
            return;
        }

        const cleanedPhone =
            phone.replace(/[\s()-]/g, "");

        if (!/^\+?\d{10,15}$/.test(cleanedPhone)) {
            showBookingMessage(
                "Введите корректный номер телефона.",
                "error"
            );
            return;
        }


        const finalBooking = {
            name: name,
            phone: phone,
            service: bookingData.service,
            master: bookingData.master,
            date: bookingData.date,
            time: bookingData.time
        };


        const submitButton =
            bookingForm.querySelector(
                ".confirm-booking"
            );

        submitButton.disabled = true;
        submitButton.textContent =
            "Создаём запись...";

        showBookingMessage(
            "Проверяем выбранное время...",
            ""
        );


        try {

            const response = await fetch(
                "/api/bookings",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify(
                        finalBooking
                    )
                }
            );


            const data = await response.json();


            if (!response.ok) {
                throw new Error(
                    data.message ||
                    "Не удалось создать запись."
                );
            }


            console.log(
                "Создана запись:",
                data
            );


            showBookingMessage(
                `Готово! Вы записаны к мастеру ${bookingData.master} на ${bookingData.dateLabel} в ${bookingData.time}.`,
                "success"
            );


            bookingConfirmed = true;
            bookingBack.hidden = true;
            submitButton.textContent = "Запись подтверждена";

        } catch (error) {

            console.error(
                "Ошибка записи:",
                error
            );


            showBookingMessage(
                error.message,
                "error"
            );


            submitButton.disabled = false;
            submitButton.textContent =
                "Подтвердить запись";
        }
    }
);


function showBookingMessage(message, type) {
    bookingMessage.textContent = message;
    bookingMessage.className =
        `booking-message ${type}`;
}


showBookingStep(1);
loadCatalog();

// Cosmetic/UI 2.1: progressive enhancement; API contracts remain unchanged.
(() => {
 const motion = matchMedia('(prefers-reduced-motion: reduce)');
 const header = document.querySelector('.header');
 const entrance = document.querySelector('.entrance');
 const type = document.querySelector('.type-scene');
 const atmosphere = document.querySelector('.atmosphere-photo');
 const hero = document.querySelector('.hero');
 type.classList.add('motion-ready');
 let queued = false;
 const clamp = value => Math.max(0, Math.min(1, value));
 function paint() {
  queued = false; header.classList.toggle('scrolled', scrollY > 40);
  if (motion.matches) return;
  const vh = innerHeight;
  const r = entrance.getBoundingClientRect();
  const p = clamp(-r.top / Math.max(1, r.height - vh));
  entrance.style.setProperty('--door-inset', `${(innerWidth < 600 ? 15 : 27) * (1-p)}%`);
  entrance.style.setProperty('--door-scale', String(1.12 - .12*p));
  hero.style.setProperty('--hero-shift', `${Math.min(scrollY, vh)*.16}px`);
  const t = type.getBoundingClientRect();
  const progress = clamp(-t.top / Math.max(1, t.height - vh));
  const depth = progress - .5;
  const travel = innerWidth < 600 ? 28 : Math.min(innerWidth * .1, 150);
  type.style.setProperty('--type-travel', (depth * travel) + 'px');
  type.style.setProperty('--portrait-y', (depth * (innerWidth < 600 ? -36 : -100)) + 'px');
  type.style.setProperty('--portrait-scale', String(.94 + progress * .16));
  type.style.setProperty('--portrait-rotate', (-5 + progress * 8) + 'deg');
  const a = atmosphere.getBoundingClientRect();
  atmosphere.style.setProperty('--atmos-shift', `${(clamp((vh-a.top)/(vh+a.height))-.5)*40}px`);
 }
 function schedule() { if (!queued) { queued = true; requestAnimationFrame(paint); } }
 addEventListener('scroll', schedule, {passive:true}); addEventListener('resize', schedule); motion.addEventListener('change', schedule); paint();
 function syncMenu(){const open=nav.classList.contains('active');menuButton.setAttribute('aria-expanded',String(open));menuButton.setAttribute('aria-label',open?'Закрыть меню':'Открыть меню');}
 menuButton.addEventListener('click',syncMenu);navLinks.forEach(a=>a.addEventListener('click',syncMenu));
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&nav.classList.contains('active')){nav.classList.remove('active');menuButton.classList.remove('active');syncMenu();menuButton.focus();}});
 // No broken-image icon when optional project photographs have not been installed.
 document.querySelectorAll('img').forEach(img=>{const hide=()=>{img.style.visibility='hidden';};img.addEventListener('error',hide,{once:true});if(img.complete&&img.currentSrc&&!img.naturalWidth)hide();});
})();

// The gallery's item count follows the public catalog, including the empty state.
(() => {
    const gallery = document.querySelector('.barbers-grid');
    const prev = document.querySelector('#master-prev'), next = document.querySelector('#master-next');
    let cards = [], current = 0, frame = false;
    function mark(index) {
        current = Math.max(0, Math.min(index, cards.length - 1));
        cards.forEach((card, i) => card.classList.toggle('is-current', i === current));
        prev.disabled = !cards.length || current === 0;
        next.disabled = !cards.length || current === cards.length - 1;
        document.querySelector('#master-position').textContent = cards.length ? `${String(current+1).padStart(2,'0')} / ${String(cards.length).padStart(2,'0')}` : '— / —';
    }
    function slide(index) {
        const card = cards[index]; if (!card) return;
        gallery.scrollTo({left: card.offsetLeft-gallery.offsetLeft-(gallery.clientWidth-card.clientWidth)/2,
            behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    }
    prev.addEventListener('click', () => slide(Math.max(0,current-1)));
    next.addEventListener('click', () => slide(Math.min(cards.length-1,current+1)));
    gallery.addEventListener('scroll', () => {
        if (frame) return; frame = true;
        requestAnimationFrame(() => {
            frame = false;
            const center = gallery.getBoundingClientRect().left + gallery.clientWidth/2;
            let best = 0, distance = Infinity;
            cards.forEach((card, index) => {
                const rect = card.getBoundingClientRect(), delta = Math.abs(rect.left+rect.width/2-center);
                if (delta < distance) { distance = delta; best = index; }
            }); mark(best);
        });
    }, {passive: true});
    document.addEventListener('catalog-rendered', () => {
        cards = [...gallery.querySelectorAll('.barber-card')]; mark(0); gallery.scrollLeft = 0;
    });
    mark(0);
})();

// Reviews: manual navigation, stable layout, no automatic rotation.
(() => {
    const reviews = document.querySelector('#reviews');
    if (!reviews) return;
    const cards = [...reviews.querySelectorAll('.review-card')];
    const controls = reviews.querySelector('.reviews-controls');
    if (!cards.length || !controls) return;
    const counter = controls.querySelector('[data-review-current]');
    const position = controls.querySelector('.reviews-position');
    let current = 0;
    function show(index) {
        current = (index + cards.length) % cards.length;
        cards.forEach((card, i) => {
            card.classList.toggle('is-active', i === current);
            card.setAttribute('aria-hidden', String(i !== current));
        });
        counter.textContent = String(current + 1).padStart(2, '0');
        position.setAttribute('aria-label', 'Отзыв ' + (current + 1) + ' из ' + cards.length);
    }
    show(0);
    reviews.classList.add('is-enhanced');
    controls.hidden = false;
    controls.querySelector('.review-prev').addEventListener('click', () => show(current - 1));
    controls.querySelector('.review-next').addEventListener('click', () => show(current + 1));
})();
