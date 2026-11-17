/* =========================================================
   SkyWing Tours — application logic
   Front-end only demo: accounts, bookings, wishlist and admin
   data are stored in the browser's localStorage.
   ========================================================= */
(() => {
  "use strict";

  /* ---------- Helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const money = (n) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  const num = (n) => new Intl.NumberFormat("en-US").format(n);

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage unavailable (private mode) — app keeps working in memory */
      }
    },
  };

  const KEYS = {
    users: "sw_users",
    session: "sw_session",
    bookings: "sw_bookings",
    wishlist: "sw_wishlist",
    customTours: "sw_custom_tours",
    messages: "sw_messages",
    subscribers: "sw_subscribers",
  };

  const todayISO = () => new Date().toISOString().slice(0, 10);
  const addDaysISO = (d) => {
    const t = new Date();
    t.setDate(t.getDate() + d);
    return t.toISOString().slice(0, 10);
  };
  const prettyDate = (iso) =>
    new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  const durationLabel = (h) => (h >= 24 ? `${Math.round(h / 24)} days` : `${h} ${h === 1 ? "hour" : "hours"}`);
  const initials = (name) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const starIcons = (r) => "★".repeat(Math.round(r)) + "☆".repeat(5 - Math.round(r));

  async function hashPassword(pw) {
    if (window.crypto?.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("skywing:" + pw));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    let h = 0; // fallback for non-secure contexts (file://)
    for (const c of "skywing:" + pw) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
    return "x" + (h >>> 0).toString(16);
  }

  function toast(msg, type = "success") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="fa-solid ${type === "error" ? "fa-circle-exclamation" : "fa-circle-check"}"></i><span>${esc(msg)}</span>`;
    const box = $("#toasts");
    box.appendChild(el);
    // Re-show the popover so it sits in the top layer above any open dialog
    try {
      if (box.matches(":popover-open")) box.hidePopover();
      box.showPopover();
    } catch {
      /* popover API unsupported — container is a plain fixed element */
    }
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => {
        el.remove();
        if (!box.children.length) try { box.hidePopover(); } catch {}
      }, 300);
    }, 3200);
  }

  /* ---------- Data access ---------- */
  const allTours = () => [...TOURS, ...store.get(KEYS.customTours, [])];
  const tourById = (id) => allTours().find((t) => t.id === id);
  const guideById = (id) => GUIDES.find((g) => g.id === id);
  const categoryLabel = (key) => CATEGORIES.find((c) => c.key === key)?.label ?? "Tour";

  function destinations() {
    const map = new Map();
    allTours().forEach((t) => {
      if (!map.has(t.city)) map.set(t.city, { city: t.city, country: t.country, image: t.image, count: 0, from: t.price });
      const d = map.get(t.city);
      d.count++;
      d.from = Math.min(d.from, t.price);
    });
    return [...map.values()];
  }

  const session = () => store.get(KEYS.session, null);
  const isAdmin = () => session()?.role === "admin";

  /* ---------- State ---------- */
  const filters = { category: "all", dest: "", q: "", sort: "popular" };
  const prefs = { date: "", guests: 2 };
  let pendingAction = null;

  /* =========================================================
     RENDERING — catalogue
     ========================================================= */
  function renderCategoryChips() {
    const chips = [{ key: "all", label: "All tours", icon: "fa-compass" }, ...CATEGORIES];
    $("#categoryChips").innerHTML = chips
      .map(
        (c) => `<button class="chip ${filters.category === c.key ? "active" : ""}" role="tab"
          aria-selected="${filters.category === c.key}" data-cat="${c.key}">
          <i class="fa-solid ${c.icon}"></i>${esc(c.label)}</button>`
      )
      .join("");
  }

  function renderDestinationSelects() {
    const opts = destinations()
      .map((d) => `<option value="${esc(d.city)}">${esc(d.city)}, ${esc(d.country)}</option>`)
      .join("");
    $("#heroDest").innerHTML = `<option value="">All destinations</option>${opts}`;
    $("#destFilter").innerHTML = `<option value="">All destinations</option>${opts}`;
    $("#destFilter").value = filters.dest;
  }

  function filteredTours() {
    const q = filters.q.trim().toLowerCase();
    let list = allTours().filter(
      (t) =>
        (filters.category === "all" || t.category === filters.category) &&
        (!filters.dest || t.city === filters.dest) &&
        (!q || `${t.title} ${t.city} ${t.country} ${t.summary}`.toLowerCase().includes(q))
    );
    const sorters = {
      popular: (a, b) => b.reviews - a.reviews,
      rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
      "price-asc": (a, b) => a.price - b.price,
      "price-desc": (a, b) => b.price - a.price,
      duration: (a, b) => a.durationHours - b.durationHours,
    };
    return list.sort(sorters[filters.sort]);
  }

  function tourCard(t) {
    const wish = store.get(KEYS.wishlist, []).includes(t.id);
    const guide = guideById(t.guide);
    const badgeClass = t.custom ? "new" : /sell out|bestseller/i.test(t.badge) ? "hot" : "";
    const badge = t.custom ? "New" : t.badge;
    return `
      <article class="tour-card" data-tour="${esc(t.id)}" tabindex="0" aria-label="${esc(t.title)}">
        <div class="tour-media">
          <img src="${esc(t.image)}" alt="${esc(t.title)}" loading="lazy" />
          ${badge ? `<span class="badge ${badgeClass}">${esc(badge)}</span>` : ""}
          <button class="wish" data-wish="${esc(t.id)}" aria-pressed="${wish}" aria-label="${wish ? "Remove from" : "Save to"} wishlist">
            <i class="fa-${wish ? "solid" : "regular"} fa-heart"></i>
          </button>
        </div>
        <div class="tour-body">
          <p class="tour-loc"><i class="fa-solid fa-location-dot"></i>${esc(t.city)}, ${esc(t.country)}</p>
          <h3>${esc(t.title)}</h3>
          <div class="tour-meta">
            <span><i class="fa-regular fa-clock"></i>${durationLabel(t.durationHours)}</span>
            <span><i class="fa-solid fa-user-group"></i>Max ${t.groupSize}</span>
            ${guide ? `<span><i class="fa-solid fa-language"></i>${esc(guide.languages.slice(0, 2).join(", "))}</span>` : ""}
          </div>
          <div class="tour-foot">
            <div class="rating"><i class="fa-solid fa-star"></i> ${t.rating.toFixed(1)} <span>(${num(t.reviews)})</span></div>
            <div class="price">from<strong>${money(t.price)}</strong>per person</div>
          </div>
        </div>
      </article>`;
  }

  function renderTours() {
    const list = filteredTours();
    $("#tourGrid").innerHTML = list.map(tourCard).join("");
    $("#emptyState").hidden = list.length > 0;
    const active = filters.category !== "all" || filters.dest || filters.q;
    $("#clearFilters").hidden = !active;
    const where = filters.dest ? ` in ${filters.dest}` : "";
    $("#resultCount").textContent = `${list.length} ${list.length === 1 ? "tour" : "tours"}${where}`;
  }

  function renderDestinations() {
    $("#destGrid").innerHTML = destinations()
      .map(
        (d) => `
        <button class="dest-card" data-dest="${esc(d.city)}" aria-label="See tours in ${esc(d.city)}">
          <img src="${esc(d.image)}" alt="" loading="lazy" />
          <div class="dest-info">
            <h3>${esc(d.city)}</h3>
            <p>${esc(d.country)}</p>
            <span class="pill">${d.count} ${d.count === 1 ? "tour" : "tours"} · from ${money(d.from)}</span>
          </div>
        </button>`
      )
      .join("");
  }

  function guideAvatar(g, size = "") {
    return `<div class="guide-avatar ${size}" style="background:${esc(g.color)}">${initials(g.name)}
      <span class="verified" title="Verified guide"><i class="fa-solid fa-check"></i></span></div>`;
  }

  function renderGuides() {
    $("#guideRow").innerHTML = GUIDES.map(
      (g) => `
      <article class="guide-card">
        ${guideAvatar(g)}
        <h3>${esc(g.name)}</h3>
        <p class="guide-city"><i class="fa-solid fa-location-dot"></i> ${esc(g.city)}</p>
        <div class="guide-stats">
          <span><strong>★ ${g.rating.toFixed(2)}</strong></span>
          <span><strong>${num(g.tours)}</strong> tours</span>
          <span><strong>${g.years}</strong> yrs</span>
        </div>
        <p class="guide-bio">${esc(g.bio)}</p>
        <div class="langs">${g.languages.map((l) => `<span>${esc(l)}</span>`).join("")}</div>
      </article>`
    ).join("");
  }

  function renderReviews() {
    $("#reviewGrid").innerHTML = REVIEWS.map((r) => {
      const t = tourById(r.tour);
      return `
      <article class="review-card">
        <span class="stars" aria-label="${r.rating} out of 5 stars">${starIcons(r.rating)}</span>
        <blockquote>“${esc(r.text)}”</blockquote>
        <footer>
          <span class="avatar">${initials(r.name)}</span>
          <div>
            <strong>${esc(r.name)}</strong>
            <small>${esc(r.from)} · ${esc(r.date)}</small>
            ${t ? `<button class="review-tour" data-tour-link="${esc(t.id)}">${esc(t.title)}</button>` : ""}
          </div>
        </footer>
      </article>`;
    }).join("");
  }

  function renderFaq() {
    $("#faqList").innerHTML = FAQS.map(
      (f, i) => `<details ${i === 0 ? "open" : ""}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`
    ).join("");
  }

  function renderCounts() {
    const wish = store.get(KEYS.wishlist, []).length;
    const user = session();
    const upcoming = user
      ? store.get(KEYS.bookings, []).filter((b) => b.user === user.username && b.status === "confirmed" && b.date >= todayISO()).length
      : 0;
    $("#wishCount").hidden = !wish;
    $("#wishCount").textContent = wish;
    $("#bookingCount").hidden = !upcoming;
    $("#bookingCount").textContent = upcoming;
  }

  function renderAccount() {
    const user = session();
    const area = $("#accountArea");
    $("#adminBtn").hidden = !isAdmin();
    if (!user) {
      area.innerHTML = `<button class="btn btn-sm btn-ghost-light" id="signInBtn"><i class="fa-regular fa-user"></i> Sign in</button>`;
    } else {
      area.innerHTML = `
        <button class="account-btn" id="accountBtn" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">
          <span class="avatar">${initials(user.name)}</span>
        </button>
        <div class="account-menu" id="accountMenu" role="menu">
          <div class="who"><strong>${esc(user.name)}</strong><small>${esc(user.email || user.username)}</small></div>
          <button data-action="bookings" role="menuitem"><i class="fa-regular fa-calendar-check"></i> My bookings</button>
          <button data-action="wishlist" role="menuitem"><i class="fa-regular fa-heart"></i> Wishlist</button>
          ${user.role === "admin" ? `<button data-action="admin" role="menuitem"><i class="fa-solid fa-gauge-high"></i> Admin dashboard</button>` : ""}
          <button data-action="logout" role="menuitem"><i class="fa-solid fa-arrow-right-from-bracket"></i> Sign out</button>
        </div>`;
    }
    renderCounts();
  }

  /* =========================================================
     TOUR DETAIL + BOOKING
     ========================================================= */
  let booking = null;

  // Deterministic pseudo-availability so the same date always shows the same spots.
  function spotsLeft(tour, date) {
    if (!date) return null;
    let h = 0;
    for (const c of tour.id + date) h = (h * 33 + c.charCodeAt(0)) % 9973;
    const base = h % 13 === 0 ? 0 : Math.max(2, tour.groupSize - (h % tour.groupSize));
    const booked = store
      .get(KEYS.bookings, [])
      .filter((b) => b.tourId === tour.id && b.date === date && b.status === "confirmed" && !b.private)
      .reduce((s, b) => s + b.adults + b.children, 0);
    return Math.max(0, base - booked);
  }

  function priceFor(b) {
    const t = tourById(b.tourId);
    const adults = b.adults * t.price;
    const children = b.children * t.price * SITE.childRate;
    let subtotal = adults + children;
    const privateFee = b.private ? subtotal * SITE.privateSurcharge : 0;
    subtotal += privateFee;
    const rate = b.promoApplied ? SITE.promoCodes[b.promoApplied] : 0;
    const discount = subtotal * rate;
    return { adults, children, privateFee, discount, total: Math.round((subtotal - discount) * 100) / 100 };
  }

  function openTour(id) {
    const t = tourById(id);
    if (!t) return;
    const g = guideById(t.guide);
    const date = prefs.date && prefs.date > todayISO() ? prefs.date : "";
    booking = {
      tourId: t.id,
      date,
      time: t.times?.[0] ?? "09:00",
      adults: Math.max(1, Math.min(prefs.guests || 2, t.groupSize)),
      children: 0,
      private: false,
      promoApplied: null,
    };
    const reviews = REVIEWS.filter((r) => r.tour === t.id);

    $("#tourModalBody").innerHTML = `
      <div class="td-hero">
        <img src="${esc(t.image)}" alt="${esc(t.title)}" />
        <div class="td-hero-text">
          <p class="eyebrow light">${esc(categoryLabel(t.category))} · ${esc(t.city)}, ${esc(t.country)}</p>
          <h2 id="tourModalTitle">${esc(t.title)}</h2>
          <div class="rating"><i class="fa-solid fa-star"></i> ${t.rating.toFixed(1)} <span>(${num(t.reviews)} reviews)</span></div>
        </div>
      </div>
      <div class="td-layout">
        <div>
          <div class="facts">
            <div class="fact"><small><i class="fa-regular fa-clock"></i> Duration</small><strong>${durationLabel(t.durationHours)}</strong></div>
            <div class="fact"><small><i class="fa-solid fa-user-group"></i> Group</small><strong>Max ${t.groupSize}</strong></div>
            <div class="fact"><small><i class="fa-solid fa-language"></i> Languages</small><strong>${esc(g ? g.languages.join(", ") : "English")}</strong></div>
            <div class="fact"><small><i class="fa-solid fa-rotate-left"></i> Cancel</small><strong>Free up to 24h</strong></div>
          </div>

          <div class="td-section"><h3>Overview</h3><p>${esc(t.summary)}</p></div>

          ${t.highlights?.length ? `<div class="td-section"><h3>Highlights</h3>
            <ul class="check-list">${t.highlights.map((h) => `<li><i class="fa-solid fa-check"></i>${esc(h)}</li>`).join("")}</ul></div>` : ""}

          ${t.itinerary?.length ? `<div class="td-section"><h3>Itinerary</h3><ol class="timeline">
            ${t.itinerary.map((s) => `<li><span class="t-time">${esc(s.time)}</span><strong>${esc(s.title)}</strong><p>${esc(s.text)}</p></li>`).join("")}
          </ol></div>` : ""}

          ${t.includes?.length || t.excludes?.length ? `<div class="td-section two-col">
            <div><h3>What's included</h3><ul class="check-list">${(t.includes || []).map((x) => `<li><i class="fa-solid fa-check"></i>${esc(x)}</li>`).join("")}</ul></div>
            <div><h3>Not included</h3><ul class="check-list no">${(t.excludes || []).map((x) => `<li><i class="fa-solid fa-xmark"></i>${esc(x)}</li>`).join("")}</ul></div>
          </div>` : ""}

          ${t.meetingPoint ? `<div class="td-section"><h3>Meeting point</h3>
            <p class="meeting"><i class="fa-solid fa-location-dot"></i><span>${esc(t.meetingPoint)}<br/><a class="link-btn" target="_blank" rel="noopener"
              href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.meetingPoint + ", " + t.city)}">Open in Google Maps</a></span></p></div>` : ""}

          ${g ? `<div class="td-section"><h3>Your guide</h3>
            <div class="guide-mini">${guideAvatar(g)}<div><strong>${esc(g.name)}</strong> · ★ ${g.rating.toFixed(2)} · ${num(g.tours)} tours
            <p>${esc(g.bio)}</p></div></div></div>` : ""}

          ${reviews.length ? `<div class="td-section"><h3>What travellers say</h3>
            ${reviews.map((r) => `<div class="guide-mini"><div><span class="stars">${starIcons(r.rating)}</span><p>“${esc(r.text)}”</p><small>— ${esc(r.name)}, ${esc(r.from)}</small></div></div>`).join("")}</div>` : ""}
        </div>

        <aside class="book-panel" aria-label="Book this tour">
          <div class="book-price"><span>from</span><strong>${money(t.price)}</strong><span>per adult</span></div>
          <div class="stack">
            <label>Date<input type="date" id="bkDate" min="${addDaysISO(1)}" value="${date}" /></label>
            <p class="availability" id="bkAvail"></p>
            <div>
              <label style="margin-bottom:6px">Start time</label>
              <div class="slot-group" id="bkTimes">
                ${(t.times || ["09:00"]).map((tm) => `<button type="button" class="slot ${tm === booking.time ? "active" : ""}" data-time="${esc(tm)}">${esc(tm)}</button>`).join("")}
              </div>
            </div>
            <div>
              <div class="counter-row"><label>Adults<small>Age 12+</small></label>
                <div class="counter"><button type="button" data-count="adults" data-d="-1" aria-label="Fewer adults">−</button><output id="bkAdults"></output><button type="button" data-count="adults" data-d="1" aria-label="More adults">+</button></div></div>
              <div class="counter-row"><label>Children<small>Age 2–11 · ${Math.round(SITE.childRate * 100)}% price</small></label>
                <div class="counter"><button type="button" data-count="children" data-d="-1" aria-label="Fewer children">−</button><output id="bkChildren"></output><button type="button" data-count="children" data-d="1" aria-label="More children">+</button></div></div>
            </div>
            <label class="toggle"><input type="checkbox" id="bkPrivate" /> Make it a private tour <small>(+${Math.round(SITE.privateSurcharge * 100)}%)</small></label>
            <div class="promo-row"><input id="bkPromo" placeholder="Promo code" aria-label="Promo code" /><button type="button" class="btn btn-outline btn-sm" id="bkPromoBtn">Apply</button></div>
            <div class="breakdown" id="bkBreakdown"></div>
            <button class="btn btn-accent btn-lg btn-block" id="bkReserve"><i class="fa-solid fa-lock"></i> Reserve now</button>
            <ul class="assure">
              <li><i class="fa-solid fa-circle-check"></i>Free cancellation up to 24h before</li>
              <li><i class="fa-solid fa-circle-check"></i>Reserve now, pay on the day</li>
              <li><i class="fa-solid fa-circle-check"></i>Instant confirmation</li>
            </ul>
          </div>
        </aside>
      </div>`;

    updateBookingPanel();
    openDialog("#tourModal");
    $("#tourModalBody").scrollTop = 0;
    try { history.replaceState(null, "", `?tour=${encodeURIComponent(t.id)}${location.hash}`); } catch {}
  }

  function updateBookingPanel() {
    if (!booking) return;
    const t = tourById(booking.tourId);
    const left = spotsLeft(t, booking.date);
    const guests = booking.adults + booking.children;
    const cap = booking.private ? t.groupSize : left ?? t.groupSize;

    $("#bkAdults").textContent = booking.adults;
    $("#bkChildren").textContent = booking.children;
    $('[data-count="adults"][data-d="-1"]').disabled = booking.adults <= 1;
    $('[data-count="children"][data-d="-1"]').disabled = booking.children <= 0;
    $$('[data-count][data-d="1"]').forEach((b) => (b.disabled = guests >= Math.max(cap, 1)));

    const avail = $("#bkAvail");
    let canBook = true;
    if (!booking.date) {
      avail.className = "availability";
      avail.textContent = "Select a date to check availability";
      canBook = false;
    } else if (booking.private) {
      avail.className = "availability ok";
      avail.innerHTML = `<i class="fa-solid fa-circle-check"></i> Private guide available on this date`;
    } else if (left === 0) {
      avail.className = "availability none";
      avail.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Sold out — try another date or book private`;
      canBook = false;
    } else if (guests > left) {
      avail.className = "availability none";
      avail.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Only ${left} spots left on this date`;
      canBook = false;
    } else if (left <= 4) {
      avail.className = "availability low";
      avail.innerHTML = `<i class="fa-solid fa-fire"></i> Only ${left} spots left — book soon`;
    } else {
      avail.className = "availability ok";
      avail.innerHTML = `<i class="fa-solid fa-circle-check"></i> Available · ${left} spots left`;
    }

    const p = priceFor(booking);
    $("#bkBreakdown").innerHTML = `
      <div><span>${booking.adults} × Adult</span><span>${money(p.adults)}</span></div>
      ${booking.children ? `<div><span>${booking.children} × Child</span><span>${money(p.children)}</span></div>` : ""}
      ${booking.private ? `<div><span>Private tour</span><span>${money(p.privateFee)}</span></div>` : ""}
      ${booking.promoApplied ? `<div class="discount"><span>Promo ${esc(booking.promoApplied)}</span><span>−${money(p.discount)}</span></div>` : ""}
      <div class="total"><span>Total</span><span>${money(p.total)}</span></div>`;
    $("#bkReserve").disabled = !canBook;
  }

  async function reserve() {
    if (!booking?.date) return toast("Please choose a date first", "error");
    if (!session()) {
      pendingAction = reserve;
      openAuth("login", "Sign in to complete your booking — it takes 10 seconds.");
      return;
    }
    const t = tourById(booking.tourId);
    const user = session();
    const p = priceFor(booking);
    const record = {
      ref: "SW-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
      user: user.username,
      userName: user.name,
      tourId: t.id,
      tourTitle: t.title,
      image: t.image,
      city: t.city,
      date: booking.date,
      time: booking.time,
      adults: booking.adults,
      children: booking.children,
      private: booking.private,
      promo: booking.promoApplied,
      total: p.total,
      status: "confirmed",
      createdAt: new Date().toISOString(),
    };
    const all = store.get(KEYS.bookings, []);
    all.push(record);
    store.set(KEYS.bookings, all);
    closeDialog("#tourModal");
    showConfirmation(record);
    renderCounts();
  }

  function showConfirmation(b) {
    const t = tourById(b.tourId);
    const g = t && guideById(t.guide);
    $("#confirmBody").innerHTML = `
      <div class="confirm">
        <div class="confirm-icon"><i class="fa-solid fa-check"></i></div>
        <h2 id="confirmTitle">You're booked!</h2>
        <p>A confirmation has been added to <strong>My bookings</strong>.</p>
        <span class="ref">${esc(b.ref)}</span>
        <dl class="summary-list">
          <div><dt>Tour</dt><dd>${esc(b.tourTitle)}</dd></div>
          <div><dt>Date</dt><dd>${prettyDate(b.date)} · ${esc(b.time)}</dd></div>
          <div><dt>Travellers</dt><dd>${b.adults} adult${b.adults > 1 ? "s" : ""}${b.children ? `, ${b.children} child${b.children > 1 ? "ren" : ""}` : ""}${b.private ? " · Private" : ""}</dd></div>
          ${g ? `<div><dt>Guide</dt><dd>${esc(g.name)}</dd></div>` : ""}
          ${t?.meetingPoint ? `<div><dt>Meet at</dt><dd>${esc(t.meetingPoint)}</dd></div>` : ""}
          <div><dt>Total (pay on the day)</dt><dd>${money(b.total)}</dd></div>
        </dl>
        <button class="btn btn-primary btn-block" data-action="bookings">View my bookings</button>
      </div>`;
    openDialog("#confirmModal");
  }

  /* =========================================================
     DRAWER — bookings & wishlist
     ========================================================= */
  function bookingStatus(b) {
    if (b.status === "cancelled") return "cancelled";
    return b.date < todayISO() ? "completed" : "confirmed";
  }

  function openBookings() {
    const user = session();
    if (!user) {
      pendingAction = openBookings;
      return openAuth("login", "Sign in to see your bookings.");
    }
    const list = store
      .get(KEYS.bookings, [])
      .filter((b) => b.user === user.username)
      .sort((a, b) => a.date.localeCompare(b.date));
    $("#drawerTitle").textContent = "My bookings";
    $("#drawerBody").innerHTML = list.length
      ? list
          .map((b) => {
            const st = bookingStatus(b);
            const start = new Date(`${b.date}T${b.time}`);
            const freeCancel = start - Date.now() > 24 * 3600 * 1000;
            return `
            <article class="mini-card">
              <img src="${esc(b.image)}" alt="" />
              <div>
                <h4>${esc(b.tourTitle)}</h4>
                <p><i class="fa-regular fa-calendar"></i> ${prettyDate(b.date)} · ${esc(b.time)}</p>
                <p>${b.adults + b.children} traveller${b.adults + b.children > 1 ? "s" : ""} · ${money(b.total)} · <span style="font-family:monospace">${esc(b.ref)}</span></p>
                <div class="row">
                  <span class="status ${st}">${st}</span>
                  ${st === "confirmed"
                    ? freeCancel
                      ? `<button class="btn-danger-text" data-cancel="${esc(b.ref)}">Cancel booking</button>`
                      : `<small class="muted">Non-refundable (&lt;24h)</small>`
                    : ""}
                </div>
              </div>
            </article>`;
          })
          .join("")
      : `<div class="drawer-empty"><i class="fa-regular fa-calendar"></i><p>No bookings yet.<br/>Your next adventure is a click away.</p>
         <a href="#tours" class="btn btn-primary" data-close-drawer>Browse tours</a></div>`;
    openDialog("#drawer");
  }

  function cancelBooking(ref) {
    if (!confirm("Cancel this booking? You'll receive a full refund.")) return;
    const all = store.get(KEYS.bookings, []);
    const b = all.find((x) => x.ref === ref);
    if (b) b.status = "cancelled";
    store.set(KEYS.bookings, all);
    toast("Booking cancelled — full refund issued");
    openBookings();
    renderCounts();
  }

  function openWishlist() {
    const ids = store.get(KEYS.wishlist, []);
    const tours = ids.map(tourById).filter(Boolean);
    $("#drawerTitle").textContent = "Wishlist";
    $("#drawerBody").innerHTML = tours.length
      ? tours
          .map(
            (t) => `
          <article class="mini-card">
            <img src="${esc(t.image)}" alt="" />
            <div>
              <h4>${esc(t.title)}</h4>
              <p>${esc(t.city)} · ${durationLabel(t.durationHours)} · ★ ${t.rating.toFixed(1)}</p>
              <div class="row">
                <strong>${money(t.price)}</strong>
                <span>
                  <button class="btn btn-sm btn-primary" data-tour-link="${esc(t.id)}">View</button>
                  <button class="btn-danger-text" data-wish="${esc(t.id)}">Remove</button>
                </span>
              </div>
            </div>
          </article>`
          )
          .join("")
      : `<div class="drawer-empty"><i class="fa-regular fa-heart"></i><p>Tap the heart on any tour to save it here.</p>
         <a href="#tours" class="btn btn-primary" data-close-drawer>Browse tours</a></div>`;
    openDialog("#drawer");
  }

  function toggleWish(id) {
    const list = store.get(KEYS.wishlist, []);
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else list.push(id);
    store.set(KEYS.wishlist, list);
    toast(i >= 0 ? "Removed from wishlist" : "Saved to wishlist");
    renderTours();
    renderCounts();
    if ($("#drawer").open && $("#drawerTitle").textContent === "Wishlist") openWishlist();
  }

  /* =========================================================
     AUTH
     ========================================================= */
  function openAuth(tab = "login", message) {
    switchAuthTab(tab);
    $("#authSub").textContent = message || "Sign in to book tours and manage your trips.";
    $$("#authModal form").forEach((f) => {
      f.reset();
      $("[data-error]", f).textContent = "";
    });
    openDialog("#authModal");
    setTimeout(() => $(`#${tab}Form input`)?.focus(), 50);
  }

  function switchAuthTab(tab) {
    $$("[data-auth-tab]").forEach((b) => {
      const on = b.dataset.authTab === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on);
    });
    $("#loginForm").hidden = tab !== "login";
    $("#signupForm").hidden = tab !== "signup";
    $("#authTitle").textContent = tab === "login" ? "Welcome back" : "Create your account";
  }

  function finishAuth(user) {
    store.set(KEYS.session, user);
    closeDialog("#authModal");
    renderAccount();
    toast(`Welcome, ${user.name.split(" ")[0]}!`);
    const next = pendingAction;
    pendingAction = null;
    if (next) next();
  }

  async function handleLogin(e) {
    e.preventDefault();
    const f = e.target;
    const err = $("[data-error]", f);
    const id = f.username.value.trim();
    const pw = f.password.value;
    if (!id || !pw) return (err.textContent = "Please enter your username and password.");

    if (id === "admin") {
      if (pw === "admin") return finishAuth({ username: "admin", name: "Administrator", email: "", role: "admin" });
      return (err.textContent = "Incorrect admin password.");
    }
    const users = store.get(KEYS.users, []);
    const u = users.find((x) => x.username.toLowerCase() === id.toLowerCase() || x.email.toLowerCase() === id.toLowerCase());
    if (!u || u.passHash !== (await hashPassword(pw))) return (err.textContent = "Username or password is incorrect.");
    finishAuth({ username: u.username, name: u.name, email: u.email, role: "user" });
  }

  async function handleSignup(e) {
    e.preventDefault();
    const f = e.target;
    const err = $("[data-error]", f);
    const data = Object.fromEntries(new FormData(f));
    Object.keys(data).forEach((k) => (data[k] = data[k].trim()));
    $$("input", f).forEach((i) => i.classList.toggle("invalid", !i.checkValidity()));
    if (!f.checkValidity()) return (err.textContent = "Please complete all fields correctly.");
    if (data.username.toLowerCase() === "admin") return (err.textContent = "That username is reserved.");
    const users = store.get(KEYS.users, []);
    if (users.some((u) => u.username.toLowerCase() === data.username.toLowerCase()))
      return (err.textContent = "That username is already taken.");
    if (users.some((u) => u.email.toLowerCase() === data.email.toLowerCase()))
      return (err.textContent = "An account with this email already exists.");
    users.push({
      name: data.name,
      email: data.email,
      username: data.username,
      passHash: await hashPassword(data.password),
      createdAt: new Date().toISOString(),
    });
    store.set(KEYS.users, users);
    finishAuth({ username: data.username, name: data.name, email: data.email, role: "user" });
  }

  function logout() {
    store.set(KEYS.session, null);
    renderAccount();
    toast("You've been signed out");
  }

  /* =========================================================
     ADMIN
     ========================================================= */
  function openAdmin() {
    if (!isAdmin()) return;
    $("#addCategory").innerHTML = CATEGORIES.map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join("");
    $("#addGuide").innerHTML = GUIDES.map((g) => `<option value="${g.id}">${esc(g.name)} (${esc(g.city)})</option>`).join("");
    renderAdmin();
    switchAdminTab("add");
    openDialog("#adminModal");
  }

  function switchAdminTab(tab) {
    $$("[data-admin-tab]").forEach((b) => b.classList.toggle("active", b.dataset.adminTab === tab));
    $$("[data-admin-panel]").forEach((p) => (p.hidden = p.dataset.adminPanel !== tab));
  }

  function renderAdmin() {
    const bookings = store.get(KEYS.bookings, []);
    const confirmed = bookings.filter((b) => b.status === "confirmed");
    const revenue = confirmed.reduce((s, b) => s + b.total, 0);
    const messages = store.get(KEYS.messages, []);
    const subs = store.get(KEYS.subscribers, []);
    $("#adminKpis").innerHTML = `
      <div class="kpi"><small>Active bookings</small><strong>${confirmed.length}</strong></div>
      <div class="kpi"><small>Booked revenue</small><strong>${money(revenue)}</strong></div>
      <div class="kpi"><small>Tours live</small><strong>${allTours().length}</strong></div>
      <div class="kpi"><small>Registered users</small><strong>${store.get(KEYS.users, []).length}</strong></div>`;

    $('[data-admin-panel="manage"]').innerHTML = `<div class="table-wrap"><table class="data">
      <thead><tr><th></th><th>Tour</th><th>City</th><th>Price</th><th>Rating</th><th></th></tr></thead>
      <tbody>${allTours()
        .map(
          (t) => `<tr><td><img src="${esc(t.image)}" alt="" /></td><td>${esc(t.title)}${t.custom ? ' <span class="status confirmed">custom</span>' : ""}</td>
          <td>${esc(t.city)}</td><td>${money(t.price)}</td><td>★ ${t.rating.toFixed(1)}</td>
          <td>${t.custom ? `<button class="btn-danger-text" data-del-tour="${esc(t.id)}">Delete</button>` : '<small style="color:var(--muted)">Catalogue</small>'}</td></tr>`
        )
        .join("")}</tbody></table></div>`;

    $('[data-admin-panel="bookings"]').innerHTML = bookings.length
      ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Ref</th><th>Customer</th><th>Tour</th><th>Date</th><th>Guests</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>${[...bookings]
          .reverse()
          .map(
            (b) => `<tr><td style="font-family:monospace">${esc(b.ref)}</td><td>${esc(b.userName)}<br/><small>@${esc(b.user)}</small></td>
            <td>${esc(b.tourTitle)}</td><td>${esc(b.date)} ${esc(b.time)}</td><td>${b.adults + b.children}${b.private ? " (private)" : ""}</td>
            <td>${money(b.total)}</td><td><span class="status ${bookingStatus(b)}">${bookingStatus(b)}</span></td></tr>`
          )
          .join("")}</tbody></table></div>`
      : `<p class="drawer-empty">No bookings yet.</p>`;

    $('[data-admin-panel="messages"]').innerHTML = `
      <h3>Contact messages (${messages.length})</h3>
      ${messages.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>From</th><th>Topic</th><th>Message</th></tr></thead><tbody>
        ${[...messages].reverse().map((m) => `<tr><td>${new Date(m.date).toLocaleDateString()}</td><td>${esc(m.name)}<br/><a class="link-btn" href="mailto:${esc(m.email)}">${esc(m.email)}</a>${m.phone ? `<br/><small>${esc(m.phone)}</small>` : ""}</td><td>${esc(m.topic)}</td><td>${esc(m.message)}</td></tr>`).join("")}
      </tbody></table></div>` : `<p style="color:var(--muted)">No messages yet.</p>`}
      <h3 style="margin-top:24px">Newsletter subscribers (${subs.length})</h3>
      <p style="color:var(--muted)">${subs.length ? subs.map(esc).join(", ") : "No subscribers yet."}</p>`;
  }

  function handleAddTour(e) {
    e.preventDefault();
    const f = e.target;
    const err = $("[data-error]", f);
    $$("input[required], textarea[required]", f).forEach((i) => i.classList.toggle("invalid", !i.value.trim()));
    if (!f.checkValidity()) return (err.textContent = "Please fill in all required fields.");
    const d = Object.fromEntries(new FormData(f));
    const list = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
    const tour = {
      id: "custom-" + Date.now().toString(36),
      custom: true,
      title: d.title.trim(),
      city: d.city.trim(),
      country: d.country.trim(),
      category: d.category,
      guide: d.guide,
      image: d.image.trim(),
      price: Number(d.price),
      durationHours: Number(d.durationHours),
      groupSize: Number(d.groupSize),
      times: list(d.times).length ? list(d.times) : ["09:00"],
      summary: d.summary.trim(),
      highlights: list(d.highlights),
      meetingPoint: d.meetingPoint.trim(),
      rating: 5,
      reviews: 0,
      badge: "",
      itinerary: [],
      includes: ["Licensed local guide"],
      excludes: [],
    };
    const custom = store.get(KEYS.customTours, []);
    custom.push(tour);
    store.set(KEYS.customTours, custom);
    f.reset();
    err.textContent = "";
    refreshCatalogue();
    renderAdmin();
    toast(`"${tour.title}" is now live`);
  }

  function deleteTour(id) {
    if (!confirm("Delete this tour? Existing bookings will be kept.")) return;
    store.set(KEYS.customTours, store.get(KEYS.customTours, []).filter((t) => t.id !== id));
    refreshCatalogue();
    renderAdmin();
    toast("Tour deleted");
  }

  /* =========================================================
     DIALOG UTILITIES
     ========================================================= */
  function openDialog(sel) {
    const d = $(sel);
    if (!d.open) d.showModal();
    document.body.style.overflow = "hidden";
    const box = $("#toasts"); // keep visible toasts above the new dialog
    try {
      if (box.matches(":popover-open")) { box.hidePopover(); box.showPopover(); }
    } catch {}
  }
  function closeDialog(sel) {
    const d = typeof sel === "string" ? $(sel) : sel;
    if (d.open) d.close();
  }
  $$("dialog").forEach((d) => {
    d.addEventListener("close", () => {
      if (!$$("dialog").some((x) => x.open)) document.body.style.overflow = "";
      if (d.id === "tourModal") try { history.replaceState(null, "", location.pathname + location.hash); } catch {}
      if (d.id === "authModal" && pendingAction && !session()) pendingAction = null;
    });
    // click on backdrop closes
    d.addEventListener("click", (e) => {
      if (e.target === d) d.close();
    });
  });

  /* =========================================================
     EVENTS
     ========================================================= */
  function refreshCatalogue() {
    renderDestinationSelects();
    renderTours();
    renderDestinations();
  }

  function goToTours() {
    renderCategoryChips();
    renderTours();
    $("#tours").scrollIntoView({ behavior: "smooth" });
  }

  // Global click delegation
  document.addEventListener("click", (e) => {
    const t = e.target;

    const wish = t.closest("[data-wish]");
    if (wish) {
      e.stopPropagation();
      return toggleWish(wish.dataset.wish);
    }

    const card = t.closest(".tour-card");
    if (card) return openTour(card.dataset.tour);

    const tourLink = t.closest("[data-tour-link]");
    if (tourLink) {
      closeDialog("#drawer");
      return openTour(tourLink.dataset.tourLink);
    }

    const chip = t.closest("[data-cat]");
    if (chip) {
      filters.category = chip.dataset.cat;
      renderCategoryChips();
      return renderTours();
    }

    const dest = t.closest("[data-dest]");
    if (dest) {
      filters.dest = dest.dataset.dest;
      $("#destFilter").value = filters.dest;
      return goToTours();
    }

    if (t.closest("[data-close]")) return closeDialog(t.closest("dialog"));
    if (t.closest("[data-close-drawer]")) return closeDialog("#drawer");

    const cancel = t.closest("[data-cancel]");
    if (cancel) return cancelBooking(cancel.dataset.cancel);

    const delTour = t.closest("[data-del-tour]");
    if (delTour) return deleteTour(delTour.dataset.delTour);

    const scrollBtn = t.closest("[data-scroll]");
    if (scrollBtn) {
      const row = $("#" + scrollBtn.dataset.scroll);
      return row.scrollBy({ left: Number(scrollBtn.dataset.dir) * row.clientWidth * 0.9, behavior: "smooth" });
    }

    // account / generic actions
    if (t.closest("#signInBtn")) return openAuth("login");
    if (t.closest("#accountBtn")) {
      const menu = $("#accountMenu");
      const open = menu.classList.toggle("open");
      $("#accountBtn").setAttribute("aria-expanded", open);
      return;
    }
    const action = t.closest("[data-action]")?.dataset.action;
    $("#accountMenu")?.classList.remove("open");
    if (action === "bookings") {
      closeDialog("#confirmModal");
      return openBookings();
    }
    if (action === "wishlist") return openWishlist();
    if (action === "admin") return openAdmin();
    if (action === "logout") return logout();

    // Booking panel controls
    const slot = t.closest("[data-time]");
    if (slot && booking) {
      booking.time = slot.dataset.time;
      $$("#bkTimes .slot").forEach((s) => s.classList.toggle("active", s === slot));
      return;
    }
    const counter = t.closest("[data-count]");
    if (counter && booking) {
      const key = counter.dataset.count;
      booking[key] = Math.max(key === "adults" ? 1 : 0, booking[key] + Number(counter.dataset.d));
      return updateBookingPanel();
    }
    if (t.closest("#bkPromoBtn")) {
      const code = $("#bkPromo").value.trim().toUpperCase();
      if (SITE.promoCodes[code]) {
        booking.promoApplied = code;
        toast(`Promo ${code} applied — ${Math.round(SITE.promoCodes[code] * 100)}% off`);
      } else {
        booking.promoApplied = null;
        toast("That promo code isn't valid", "error");
      }
      return updateBookingPanel();
    }
    if (t.closest("#bkReserve")) return reserve();

    // nav: close mobile menu after picking a link
    if (t.closest(".main-nav a")) toggleMenu(false);
  });

  // keyboard: open tour card with Enter
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList?.contains("tour-card")) openTour(e.target.dataset.tour);
    if (e.key === "Escape") $("#accountMenu")?.classList.remove("open");
  });

  document.addEventListener("change", (e) => {
    if (!booking) return;
    if (e.target.id === "bkDate") {
      const v = e.target.value;
      booking.date = v && v > todayISO() ? v : "";
      if (v && !booking.date) toast("Please pick a date from tomorrow onwards", "error");
      updateBookingPanel();
    }
    if (e.target.id === "bkPrivate") {
      booking.private = e.target.checked;
      updateBookingPanel();
    }
  });

  // Toolbar
  $("#tourSearch").addEventListener("input", (e) => {
    filters.q = e.target.value;
    renderTours();
  });
  $("#destFilter").addEventListener("change", (e) => {
    filters.dest = e.target.value;
    renderTours();
  });
  $("#sortSelect").addEventListener("change", (e) => {
    filters.sort = e.target.value;
    renderTours();
  });
  const clearAll = () => {
    Object.assign(filters, { category: "all", dest: "", q: "" });
    $("#tourSearch").value = "";
    $("#destFilter").value = "";
    renderCategoryChips();
    renderTours();
  };
  $("#clearFilters").addEventListener("click", clearAll);
  $("#emptyClear").addEventListener("click", clearAll);

  // Hero search
  $("#heroDate").min = addDaysISO(1);
  $("#heroSearch").addEventListener("submit", (e) => {
    e.preventDefault();
    filters.dest = $("#heroDest").value;
    prefs.date = $("#heroDate").value;
    prefs.guests = Number($("#heroGuests").value);
    $("#destFilter").value = filters.dest;
    goToTours();
  });

  // Header buttons
  $("#wishlistBtn").addEventListener("click", openWishlist);
  $("#bookingsBtn").addEventListener("click", openBookings);
  $("#adminBtn").addEventListener("click", openAdmin);

  // Auth forms
  $$("[data-auth-tab]").forEach((b) => b.addEventListener("click", () => switchAuthTab(b.dataset.authTab)));
  $("#loginForm").addEventListener("submit", handleLogin);
  $("#signupForm").addEventListener("submit", handleSignup);

  // Admin
  $$("[data-admin-tab]").forEach((b) => b.addEventListener("click", () => switchAdminTab(b.dataset.adminTab)));
  $("#addTourForm").addEventListener("submit", handleAddTour);

  // Contact form
  $("#contactForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    let ok = true;
    $$("[required]", f).forEach((i) => {
      const valid = i.value.trim() && i.checkValidity();
      i.classList.toggle("invalid", !valid);
      if (!valid) ok = false;
    });
    if (!ok) return toast("Please fill in your name, a valid email and a message", "error");
    const data = Object.fromEntries(new FormData(f));
    const msgs = store.get(KEYS.messages, []);
    msgs.push({ ...data, date: new Date().toISOString() });
    store.set(KEYS.messages, msgs);
    f.reset();
    toast("Thanks! Our travel team will reply within 2 hours.");
  });
  $("#contactForm").addEventListener("input", (e) => e.target.classList.remove("invalid"));

  // Newsletter
  $("#newsletterForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = e.target.querySelector("input").value.trim().toLowerCase();
    const subs = store.get(KEYS.subscribers, []);
    if (!subs.includes(email)) subs.push(email);
    store.set(KEYS.subscribers, subs);
    e.target.reset();
    toast("You're subscribed — welcome aboard!");
  });

  // Promo code copy
  $("#copyCode").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText("SUMMER15");
      toast("Code SUMMER15 copied");
    } catch {
      toast("Use code SUMMER15 at checkout");
    }
  });

  // Mobile menu
  function toggleMenu(force) {
    const open = $("#mainNav").classList.toggle("open", force);
    $("#menuToggle").setAttribute("aria-expanded", open);
    $("#menuToggle i").className = `fa-solid ${open ? "fa-xmark" : "fa-bars"}`;
  }
  $("#menuToggle").addEventListener("click", () => toggleMenu());

  // Close account menu when clicking elsewhere
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".account")) $("#accountMenu")?.classList.remove("open");
  });

  // Header style on scroll
  const header = $("#siteHeader");
  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 40 || $("#mainNav").classList.contains("open"));
  window.addEventListener("scroll", onScroll, { passive: true });
  $("#menuToggle").addEventListener("click", onScroll);

  // Highlight active nav link
  const navLinks = $$(".main-nav a");
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.isIntersecting) navLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + en.target.id));
      }),
    { rootMargin: "-45% 0px -50% 0px" }
  );
  ["tours", "destinations", "guides", "reviews", "faq", "contact"].forEach((id) => io.observe($("#" + id)));

  /* ---------- Init ---------- */
  $("#siteAddress").textContent = SITE.address;
  $("#sitePhone").textContent = SITE.phone;
  $("#sitePhone").href = "tel:" + SITE.phone.replace(/[^\d+]/g, "");
  $("#siteEmail").textContent = SITE.email;
  $("#siteEmail").href = "mailto:" + SITE.email;
  $("#year").textContent = new Date().getFullYear();

  renderCategoryChips();
  refreshCatalogue();
  renderGuides();
  renderReviews();
  renderFaq();
  renderAccount();
  onScroll();

  // Deep link: ?tour=<id> opens that tour
  const deep = new URLSearchParams(location.search).get("tour");
  if (deep && tourById(deep)) openTour(deep);
})();
