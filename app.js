/* =====================================================================
   On-Site Computer Service — Repair Tracker
   Plain JS (no build step). Talks to Supabase. Two views:
     • Management app  (default)        — full access, password-gated
     • Status page     (?view=status)   — read-only, for Linda at home
   ===================================================================== */
(function () {
  "use strict";

  // ---------- Shop info ----------
  var SHOP = {
    name: "On-Site Computer Service",
    address: "53 Cabarrus Ave. West",
    cityzip: "Concord, NC 28025",
    phone: "980-236-0810",
    web: "www.onsitecomputerservice.net",
    tagline: "Your Computer's Doctor",
    diagFee: 129,
    taxRate: 0.07,
  };

  var STATUSES = [
    "Checked In", "Diagnosed", "Waiting on Parts",
    "In Repair", "Ready for Pickup", "Picked Up",
  ];
  var STATUS_STYLE = {
    "Checked In":       { bg: "#E8EEFB", fg: "#27408B", dot: "#3B5BA5" },
    "Diagnosed":        { bg: "#FBF3D9", fg: "#7A5C00", dot: "#C8A85A" },
    "Waiting on Parts": { bg: "#FBE7D6", fg: "#9A4A12", dot: "#E07B39" },
    "In Repair":        { bg: "#E6F0E1", fg: "#3C6B2E", dot: "#5E9A4B" },
    "Ready for Pickup": { bg: "#D9F0D6", fg: "#1F7A1F", dot: "#2FA82F" },
    "Picked Up":        { bg: "#E4E4E4", fg: "#555555", dot: "#999999" },
  };
  var CONTACT_PREF = ["Call", "Text", "Email"];
  var BACKUP_STATUS = ["Confirms backed up", "Requests backup service", "Declines backup"];
  var YESNO = ["Yes", "No"];
  var PAY_METHODS = ["Cash", "Card", "Check", "PayByLink", "Other"];
  var DOC_TYPES = ["Service Order", "Quote", "Receipt", "Diagnostic Receipt"];

  // ---------- DB column map (snake_case in Supabase) ----------
  // app field  ->  db column
  var FIELDS = {
    id: "id",
    dateCheckedIn: "date_checked_in",
    customerName: "customer_name",
    phone: "phone",
    email: "email",
    address: "address",
    cityStateZip: "city_state_zip",
    preferredContact: "preferred_contact",
    device: "device",
    brandModel: "brand_model",
    serialNumber: "serial_number",
    passwordPin: "password_pin",
    accessories: "accessories",
    backupStatus: "backup_status",
    problem: "problem",
    status: "status",
    waitingOnParts: "waiting_on_parts",
    readyForPickup: "ready_for_pickup",
    estimatedCost: "estimated_cost",
    diagnosticFindings: "diagnostic_findings",
    diagnosticFeePaid: "diagnostic_fee_paid",
    partsAmount: "parts_amount",
    laborAmount: "labor_amount",
    paymentMethod: "payment_method",
    dateCompleted: "date_completed",
    completed: "completed",
  };
  function toRow(o) {
    var r = {};
    for (var k in FIELDS) if (o[k] !== undefined) r[FIELDS[k]] = o[k] === "" ? null : o[k];
    return r;
  }
  function fromRow(row) {
    var o = {};
    for (var k in FIELDS) o[k] = row[FIELDS[k]] == null ? "" : row[FIELDS[k]];
    return o;
  }

  function blankRepair() {
    return {
      dateCheckedIn: new Date().toISOString().slice(0, 10),
      customerName: "", phone: "", email: "", address: "", cityStateZip: "",
      preferredContact: "Call", device: "", brandModel: "", serialNumber: "",
      passwordPin: "", accessories: "", backupStatus: "Confirms backed up",
      problem: "", status: "Checked In", waitingOnParts: "No", readyForPickup: "No",
      estimatedCost: "", diagnosticFindings: "", diagnosticFeePaid: "No",
      partsAmount: "", laborAmount: "", paymentMethod: "", dateCompleted: "",
      completed: false,
    };
  }

  // ---------- helpers ----------
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function money(n) { return n.toLocaleString("en-US", { style: "currency", currency: "USD" }); }
  function fmtDate(iso) {
    if (!iso) return "—";
    var p = String(iso).slice(0, 10).split("-");
    if (p.length !== 3) return iso;
    return p[1] + "/" + p[2] + "/" + p[0];
  }
  function computeTotals(r) {
    var parts = num(r.partsAmount), labor = num(r.laborAmount);
    var diag = r.diagnosticFeePaid === "Yes" ? 0 : SHOP.diagFee;
    var subtotal = parts + labor + diag;
    var tax = Math.round(subtotal * SHOP.taxRate * 100) / 100;
    return { parts: parts, labor: labor, diag: diag, subtotal: subtotal, tax: tax, total: subtotal + tax };
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function doctorMarkSVG() {
    return '<svg viewBox="0 0 40 40" width="32" height="32" aria-hidden="true">'
      + '<rect x="6" y="8" width="22" height="15" rx="2" fill="#C8A85A"/>'
      + '<rect x="8.5" y="10.5" width="17" height="10" rx="1" fill="#0B0B0C"/>'
      + '<rect x="13" y="23" width="8" height="3" fill="#C8A85A"/>'
      + '<rect x="9" y="26" width="16" height="2.5" rx="1.25" fill="#C8A85A"/>'
      + '<path d="M28 12 v6 a5 5 0 0 1-10 0 v-1" fill="none" stroke="#E07B39" stroke-width="2" stroke-linecap="round"/>'
      + '<circle cx="33" cy="11" r="2.4" fill="#E07B39"/></svg>';
  }

  // ---------- config / supabase client ----------
  var CFG = window.REPAIR_TRACKER_CONFIG || {};
  var configOK =
    CFG.SUPABASE_URL && CFG.SUPABASE_URL.indexOf("PASTE_") === -1 &&
    CFG.SUPABASE_ANON_KEY && CFG.SUPABASE_ANON_KEY.indexOf("PASTE_") === -1;

  var sb = null;
  if (configOK && window.supabase) {
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  }

  var app = document.getElementById("app");
  var IS_STATUS = new URLSearchParams(location.search).get("view") === "status";

  // expose pieces the rest of the file (loaded below) will use
  window.__RT = {
    SHOP: SHOP, STATUSES: STATUSES, STATUS_STYLE: STATUS_STYLE,
    CONTACT_PREF: CONTACT_PREF, BACKUP_STATUS: BACKUP_STATUS, YESNO: YESNO,
    PAY_METHODS: PAY_METHODS, DOC_TYPES: DOC_TYPES,
    toRow: toRow, fromRow: fromRow, blankRepair: blankRepair,
    num: num, money: money, fmtDate: fmtDate, computeTotals: computeTotals,
    esc: esc, el: el, doctorMarkSVG: doctorMarkSVG,
    CFG: CFG, configOK: configOK, sb: sb, app: app, IS_STATUS: IS_STATUS,
  };
})();
/* ===================== Management app + Status page ===================== */
(function () {
  "use strict";
  var R = window.__RT;
  var SHOP = R.SHOP, STATUSES = R.STATUSES, STATUS_STYLE = R.STATUS_STYLE;
  var CONTACT_PREF = R.CONTACT_PREF, BACKUP_STATUS = R.BACKUP_STATUS, YESNO = R.YESNO;
  var PAY_METHODS = R.PAY_METHODS, DOC_TYPES = R.DOC_TYPES;
  var toRow = R.toRow, fromRow = R.fromRow, blankRepair = R.blankRepair;
  var num = R.num, money = R.money, fmtDate = R.fmtDate, computeTotals = R.computeTotals;
  var esc = R.esc, el = R.el, doctorMarkSVG = R.doctorMarkSVG;
  var sb = R.sb, app = R.app, IS_STATUS = R.IS_STATUS, configOK = R.configOK, CFG = R.CFG;

  // ---------- shared state ----------
  var state = {
    repairs: [],          // all rows (objects in app shape)
    loading: true,
    view: "active",       // active | completed
    search: "",
    statusFilter: "All",
    authed: false,
  };

  function toast(msg) {
    var t = el('<div class="toast">' + esc(msg) + "</div>");
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  // ---------- data ops ----------
  function loadRepairs() {
    return sb.from("repairs").select("*").order("date_checked_in", { ascending: false })
      .then(function (res) {
        if (res.error) throw res.error;
        state.repairs = (res.data || []).map(fromRow);
        return state.repairs;
      });
  }
  function saveRepair(rec) {
    var row = toRow(rec);
    var q = rec.id
      ? sb.from("repairs").update(row).eq("id", rec.id).select()
      : sb.from("repairs").insert(row).select();
    return q.then(function (res) { if (res.error) throw res.error; return res.data[0]; });
  }
  function deleteRepair(id) {
    return sb.from("repairs").delete().eq("id", id).then(function (res) {
      if (res.error) throw res.error; return true;
    });
  }

  // =====================================================================
  // STATUS PAGE (Linda) — read-only, auto-refresh
  // =====================================================================
  function renderStatusPage() {
    app.innerHTML = "";
    var page = el('<div class="spage"></div>');
    page.appendChild(el(
      '<div class="shdr"><div class="nm">' + esc(SHOP.name) + "</div>" +
      '<div class="sub">Repair Status</div></div>'
    ));
    var wrap = el('<div class="swrap"></div>');
    var updated = el('<div class="supdated"></div>');
    var sInput = el('<input class="ssearch" placeholder="Search your name or device…" />');
    var listWrap = el('<div class="scards"></div>');
    wrap.appendChild(sInput);
    wrap.appendChild(updated);
    wrap.appendChild(listWrap);
    page.appendChild(wrap);
    app.appendChild(page);

    var q = "";
    sInput.addEventListener("input", function () { q = sInput.value.toLowerCase(); paint(); });

    function paint() {
      var active = state.repairs.filter(function (r) { return !r.completed; });
      var rows = active.filter(function (r) {
        if (!q) return true;
        return (r.customerName + " " + r.device + " " + r.brandModel).toLowerCase().indexOf(q) !== -1;
      });
      // sort: ready for pickup first, then by check-in date
      rows.sort(function (a, b) {
        var ra = a.status === "Ready for Pickup" ? 0 : 1;
        var rb = b.status === "Ready for Pickup" ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return (b.dateCheckedIn || "").localeCompare(a.dateCheckedIn || "");
      });
      listWrap.innerHTML = "";
      if (rows.length === 0) {
        listWrap.appendChild(el('<div class="sempty">' +
          (q ? "No repairs match that search." : "No active repairs right now.") + "</div>"));
        return;
      }
      rows.forEach(function (r) {
        var st = STATUS_STYLE[r.status] || STATUS_STYLE["Checked In"];
        var card = el(
          '<div class="scard" style="border-left-color:' + st.dot + '">' +
            "<div>" +
              '<div class="who">' + esc(r.customerName || "—") + "</div>" +
              '<div class="dev">' + esc([r.device, r.brandModel].filter(Boolean).join(" · ") || "—") + "</div>" +
              '<div class="meta">Checked in ' + esc(fmtDate(r.dateCheckedIn)) + "</div>" +
            "</div>" +
            '<span class="badge" style="background:' + st.bg + ";color:" + st.fg + '">' +
              '<span class="dot" style="background:' + st.dot + '"></span>' + esc(r.status) +
            "</span>" +
          "</div>"
        );
        listWrap.appendChild(card);
      });
    }

    function refresh() {
      loadRepairs().then(function () {
        var now = new Date();
        updated.textContent = "Updated " + now.toLocaleTimeString("en-US",
          { hour: "numeric", minute: "2-digit" });
        paint();
      }).catch(function (e) {
        updated.textContent = "Couldn't reach the database. Retrying…";
        console.error(e);
      });
    }
    refresh();
    // live updates via Supabase realtime, plus a 30s safety poll
    try {
      sb.channel("repairs-status")
        .on("postgres_changes", { event: "*", schema: "public", table: "repairs" }, refresh)
        .subscribe();
    } catch (e) { /* realtime optional */ }
    setInterval(refresh, 30000);
  }

  // =====================================================================
  // MANAGEMENT APP
  // =====================================================================
  function renderApp() {
    app.innerHTML = "";

    // login gate
    if (!state.authed) { renderLogin(); return; }

    var root = el('<div></div>');

    // header
    var active = state.repairs.filter(function (r) { return !r.completed; });
    var completed = state.repairs.filter(function (r) { return r.completed; });
    var hdr = el(
      '<header class="hdr">' +
        '<div class="brand"><div class="mark">' + doctorMarkSVG() + "</div>" +
          '<div><div class="nm">' + esc(SHOP.name) + '</div><div class="sub">Repair Tracker</div></div></div>' +
        '<nav class="nav">' +
          '<button class="tab" data-v="active">Active <span class="ct">' + active.length + "</span></button>" +
          '<button class="tab" data-v="completed">Completed <span class="ct">' + completed.length + "</span></button>" +
        "</nav>" +
      "</header>"
    );
    hdr.querySelectorAll(".tab").forEach(function (b) {
      if (b.getAttribute("data-v") === state.view) b.classList.add("on");
      b.addEventListener("click", function () { state.view = b.getAttribute("data-v"); renderApp(); });
    });
    root.appendChild(hdr);

    var wrap = el('<div class="wrap"></div>');

    // stat cards (active view only)
    if (state.view === "active") {
      var ready = active.filter(function (r) { return r.status === "Ready for Pickup"; }).length;
      var waiting = active.filter(function (r) { return r.status === "Waiting on Parts"; }).length;
      var picked = active.filter(function (r) { return r.status === "Picked Up"; }).length;
      wrap.appendChild(el(
        '<div class="stats">' +
          statCard(active.length, "Active repairs", "#3B5BA5") +
          statCard(ready, "Ready for pickup", "#2FA82F") +
          statCard(waiting, "Waiting on parts", "#E07B39") +
          statCard(picked, "Picked up", "#999999") +
        "</div>"
      ));
    }

    // toolbar
    var picked2 = active.filter(function (r) { return r.status === "Picked Up"; }).length;
    var toolbar = el('<div class="toolbar"></div>');
    var tleft = el('<div class="tleft"></div>');
    var search = el('<input class="search" placeholder="Search name, phone, device, problem…" />');
    search.value = state.search;
    search.addEventListener("input", function () { state.search = search.value; paintTable(); });
    tleft.appendChild(search);
    if (state.view === "active") {
      var filter = el('<select class="filter"></select>');
      filter.appendChild(el('<option>All</option>'));
      STATUSES.forEach(function (s) { filter.appendChild(el("<option>" + esc(s) + "</option>")); });
      filter.value = state.statusFilter;
      filter.addEventListener("change", function () { state.statusFilter = filter.value; paintTable(); });
      tleft.appendChild(filter);
    }
    toolbar.appendChild(tleft);

    var tright = el('<div class="tright"></div>');
    if (state.view === "active") {
      var moveBtn = el('<button class="btn btn-gho">Move picked-up → Completed' +
        (picked2 > 0 ? ' <span class="pill">' + picked2 + "</span>" : "") + "</button>");
      moveBtn.addEventListener("click", moveCompleted);
      var newBtn = el('<button class="btn btn-pri">+ New repair</button>');
      newBtn.addEventListener("click", function () { openForm(blankRepair()); });
      tright.appendChild(moveBtn);
      tright.appendChild(newBtn);
    }
    toolbar.appendChild(tright);
    wrap.appendChild(toolbar);

    var tableHost = el('<div id="tableHost"></div>');
    wrap.appendChild(tableHost);
    root.appendChild(wrap);
    app.appendChild(root);

    paintTable();
  }

  function statCard(v, l, accent) {
    return '<div class="stat"><div class="b" style="background:' + accent + '"></div>' +
      '<div class="v">' + v + '</div><div class="l">' + esc(l) + "</div></div>";
  }

  function paintTable() {
    var host = document.getElementById("tableHost");
    if (!host) return;
    var isActive = state.view === "active";
    var list = state.repairs.filter(function (r) { return isActive ? !r.completed : r.completed; });
    var q = state.search.toLowerCase();
    var rows = list.filter(function (r) {
      var ms = !q || [r.customerName, r.phone, r.device, r.brandModel, r.problem]
        .join(" ").toLowerCase().indexOf(q) !== -1;
      var mf = !isActive || state.statusFilter === "All" || r.status === state.statusFilter;
      return ms && mf;
    });

    host.innerHTML = "";
    if (rows.length === 0) {
      var hasAny = list.length > 0;
      host.appendChild(el(
        '<div class="empty"><div class="t">' +
          (!isActive ? "No completed jobs yet" : hasAny ? "No repairs match your search" : "No repairs yet") +
        '</div><div class="s">' +
          (!isActive ? "When a repair is marked Picked Up, use “Move picked-up → Completed” to archive it here."
            : hasAny ? "Try a different search term or status filter." : "Add your first repair to get started.") +
        "</div></div>"
      ));
      if (isActive && !hasAny) {
        var b = el('<button class="btn btn-pri">+ New repair</button>');
        b.addEventListener("click", function () { openForm(blankRepair()); });
        host.querySelector(".empty").appendChild(b);
      }
      return;
    }

    var tw = el('<div class="tablewrap"></div>');
    var table = el(
      "<table><thead><tr>" +
        "<th>Checked in</th><th>Customer</th><th>Device</th><th>Problem</th>" +
        '<th>Status</th><th class="num">Est. cost</th><th class="ah">Actions</th>' +
      "</tr></thead><tbody></tbody></table>"
    );
    var tbody = table.querySelector("tbody");
    rows.forEach(function (r) {
      var st = STATUS_STYLE[r.status] || STATUS_STYLE["Checked In"];
      var tr = el(
        "<tr>" +
          '<td class="cdate">' + esc(fmtDate(r.dateCheckedIn)) + "</td>" +
          "<td><div class=\"cust\">" + esc(r.customerName || "—") + '</div><div class="csub">' + esc(r.phone) + "</div></td>" +
          "<td><div>" + esc(r.device || "—") + '</div><div class="csub">' + esc(r.brandModel) + "</div></td>" +
          '<td class="prob">' + esc(r.problem || "—") + "</td>" +
          '<td><span class="badge" style="background:' + st.bg + ";color:" + st.fg + '">' +
            '<span class="dot" style="background:' + st.dot + '"></span>' + esc(r.status) + "</span></td>" +
          '<td class="num">' + (r.estimatedCost ? money(num(r.estimatedCost)) : "—") + "</td>" +
          '<td class="acts"></td>' +
        "</tr>"
      );
      tr.addEventListener("click", function () { openForm(r); });
      var acts = tr.querySelector(".acts");
      acts.addEventListener("click", function (e) { e.stopPropagation(); });

      // doc menu
      acts.appendChild(buildDocMenu(r));
      // restore (completed only)
      if (!isActive) {
        var rb = el('<button class="ibtn" title="Restore to active">↩</button>');
        rb.addEventListener("click", function () { restoreJob(r); });
        acts.appendChild(rb);
      }
      var eb = el('<button class="ibtn" title="Edit">✎</button>');
      eb.addEventListener("click", function () { openForm(r); });
      acts.appendChild(eb);

      tbody.appendChild(tr);
    });
    tw.appendChild(table);
    host.appendChild(tw);
  }

  function buildDocMenu(r) {
    var menu = el('<div class="menu"></div>');
    var btn = el('<button class="ibtn" title="Generate document">🖨</button>');
    var pop = el('<div class="menu-pop" style="display:none"></div>');
    DOC_TYPES.forEach(function (d) {
      var b = el("<button>" + esc(d) + "</button>");
      b.addEventListener("click", function () { pop.style.display = "none"; openDoc(r, d); });
      pop.appendChild(b);
    });
    btn.addEventListener("click", function () {
      pop.style.display = pop.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("mousedown", function (e) {
      if (!menu.contains(e.target)) pop.style.display = "none";
    });
    menu.appendChild(btn);
    menu.appendChild(pop);
    return menu;
  }

  // ---------- actions ----------
  function moveCompleted() {
    var picked = state.repairs.filter(function (r) { return !r.completed && r.status === "Picked Up"; });
    if (picked.length === 0) { toast("No picked-up jobs to move"); return; }
    var today = new Date().toISOString().slice(0, 10);
    Promise.all(picked.map(function (r) {
      return saveRepair({ id: r.id, completed: true, dateCompleted: r.dateCompleted || today });
    })).then(function () {
      return loadRepairs();
    }).then(function () {
      toast(picked.length + " job" + (picked.length > 1 ? "s" : "") + " moved to Completed");
      renderApp();
    }).catch(function (e) { toast("Couldn't move jobs"); console.error(e); });
  }
  function restoreJob(r) {
    saveRepair({ id: r.id, completed: false, status: "Ready for Pickup" })
      .then(loadRepairs).then(function () { toast("Job restored to active"); renderApp(); })
      .catch(function (e) { toast("Couldn't restore"); console.error(e); });
  }

  // expose for form module
  window.__RT.mgmt = {
    state: state, toast: toast, loadRepairs: loadRepairs, saveRepair: saveRepair,
    deleteRepair: deleteRepair, renderApp: renderApp,
  };

  // ---------- login ----------
  function renderLogin() {
    app.innerHTML = "";
    var box = el(
      '<div class="login">' +
        '<div class="mark">' + doctorMarkSVG() + "</div>" +
        "<h2>Repair Tracker</h2>" +
        "<p>Enter the manager password to continue.</p>" +
        '<div class="err" style="display:none"></div>' +
        '<input type="password" placeholder="Password" />' +
        '<button class="btn btn-pri" style="width:100%">Open tracker</button>' +
      "</div>"
    );
    var input = box.querySelector("input");
    var err = box.querySelector(".err");
    var btn = box.querySelector("button");
    function tryAuth() {
      if (input.value === (CFG.MANAGER_PASSWORD || "")) {
        state.authed = true;
        try { sessionStorage.setItem("rt_authed", "1"); } catch (e) {}
        boot();
      } else {
        err.textContent = "That password isn't right.";
        err.style.display = "block";
        input.value = "";
        input.focus();
      }
    }
    btn.addEventListener("click", tryAuth);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") tryAuth(); });
    app.appendChild(box);
    input.focus();
  }

  // ---------- boot ----------
  function bannerConfig() {
    app.innerHTML = "";
    app.appendChild(el(
      '<div class="banner err">This tracker isn’t connected yet. Open <b>config.js</b> and paste your ' +
      'Supabase project URL and key (see the setup guide).</div>'
    ));
  }

  function boot() {
    if (!configOK || !sb) { bannerConfig(); return; }

    if (IS_STATUS) {
      // Linda's page — no login, just load + show
      renderStatusPage();
      return;
    }

    // restore session auth
    try { if (sessionStorage.getItem("rt_authed") === "1") state.authed = true; } catch (e) {}

    if (!state.authed) { renderLogin(); return; }

    loadRepairs().then(function () {
      state.loading = false;
      renderApp();
      // live updates while you work
      try {
        sb.channel("repairs-mgmt")
          .on("postgres_changes", { event: "*", schema: "public", table: "repairs" }, function () {
            loadRepairs().then(function () {
              // only repaint if no modal open
              if (!document.querySelector(".overlay")) renderApp();
            });
          }).subscribe();
      } catch (e) {}
    }).catch(function (e) {
      app.innerHTML = "";
      app.appendChild(el('<div class="banner err">Couldn’t load repairs from the database. ' +
        'Check your connection and the setup SQL. (' + esc(e.message || "error") + ")</div>"));
      console.error(e);
    });
  }

  window.__RT.boot = boot;
})();
/* ===================== Repair form + Document generator ===================== */
(function () {
  "use strict";
  var R = window.__RT;
  var SHOP = R.SHOP, STATUSES = R.STATUSES, CONTACT_PREF = R.CONTACT_PREF;
  var BACKUP_STATUS = R.BACKUP_STATUS, YESNO = R.YESNO, PAY_METHODS = R.PAY_METHODS, DOC_TYPES = R.DOC_TYPES;
  var num = R.num, money = R.money, fmtDate = R.fmtDate, computeTotals = R.computeTotals;
  var esc = R.esc, el = R.el, doctorMarkSVG = R.doctorMarkSVG;
  var M = R.mgmt;

  function opt(list, sel) {
    return list.map(function (o) {
      return '<option' + (o === sel ? " selected" : "") + ">" + esc(o) + "</option>";
    }).join("");
  }

  // ---------------- Form ----------------
  function openForm(rec) {
    var r = JSON.parse(JSON.stringify(rec));
    var isNew = !r.id;
    var overlay = el('<div class="overlay"></div>');
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });

    var modal = el('<div class="modal"></div>');
    modal.addEventListener("mousedown", function (e) { e.stopPropagation(); });

    modal.appendChild(el(
      '<div class="mhead"><div>' +
        '<div class="mtitle">' + (isNew ? "New repair" : "Edit repair") + "</div>" +
        (isNew ? "" : '<div class="msub">' + esc(r.customerName) + " · checked in " + esc(fmtDate(r.dateCheckedIn)) + "</div>") +
      '</div><button class="x">✕</button></div>'
    ));
    modal.querySelector(".x").addEventListener("click", close);

    var body = el('<div class="mbody"></div>');
    body.innerHTML =
      section("Customer",
        frow(
          fld("Customer name", inp("customerName", r.customerName), "wide") +
          fld("Phone", inp("phone", r.phone))
        ) +
        frow(
          fld("Email", inp("email", r.email), "wide") +
          fld("Preferred contact", sel("preferredContact", CONTACT_PREF, r.preferredContact))
        ) +
        frow(
          fld("Address", inp("address", r.address), "wide") +
          fld("City, State, Zip", inp("cityStateZip", r.cityStateZip))
        )
      ) +
      section("Device",
        frow(
          fld("Device", inp("device", r.device)) +
          fld("Brand / Model", inp("brandModel", r.brandModel))
        ) +
        frow(
          fld("Serial number", inp("serialNumber", r.serialNumber)) +
          fld("Password / PIN", inp("passwordPin", r.passwordPin))
        ) +
        frow(
          fld("Accessories received", inp("accessories", r.accessories), "wide") +
          fld("Backup status", sel("backupStatus", BACKUP_STATUS, r.backupStatus))
        )
      ) +
      section("Problem & status",
        frow(fld("Problem reported", ta("problem", r.problem, 2), "full")) +
        frow(
          fld("Current status", sel("status", STATUSES, r.status)) +
          fld("Waiting on parts", sel("waitingOnParts", YESNO, r.waitingOnParts)) +
          fld("Ready for pickup", sel("readyForPickup", YESNO, r.readyForPickup))
        ) +
        frow(fld("Diagnostic findings / work performed", ta("diagnosticFindings", r.diagnosticFindings, 4), "full"))
      ) +
      section("Charges",
        frow(
          fld("Parts amount", inp("partsAmount", r.partsAmount)) +
          fld("Labor amount", inp("laborAmount", r.laborAmount)) +
          fld("Diagnostic fee paid?", sel("diagnosticFeePaid", YESNO, r.diagnosticFeePaid))
        ) +
        frow(
          fld("Payment method", '<select data-k="paymentMethod"><option value="">—</option>' + opt(PAY_METHODS, r.paymentMethod) + "</select>") +
          fld("Estimated cost (quote)", inp("estimatedCost", r.estimatedCost))
        ) +
        '<div class="totals" id="totalsBox"></div>'
      );
    modal.appendChild(body);

    // wire inputs -> r
    body.querySelectorAll("[data-k]").forEach(function (node) {
      node.addEventListener("input", function () {
        r[node.getAttribute("data-k")] = node.value;
        if (["partsAmount", "laborAmount", "diagnosticFeePaid"].indexOf(node.getAttribute("data-k")) !== -1)
          paintTotals();
      });
      node.addEventListener("change", function () {
        r[node.getAttribute("data-k")] = node.value;
        paintTotals();
      });
    });

    function paintTotals() {
      var t = computeTotals(r);
      document.getElementById("totalsBox").innerHTML =
        trow("Parts + Labor", money(t.parts + t.labor)) +
        trow("Diagnostic fee" + (r.diagnosticFeePaid === "Yes" ? " (already paid)" : ""), money(t.diag)) +
        trow("Subtotal", money(t.subtotal)) +
        trow("Sales tax (7%)", money(t.tax)) +
        trow("Total", money(t.total), true);
    }

    // footer
    var foot = el('<div class="mfoot"></div>');
    var left = el('<div class="fleft"></div>');
    if (!isNew) {
      var del = el('<button class="btn btn-dan">Delete</button>');
      del.addEventListener("click", function () {
        if (confirm("Delete this repair? This can’t be undone.")) {
          M.deleteRepair(r.id).then(M.loadRepairs).then(function () {
            M.toast("Repair deleted"); close(); M.renderApp();
          }).catch(function (e) { M.toast("Couldn’t delete"); console.error(e); });
        }
      });
      left.appendChild(del);
    }
    foot.appendChild(left);

    var right = el('<div class="fright"></div>');
    if (!isNew) {
      var docs = el('<div class="inlinedocs"></div>');
      DOC_TYPES.forEach(function (d) {
        var b = el('<button class="btn btn-gho btn-sm">' + esc(d) + "</button>");
        b.addEventListener("click", function () { openDoc(r, d); });
        docs.appendChild(b);
      });
      right.appendChild(docs);
    }
    var cancel = el('<button class="btn btn-gho">Cancel</button>');
    cancel.addEventListener("click", close);
    var save = el('<button class="btn btn-pri">' + (isNew ? "Add repair" : "Save changes") + "</button>");
    save.addEventListener("click", function () {
      save.disabled = true; save.textContent = "Saving…";
      M.saveRepair(r).then(M.loadRepairs).then(function () {
        M.toast(isNew ? "Repair added" : "Repair updated"); close(); M.renderApp();
      }).catch(function (e) {
        save.disabled = false; save.textContent = isNew ? "Add repair" : "Save changes";
        M.toast("Couldn’t save — " + (e.message || "error")); console.error(e);
      });
    });
    right.appendChild(cancel);
    right.appendChild(save);
    foot.appendChild(right);
    modal.appendChild(foot);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    paintTotals();
    var first = body.querySelector("input"); if (first) first.focus();

    function onEsc(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onEsc);
    function close() {
      document.removeEventListener("keydown", onEsc);
      overlay.remove();
    }
  }

  // form html helpers
  function section(title, inner) {
    return '<div class="sec"><div class="sect">' + esc(title) + '</div><div>' + inner + "</div></div>";
  }
  function frow(inner) { return '<div class="frow">' + inner + "</div>"; }
  function fld(label, control, cls) {
    return '<label class="fld ' + (cls || "") + '"><span class="lab">' + esc(label) + "</span>" + control + "</label>";
  }
  function inp(k, v) { return '<input data-k="' + k + '" value="' + esc(v) + '" />'; }
  function ta(k, v, rows) { return '<textarea data-k="' + k + '" rows="' + rows + '">' + esc(v) + "</textarea>"; }
  function sel(k, list, v) {
    return '<select data-k="' + k + '">' + list.map(function (o) {
      return '<option' + (o === v ? " selected" : "") + ">" + esc(o) + "</option>";
    }).join("") + "</select>";
  }
  function trow(label, val, big) {
    return '<div class="trow' + (big ? " big" : "") + '"><span>' + esc(label) + "</span><span>" + esc(val) + "</span></div>";
  }

  // ---------------- Document generator ----------------
  function openDoc(r, type) {
    var overlay = el('<div class="overlay"></div>');
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
    var wrap = el('<div class="docwrap"></div>');
    wrap.addEventListener("mousedown", function (e) { e.stopPropagation(); });

    var toolbar = el('<div class="dtoolbar"></div>');
    var tabs = el('<div class="dtabs"></div>');
    DOC_TYPES.forEach(function (t) {
      var b = el('<button class="dtab' + (t === type ? " on" : "") + '">' + esc(t) + "</button>");
      b.addEventListener("click", function () { type = t; rerender(); });
      tabs.appendChild(b);
    });
    var actions = el('<div class="dactions"></div>');
    var printBtn = el('<button class="btn btn-pri">Print / Save PDF</button>');
    printBtn.addEventListener("click", doPrint);
    var xb = el('<button class="x">✕</button>');
    xb.addEventListener("click", close);
    actions.appendChild(printBtn); actions.appendChild(xb);
    toolbar.appendChild(tabs); toolbar.appendChild(actions);
    wrap.appendChild(toolbar);

    var scroll = el('<div class="dscroll"></div>');
    var page = el('<div class="dpage"></div>');
    scroll.appendChild(page);
    wrap.appendChild(scroll);
    overlay.appendChild(wrap);
    document.body.appendChild(overlay);

    function rerender() {
      tabs.querySelectorAll(".dtab").forEach(function (b) {
        b.classList.toggle("on", b.textContent === type);
      });
      page.innerHTML = docHTML(r, type);
    }
    function doPrint() {
      var w = window.open("", "_blank", "width=850,height=1100");
      if (!w) { alert("Allow pop-ups to print this document."); return; }
      w.document.write('<!doctype html><html><head><title>' + esc(type) + " — " + esc(r.customerName) +
        '</title><style>' + printCSS() + "</style></head><body>" + page.innerHTML + "</body></html>");
      w.document.close(); w.focus();
      setTimeout(function () { w.print(); }, 350);
    }
    function onEsc(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onEsc);
    function close() { document.removeEventListener("keydown", onEsc); overlay.remove(); }

    rerender();
  }

  function docField(label, value) {
    return '<div class="dfld"><span class="dfldl">' + esc(label) + '</span><span class="dfldv">' +
      (value ? esc(value) : "&nbsp;") + "</span></div>";
  }
  function docHTML(r, type) {
    var t = computeTotals(r);
    var today = new Date().toISOString().slice(0, 10);
    var titleMap = {
      "Service Order": "SERVICE ORDER", "Quote": "QUOTE",
      "Receipt": "RECEIPT", "Diagnostic Receipt": "DIAGNOSTIC RECEIPT",
    };
    var head =
      '<div class="dhead"><div class="m">' + doctorMarkSVG() + '</div><div>' +
        '<div class="dshop">' + esc(SHOP.name) + "</div>" +
        '<div class="dline">' + esc(SHOP.address) + " · " + esc(SHOP.cityzip) + "</div>" +
        '<div class="dline">' + esc(SHOP.phone) + " · " + esc(SHOP.web) + "</div>" +
      "</div></div>";
    var titleRow =
      '<div class="dtitrow"><div class="dtit">' + esc(titleMap[type]) + "</div>" +
      '<div class="dmeta"><div><span>No.</span>' + esc((r.id || "------").slice(-6).toUpperCase()) + "</div>" +
      '<div><span>Date</span>' + esc(fmtDate(today)) + "</div></div></div>";

    var customer =
      '<div class="dsec"><div class="dsecl">Customer</div><div class="dgrid">' +
        docField("Name", r.customerName) + docField("Phone", r.phone) +
        docField("Address", r.address) + docField("Email", r.email) +
        docField("City, State, Zip", r.cityStateZip) + docField("Preferred contact", r.preferredContact) +
      "</div></div>";

    var deviceFields = docField("Device", r.device) + docField("Brand / Model", r.brandModel);
    if (type === "Service Order") {
      deviceFields += docField("Serial number", r.serialNumber) + docField("Password / PIN", r.passwordPin) +
        docField("Accessories", r.accessories) + docField("Backup status", r.backupStatus);
    }
    var device = '<div class="dsec"><div class="dsecl">Device</div><div class="dgrid">' + deviceFields + "</div></div>";

    var middle = "";
    if (type === "Service Order") {
      middle = '<div class="dsec"><div class="dsecl">Problem reported</div><div class="dbox">' +
        (r.problem ? esc(r.problem) : "&nbsp;") + "</div></div>";
    } else if (type === "Receipt" || type === "Diagnostic Receipt") {
      middle = '<div class="dsec"><div class="dsecl">Description of work performed</div>' +
        '<div class="dbox tall">' + (r.diagnosticFindings ? esc(r.diagnosticFindings) : "&nbsp;") + "</div></div>";
    } else if (type === "Quote") {
      middle = '<div class="dsec"><div class="dsecl">Scope of work</div><div class="dbox">' +
        (r.problem || r.diagnosticFindings ? esc(r.problem || r.diagnosticFindings) : "&nbsp;") + "</div></div>";
    }

    var charges = "";
    if (type === "Service Order") {
      charges =
        '<div class="dsec"><div class="dsecl">Terms</div><ul class="dterms">' +
          "<li>A $" + SHOP.diagFee + ".00 diagnostic fee is required and must be paid prior to device pickup if repair is declined. This fee is waived if " + esc(SHOP.name) + " performs the repair.</li>" +
          "<li>Devices not picked up within 15 days after notification that service is complete are subject to a $10/day storage fee.</li>" +
          "<li>" + esc(SHOP.name) + " is not responsible for data loss. Customers are responsible for backing up all data prior to service.</li>" +
          "<li>I authorize " + esc(SHOP.name) + " to perform diagnostic and repair work on the listed device.</li>" +
        "</ul></div>" +
        '<div class="dsignrow"><div class="dsign"><div class="dsignl"></div><div class="dsignlab">Customer signature</div></div>' +
        '<div class="dsign sm"><div class="dsignl"></div><div class="dsignlab">Date</div></div></div>';
    } else if (type === "Diagnostic Receipt") {
      var dtax = Math.round(SHOP.diagFee * SHOP.taxRate * 100) / 100;
      charges =
        '<div class="dsec"><div class="dsecl">Paid</div><table class="dcharges"><tbody>' +
          '<tr><td>Diagnostic service fee</td><td class="amt">' + money(SHOP.diagFee) + "</td></tr>" +
          '<tr><td>Sales tax (7%)</td><td class="amt">' + money(dtax) + "</td></tr>" +
          '<tr class="dtot"><td>Total paid</td><td class="amt">' + money(SHOP.diagFee + dtax) + "</td></tr>" +
        "</tbody></table>" +
        (r.paymentMethod ? '<div class="dpay">Payment method: ' + esc(r.paymentMethod) + "</div>" : "") +
        "</div>";
    } else {
      var label = type === "Quote" ? "Estimate" : "Paid";
      var totalLabel = type === "Quote" ? "Estimated total" : "Total paid";
      charges =
        '<div class="dsec"><div class="dsecl">' + label + '</div><table class="dcharges"><tbody>' +
          '<tr><td>Parts &amp; labor</td><td class="amt">' + money(t.parts + t.labor) + "</td></tr>" +
          "<tr><td>Diagnostic fee" + (r.diagnosticFeePaid === "Yes" ? " (already paid)" : "") + '</td><td class="amt">' + money(t.diag) + "</td></tr>" +
          '<tr><td>Subtotal</td><td class="amt">' + money(t.subtotal) + "</td></tr>" +
          '<tr><td>Sales tax (7%)</td><td class="amt">' + money(t.tax) + "</td></tr>" +
          '<tr class="dtot"><td>' + totalLabel + '</td><td class="amt">' + money(t.total) + "</td></tr>" +
        "</tbody></table>" +
        (type === "Receipt" && r.paymentMethod ? '<div class="dpay">Payment method: ' + esc(r.paymentMethod) + "</div>" : "") +
        (type === "Quote" ? '<div class="dnote">This quote is valid for 30 days. The $' + SHOP.diagFee +
          ".00 diagnostic fee is credited toward the quote when " + esc(SHOP.name) + " performs the work.</div>" : "") +
        "</div>";
    }

    var footer = '<div class="dfoot">Thank you for choosing ' + esc(SHOP.name) + " — " + esc(SHOP.tagline) +
      ". · Questions? Call " + esc(SHOP.phone) + ".</div>";

    return head + titleRow + customer + device + middle + charges + footer;
  }

  function printCSS() {
    // pull the document styles out of the page's stylesheet (the .d* rules) +
    // a print page setup. Simplest: re-declare the needed rules inline.
    return "@page{size:letter;margin:0.5in}*{margin:0;padding:0;box-sizing:border-box}" +
      "body{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;color:#0B0B0C;-webkit-print-color-adjust:exact;print-color-adjust:exact}svg{display:block}" +
      ".dhead{display:flex;align-items:center;gap:18px;padding-bottom:14px;border-bottom:2px solid #1A2E5A}" +
      ".dhead .m{background:#fff;border:1px solid #eee;border-radius:8px;padding:4px}" +
      ".dshop{font-family:'Playfair Display',Georgia,serif;font-size:24px;font-weight:700;color:#1A2E5A}" +
      ".dline{font-size:12.5px;color:#555;margin-top:2px}" +
      ".dtitrow{display:flex;align-items:center;justify-content:space-between;margin:18px 0}" +
      ".dtit{font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:700;letter-spacing:.04em}" +
      ".dmeta{text-align:right;font-size:13px}.dmeta div{margin-bottom:2px}.dmeta span{color:#888;margin-right:6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em}" +
      ".dsec{margin:16px 0}.dsecl{font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:#1A2E5A;border-bottom:1px solid #ddd;padding-bottom:5px;margin-bottom:10px}" +
      ".dgrid{display:grid;grid-template-columns:1fr 1fr;gap:9px 28px}" +
      ".dfld{display:flex;flex-direction:column;gap:2px;border-bottom:1px dotted #ccc;padding-bottom:4px}" +
      ".dfldl{font-size:10.5px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.03em}" +
      ".dfldv{font-size:14px;color:#0B0B0C;min-height:18px}" +
      ".dbox{border:1px solid #ccc;border-radius:4px;padding:10px 12px;font-size:13.5px;min-height:48px;white-space:pre-wrap;line-height:1.5}.dbox.tall{min-height:120px}" +
      ".dcharges{width:100%;max-width:340px;margin-left:auto;border-collapse:collapse;font-size:14px}.dcharges td{padding:6px 4px}.dcharges td.amt{text-align:right}" +
      ".dcharges tr.dtot td{border-top:2px solid #1A2E5A;font-weight:700;font-size:16px;padding-top:9px;color:#1A2E5A}" +
      ".dpay{margin-top:10px;font-size:13px;color:#555;text-align:right}" +
      ".dnote{margin-top:12px;font-size:11.5px;color:#777;line-height:1.5;border-top:1px solid #eee;padding-top:10px}" +
      ".dterms{font-size:11.5px;color:#555;line-height:1.55;padding-left:18px}.dterms li{margin-bottom:6px}" +
      ".dsignrow{display:flex;gap:30px;margin-top:30px}.dsign{flex:1}.dsign.sm{flex:0 0 180px}.dsignl{border-bottom:1px solid #333;height:30px}.dsignlab{font-size:11px;color:#666;margin-top:4px;font-weight:600}" +
      ".dfoot{margin-top:26px;padding-top:14px;border-top:1px solid #eee;font-size:12px;color:#777;text-align:center;font-style:italic}";
  }

  // expose
  window.__RT.openForm = openForm;
  window.__RT.openDoc = openDoc;
  // make available to mgmt module's table builders
  window.openForm = openForm;
  window.openDoc = openDoc;
})();

/* ---- start the app ---- */
window.__RT.boot();
