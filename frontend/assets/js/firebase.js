/* StudiKitEZ Firebase — dual projects, classic script, dynamic SDK imports.
   studiki = users/progress/bans; smexgod = anonymous playback-key minting only. */
window.SK = window.SK || {};
window.SK.fb = (function () {
  var S = { ready: false, sAuth: null, sDb: null, gAuth: null, gDb: null, anon: null };
  var V = "https://www.gstatic.com/firebasejs/11.6.1/";

  var initPromise = null;
  async function ensure() {
    if (S.ready) return S;
    if (!initPromise) initPromise = initFirebase();
    /* Never let a slow Firebase/network block the whole UI. Callers degrade
       gracefully; a later call retries the same in-flight initialisation. */
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error("Firebase unavailable")); }, 9000);
      initPromise.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
    });
  }
  async function initFirebase() {
    var cfg = await window.SK.api.getConfig();
    var app = await import(V + "firebase-app.js");
    var auth = await import(V + "firebase-auth.js");
    var fs = await import(V + "firebase-firestore.js");
    function named(name, c) {
      var hit = app.getApps().find(function (a) { return a.name === name; });
      return hit || app.initializeApp(c, name);
    }
    var sApp = named("studiki", cfg.STUDIKI), gApp = named("smexgod", cfg.SMEXGOD);
    S.sAuth = auth.getAuth(sApp); S.sDb = fs.getFirestore(sApp);
    S.gAuth = auth.getAuth(gApp); S.gDb = fs.getFirestore(gApp);
    if (!S.gAuth.currentUser) {
      if (!S.anon) S.anon = auth.signInAnonymously(S.gAuth).catch(function (e) { S.anon = null; throw e; });
      await S.anon;
    }
    S.ready = true; S._auth = auth; S._fs = fs;
    return S;
  }

  function phoneLocal() {
    try {
      var t = localStorage.getItem("studybee_token"), m = localStorage.getItem("studybee_mobile");
      var session = localStorage.getItem("sk_session");
      if (t && m && session) return { uid: "phone_" + m, mobile: m, email: "", displayName: "+91 " + m, provider: "phone", token: t };
    } catch (e) {}
    return null;
  }
  async function currentUser() {
    var p = phoneLocal(); if (p) return p;
    await ensure();
    var u = S.sAuth.currentUser;
    if (!u) {
      u = await new Promise(function (resolve) {
        var done = false, finish = function (x) { if (!done) { done = true; resolve(x); } };
        var timer = setTimeout(function () { finish(S.sAuth.currentUser || null); }, 6000);
        S._auth.onAuthStateChanged(S.sAuth, function (x) { clearTimeout(timer); finish(x); });
      });
    }
    if (!u) return null;
    return { uid: u.uid, mobile: "", email: u.email || "", displayName: u.displayName || u.email || "Learner", photoURL: u.photoURL || "", provider: "google" };
  }

  async function userDoc(uid) {
    var phone = phoneLocal();
    if (phone && phone.uid === uid) {
      var result = await window.SK.api.phoneProfile("get");
      return result && result.exists ? result.profile : null;
    }
    await ensure();
    var s = await S._fs.getDoc(S._fs.doc(S.sDb, "users", uid));
    return s.exists() ? s.data() : null;
  }
  async function banCheck(uid) {
    var d = await userDoc(uid);
    if (d && d.banned === true) {
      var label = d.mobile ? "+91 " + d.mobile : (d.email || "This account");
      var e = new Error("BANNED:" + label); throw e;
    }
    return false;
  }
  async function requireLogin(next) {
    var u = await currentUser();
    if (!u) { location.href = "login.html?next=" + encodeURIComponent(next || "dashboard.html"); throw new Error("redirect-login"); }
    if (u.provider === "phone") {
      var phoneDoc = await userDoc(u.uid);
      if (phoneDoc && phoneDoc.banned === true) { location.href = "banned.html"; throw new Error("banned"); }
      if (!phoneDoc) await syncPhone(u.mobile);
      startBanWatch(u.uid);
      return u;
    }
    await ensure();
    var ref = S._fs.doc(S.sDb, "users", u.uid), snap = await S._fs.getDoc(ref);
    if (snap.exists() && snap.data().banned === true) { location.href = "banned.html"; throw new Error("banned"); }
    if (!snap.exists()) {
      var base = { banned: false, createdAt: S._fs.serverTimestamp(), lastLoginAt: S._fs.serverTimestamp() };
      if (u.provider === "phone") await S._fs.setDoc(ref, Object.assign({}, base, { mobile: u.mobile, email: "", displayName: "", provider: "phone" }));
      else { var f = S.sAuth.currentUser || {}; await S._fs.setDoc(ref, Object.assign({}, base, { email: f.email || u.email || "", displayName: f.displayName || "", photoURL: f.photoURL || "", provider: "google" })); }
    } else { await S._fs.setDoc(ref, { lastLoginAt: S._fs.serverTimestamp() }, { merge: true }); }
    startBanWatch(u.uid);
    return u;
  }
  var banTimer = null;
  function startBanWatch(uid) {
    if (banTimer) clearInterval(banTimer);
    banTimer = setInterval(function () {
      banCheck(uid).catch(function (e) { if (String(e.message).indexOf("BANNED:") === 0) location.href = "banned.html"; });
    }, 30000);
  }
  async function signOut() {
    try { localStorage.removeItem("studybee_token"); localStorage.removeItem("studybee_mobile"); localStorage.removeItem("studybee_email"); localStorage.removeItem("sk_session"); } catch (e) {}
    try { if (S.sAuth) await S._auth.signOut(S.sAuth); } catch (e) {}
  }

  /* Proof of verification for backend playback routes. */
  function phoneSession() {
    try { return localStorage.getItem("sk_session") || ""; } catch (e) { return ""; }
  }
  async function idToken() {
    var user = await currentUser();
    if (!user || user.provider === "phone") return "";
    await ensure();
    if (S.sAuth && S.sAuth.currentUser) return S.sAuth.currentUser.getIdToken();
    return "";
  }
  async function authHeaders() {
    try {
      var t = await idToken();
      if (t) return { Authorization: "Bearer " + t };
    } catch (e) {}
    var s = phoneSession();
    if (s) return { "x-sk-session": s };
    return {};
  }

  async function syncPhone(mobile) {
    await window.SK.api.phoneProfile("sync", { mobile: mobile });
  }
  async function syncGoogle(fbUser) {
    await ensure();
    var ref = S._fs.doc(S.sDb, "users", fbUser.uid), snap = await S._fs.getDoc(ref);
    if (!snap.exists()) await S._fs.setDoc(ref, { email: fbUser.email || "", displayName: fbUser.displayName || "", photoURL: fbUser.photoURL || "", provider: "google", banned: false, createdAt: S._fs.serverTimestamp(), lastLoginAt: S._fs.serverTimestamp() });
    else await S._fs.setDoc(ref, { lastLoginAt: S._fs.serverTimestamp() }, { merge: true });
  }
  async function saveProfile(mobile, name, email) {
    await window.SK.api.phoneProfile("save-profile", { name: name, email: email });
  }
  async function checkPhone(mobile) {
    var profile = await userDoc("phone_" + mobile);
    if (!profile) return { exists: false, hasName: false };
    return { exists: true, hasName: !!String(profile.displayName || "").trim() };
  }

  /* ---------- onboarding ---------- */
  /* Returns the onboarding object when complete, false when definitely not
     complete, and null when we couldn't tell (offline) — the UI only redirects
     on an explicit false. */
  async function prefs(uid, force) {
    if (!uid) return false;
    var ck = "sk_prefs_" + uid;
    if (!force) {
      try { var raw = sessionStorage.getItem(ck); if (raw) return JSON.parse(raw); } catch (e) {}
    }
    try {
      var d = await userDoc(uid);
      var o = d && d.onboarding;
      var out = (o && o.done === true) ? o : false;
      /* Firestore write may have failed while offline — never trap the learner
         in an onboarding redirect loop when their device already has the data. */
      if (!out) {
        try {
          if (localStorage.getItem("sk_onboarded_uid") === uid) out = { done: true, batches: myBatches(), offline: true };
        } catch (e2) {}
      }
      try { sessionStorage.setItem(ck, JSON.stringify(out)); } catch (e) {}
      return out;
    } catch (e) {
      try {
        if (localStorage.getItem("sk_onboarded_uid") === uid) {
          var mine = myBatches();
          return { done: true, batches: mine, offline: true };
        }
      } catch (e2) {}
      return null;
    }
  }
  async function saveOnboarding(uid, data) {
    data = data || {};
    var list = (data.batches || []).map(function (x) { return String(x); }).filter(Boolean).slice(0, 12);
    var payload = {
      done: true,
      batches: list,
      mainBatch: list[0] || "",
      goal: String(data.goal || "board").slice(0, 40),
      dailyMinutes: Math.max(10, Math.min(240, Number(data.dailyMinutes) || 30)),
      reminders: data.reminders !== false,
      level: String(data.level || "").slice(0, 40),
      updatedAt: Date.now()
    };
    var phone = phoneLocal();
    if (phone && phone.uid === uid) {
      await window.SK.api.phoneProfile("save-onboarding", { data: payload });
    } else {
      await ensure();
      await S._fs.setDoc(S._fs.doc(S.sDb, "users", uid), { onboarding: payload, updatedAt: Date.now() }, { merge: true });
    }
    try {
      localStorage.setItem("sk_onboarded_uid", uid);
      localStorage.setItem("sk_my_batches", JSON.stringify(list));
      localStorage.setItem("sk_sk_goal", payload.goal);
      localStorage.setItem("sk_daily_minutes", String(payload.dailyMinutes));
      sessionStorage.setItem("sk_prefs_" + uid, JSON.stringify(payload));
    } catch (e) {}
    return payload;
  }
  function myBatches() {
    try { return JSON.parse(localStorage.getItem("sk_my_batches") || "[]"); } catch (e) { return []; }
  }
  function mainBatch() {
    try { return String(localStorage.getItem("sk_main_batch") || myBatches()[0] || ""); } catch (e) { return ""; }
  }
  function setMainBatch(id) {
    try { localStorage.setItem("sk_main_batch", String(id || "")); } catch (e) {}
  }

  function seg() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }
  async function mintKey() {
    await ensure();
    var key = "SB-" + seg() + "-" + seg(), dev = "dev_" + seg() + seg(), now = Date.now();
    await S._fs.setDoc(S._fs.doc(S.gDb, "valid_keys", key), { createdAt: now, expiresAt: now + 172800000, status: "active", maxDevices: 1, registeredDevices: [dev] });
    return { key: key, deviceId: dev };
  }

  /* progress / xp / streak */
  var progCache = {};
  function dayKey(d) { d = d || new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  var activitySyncAt = 0;
  function localActivity() {
    var out = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("sk_activity_") === 0) {
          var day = k.slice(12);
          var n = parseInt(localStorage.getItem(k) || "0", 10) || 0;
          if (/^\d{4}-\d{2}-\d{2}$/.test(day) && n > 0) out[day] = n;
        }
      }
    } catch (e) {}
    return out;
  }
  function activity(n) {
    try {
      var k = "sk_activity_" + dayKey(), c = parseInt(localStorage.getItem(k) || "0", 10) || 0;
      localStorage.setItem(k, String(Math.min(999, c + n)));
      var today = new Date(), cutoff = new Date(today.getTime() - 400 * 86400000);
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf("sk_activity_") === 0) {
          var d = new Date(key.slice(12) + "T00:00:00");
          if (d < cutoff) { localStorage.removeItem(key); i--; }
        }
      }
    } catch (e) {}
  }
  /* Merge device activity with the account copy. Local wins on conflict so a
     phone that was offline still keeps its streak when it reconnects. */
  async function activityMap(uid, days) {
    var out = localActivity();
    if (uid) {
      try {
        var d = await userDoc(uid);
        var a = (d && d.activity) || {};
        Object.keys(a).forEach(function (k) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
          out[k] = Math.max(out[k] || 0, Number(a[k]) || 0);
        });
      } catch (e) {}
    }
    var keep = {}, n = Math.max(1, days || 120), today = new Date();
    for (var i = 0; i < n; i++) {
      var dd = new Date(today); dd.setDate(dd.getDate() - i);
      var k = dayKey(dd);
      if (out[k]) keep[k] = out[k];
    }
    return keep;
  }
  function syncActivity(uid, force) {
    if (!uid) return Promise.resolve(false);
    if (!force && Date.now() - activitySyncAt < 120000) return Promise.resolve(false);
    activitySyncAt = Date.now();
    return ensure().then(function () {
      var ref = S._fs.doc(S.sDb, "users", uid);
      return S._fs.getDoc(ref).then(function (snap) {
        var cur = (snap.exists() && snap.data().activity) || {};
        var local = localActivity(), merged = {}, keys = 0;
        Object.keys(cur).forEach(function (k) { merged[k] = Number(cur[k]) || 0; });
        Object.keys(local).forEach(function (k) {
          var n = Number(local[k]) || 0;
          if (n > (merged[k] || 0)) merged[k] = n;
        });
        /* cap history at ~13 months */
        var cutoff = new Date(Date.now() - 400 * 86400000), out = {};
        Object.keys(merged).forEach(function (k) {
          if (new Date(k + "T00:00:00") >= cutoff && merged[k] > 0) { out[k] = merged[k]; keys++; }
        });
        if (!keys) return false;
        return S._fs.setDoc(ref, { activity: out, activityAt: Date.now() }, { merge: true }).then(function () { return true; });
      });
    }).catch(function () { return false; });
  }
  async function progress(uid, courseId) {
    var ck = uid + "_" + courseId;
    if (progCache[ck]) return progCache[ck];
    await ensure();
    var snap = await S._fs.getDoc(S._fs.doc(S.sDb, "progress", uid, "batches", String(courseId)));
    var d = snap.exists() ? snap.data() : { watched: {}, lastContentId: null, lastTitle: "", updatedAt: 0 };
    progCache[ck] = d; return d;
  }
  async function saveProgress(uid, courseId, contentId, o) {
    o = o || {};
    await ensure();
    var p = await progress(uid, courseId), w = p.watched || {}, old = w[contentId] || {};
    w[contentId] = {
      pct: Math.max(old.pct || 0, o.pct || 0),
      pos: Math.max(old.pos || 0, Number(o.pos) || 0),
      page: Math.max(old.page || 0, Number(o.page) || 0),
      done: old.done || !!o.done,
      at: Date.now(),
      title: o.title || old.title || "",
      type: o.type || old.type || "video"
    };
    p.watched = w; p.lastContentId = contentId; p.lastTitle = o.title || old.title || ""; p.updatedAt = Date.now();
    await S._fs.setDoc(S._fs.doc(S.sDb, "progress", uid, "batches", String(courseId)), p, { merge: true });
    progCache[uid + "_" + courseId] = p;
    activity(o.done && !old.done ? 5 : 1);
    if (o.done && !old.done) {
      var uref = S._fs.doc(S.sDb, "users", uid), us = await S._fs.getDoc(uref);
      var g = (us.exists() && us.data().gamification) || { xp: 0, streak: { current: 0, best: 0, lastActiveDay: "" } };
      g.xp = (g.xp || 0) + (o.type === "pdf" ? 5 : 10);
      var today = dayKey(), yest = dayKey(new Date(Date.now() - 86400000)), st = g.streak || { current: 0, best: 0, lastActiveDay: "" };
      if (st.lastActiveDay !== today) {
        st.current = st.lastActiveDay === yest ? (st.current || 0) + 1 : 1;
        st.best = Math.max(st.best || 0, st.current); st.lastActiveDay = today;
      }
      g.streak = st;
      await S._fs.setDoc(uref, { gamification: g }, { merge: true });
      try { localStorage.setItem("sk_last_done", today); } catch (e) {}
    }
    syncActivity(uid).catch(function () {});
  }
  async function gamification(uid) {
    try { var d = await userDoc(uid); return (d && d.gamification) || { xp: 0, streak: { current: 0, best: 0, lastActiveDay: "" } }; }
    catch (e) { return { xp: 0, streak: { current: 0, best: 0, lastActiveDay: "" } }; }
  }

  /* referrals */
  function captureReferral() {
    try {
      var r = new URLSearchParams(location.search).get("ref");
      if (r && r.trim().length >= 4 && r.trim().length <= 128) localStorage.setItem("sk_pending_ref", r.trim());
    } catch (e) {}
  }
  async function consumeReferral(uid) {
    try {
      await ensure();
      var r = localStorage.getItem("sk_pending_ref");
      localStorage.removeItem("sk_pending_ref");
      if (!r || r === uid) return;
      await S._fs.setDoc(S._fs.doc(S.sDb, "referral_claims", uid), { by: r, at: Date.now(), granted: false });
    } catch (e) {}
  }
  async function claimRewards() {
    try {
      var me = await currentUser(); if (!me || me.provider !== "google") return 0;
      await ensure();
      var q = S._fs.query(S._fs.collection(S.sDb, "referral_claims"), S._fs.where("by", "==", me.uid));
      var snap = await S._fs.getDocs(q), n = 0;
      for (var i = 0; i < snap.docs.length; i++) {
        var d = snap.docs[i];
        if ((d.data() || {}).granted === true) continue;
        var uref = S._fs.doc(S.sDb, "users", me.uid), us = await S._fs.getDoc(uref);
        var old = (us.exists() && (us.data().referralFreeUntil || us.data().freeUntil)) || 0;
        await S._fs.setDoc(uref, { referralFreeUntil: Math.max(Date.now(), old) + 86400000 }, { merge: true });
        await S._fs.setDoc(S._fs.doc(S.sDb, "referral_claims", d.id), { granted: true }, { merge: true });
        n++;
      }
      return n;
    } catch (e) { return 0; }
  }
  async function myReferrals() {
    var out = { count: 0, freeDaysLeft: 0 };
    try {
      var me = await currentUser(); if (!me) return out;
      await ensure();
      var q = S._fs.query(S._fs.collection(S.sDb, "referral_claims"), S._fs.where("by", "==", me.uid));
      var snap = await S._fs.getDocs(q); out.count = snap.size;
      var us = await S._fs.getDoc(S._fs.doc(S.sDb, "users", me.uid));
      var fu = us.exists() ? (us.data().referralFreeUntil || us.data().freeUntil || 0) : 0;
      out.freeDaysLeft = fu > Date.now() ? Math.ceil((fu - Date.now()) / 86400000) : 0;
    } catch (e) {}
    return out;
  }

  /* focus rooms */
  var focusHb = null;
  async function focusJoin(roomId, name) {
    await ensure();
    var me = await currentUser(); if (!me) throw new Error("signin");
    var ref = S._fs.doc(S.sDb, "focus_rooms", roomId), o = {};
    o["members." + me.uid] = { at: Date.now(), name: name || me.displayName || "learner" };
    o.lastAt = Date.now();
    await S._fs.setDoc(ref, Object.assign({ name: roomId }, o), { merge: true });
    if (focusHb) clearInterval(focusHb);
    focusHb = setInterval(function () {
      var b = {}; b["members." + me.uid] = { at: Date.now(), name: name || me.displayName || "learner" }; b.lastAt = Date.now();
      S._fs.setDoc(ref, b, { merge: true }).catch(function () {});
    }, 20000);
    window.addEventListener("beforeunload", function () {
      S._fs.getDoc(ref).then(function (s) {
        var m = (s.exists() && s.data().members) || {};
        delete m[me.uid];
        S._fs.setDoc(ref, { members: m }, { merge: true }).catch(function () {});
      }).catch(function () {});
    });
  }
  async function focusRoster(roomId) {
    try {
      await ensure();
      var s = await S._fs.getDoc(S._fs.doc(S.sDb, "focus_rooms", roomId));
      var m = (s.exists() && s.data().members) || {}, now = Date.now(), out = [];
      Object.keys(m).forEach(function (uid) { if (now - ((m[uid] || {}).at || 0) < 90000) out.push({ uid: uid, name: m[uid].name || "learner" }); });
      return out;
    } catch (e) { return []; }
  }
  async function focusRooms() {
    try {
      await ensure();
      var snap = await S._fs.getDocs(S._fs.query(S._fs.collection(S.sDb, "focus_rooms"), S._fs.limit(6)));
      var out = [];
      snap.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data() || {})); });
      return out;
    } catch (e) { return []; }
  }
  /* Room chat — Firestore (RTDB never existed on this project, so chat moved here). */
  async function sendRoomChat(roomId, text) {
    var me = await currentUser(); if (!me) throw new Error("signin");
    await ensure();
    var admin = await isAdmin(me.uid);
    await S._fs.addDoc(S._fs.collection(S.sDb, "focus_rooms", roomId, "messages"), {
      uid: me.uid, name: admin ? "Admin" : String(me.displayName || "learner").slice(0, 40),
      authorRole: admin ? "admin" : "user",
      text: String(text).slice(0, 300), at: Date.now(),
    });
  }
  function watchRoomChat(roomId, cb) {
    var off = null, dead = false;
    ensure().then(function () {
      if (dead) return;
      var q = S._fs.query(S._fs.collection(S.sDb, "focus_rooms", roomId, "messages"), S._fs.orderBy("at", "desc"), S._fs.limit(40));
      var seen = false;
      off = S._fs.onSnapshot(q, function (snap) {
        if (!seen) {
          seen = true;
          if (snap.empty) return;
          var all = []; snap.forEach(function (d) { all.push(d.data()); });
          all.reverse().forEach(cb);
          return;
        }
        snap.docChanges().forEach(function (c) { if (c.type === "added") cb(c.doc.data()); });
      }, function () { if (!dead) cb(null); });
    }).catch(function () { if (!dead) cb(null); });
    return function () { dead = true; try { if (off) off(); } catch (e) {} };
  }

  /* Presence — who is online and what they're doing (admin sees this). */
  var presTimer = null, presNow = { page: "", action: "" };
  function presenceBeat(page, action) {
    if (page !== undefined) presNow.page = String(page || "").slice(0, 40);
    if (action !== undefined) presNow.action = String(action || "").slice(0, 60);
    if (!presNow.page) presNow.page = (location.pathname.split("/").pop() || "index.html");
    var hit = currentUser().then(function (me) {
      if (!me) return false;
      return ensure().then(function () {
        var ref = S._fs.doc(S.sDb, "presence", me.uid);
        var payload = { name: String(me.displayName || me.email || "learner").slice(0, 50), page: presNow.page, action: presNow.action, at: Date.now() };
        return S._fs.setDoc(ref, payload, { merge: true }).then(function () { return true; });
      });
    }).catch(function () { return false; });
    if (presTimer) clearInterval(presTimer);
    presTimer = setInterval(function () {
      currentUser().then(function (me) {
        if (!me) { clearInterval(presTimer); return; }
        return S._fs.setDoc(S._fs.doc(S.sDb, "presence", me.uid),
          { name: String(me.displayName || me.email || "learner").slice(0, 50), page: presNow.page, action: presNow.action, at: Date.now() }, { merge: true });
      }).catch(function () {});
    }, 15000);
    return hit;
  }

  /* The server verifies ID tokens, allowlisted emails, bans, and role documents. */
  var adminStatusCache = Object.create(null);
  async function verifyAdmin(uid) {
    var current = await currentUser();
    if (!current || current.provider !== "google" || current.uid !== uid) return false;
    var token = await idToken();
    if (!token) throw new Error("Admin status could not be verified");
    var result = await window.SK.api.isAdmin({ Authorization: "Bearer " + token });
    if (!result || result.uid !== uid) throw new Error("Admin status could not be verified");
    var admin = result.admin === true;
    adminStatusCache[uid] = { value: admin, at: Date.now() };
    return admin;
  }
  async function isAdmin(uid) {
    var cached = adminStatusCache[uid];
    if (cached && Date.now() - cached.at < 15000) return cached.value;
    try { return await verifyAdmin(uid); } catch (e) { return false; }
  }

  /* Messaging: DM threads + one common community thread + admin general/force. */
  function threadId(a, b) { return [a, b].sort().join("__"); }
  async function sendMsg(thread, text) {
    var me = await currentUser(); if (!me) throw new Error("signin");
    if (me.provider === "phone") {
      return window.SK.api.phoneProfile("send-message", { thread: thread, text: String(text).slice(0, 1000) });
    }
    await ensure();
    var admin = await isAdmin(me.uid);
    var dispName = admin ? "Admin" : String(me.displayName || "learner").slice(0, 40);
    var role = admin ? "admin" : "user";
    var t = String(text).slice(0, 1000), now = Date.now(), mid = now + "_" + Math.random().toString(36).slice(2, 8);
    await S._fs.setDoc(S._fs.doc(S.sDb, "threads", thread, "messages", mid),
      { from: me.uid, name: dispName, authorRole: role, text: t, at: now });
    await S._fs.setDoc(S._fs.doc(S.sDb, "threads", thread),
      { id: thread, lastText: t.slice(0, 80), lastAt: now, lastBy: me.uid, lastRole: role, community: thread === "community" }, { merge: true });
    if (thread !== "community" && me.provider !== "phone") {
      var other = thread.split("__").filter(function (x) { return x && x !== me.uid; })[0];
      if (other) {
        await S._fs.setDoc(S._fs.doc(S.sDb, "users", other, "inbox", mid),
          { from: me.uid, fromName: dispName, authorRole: role, text: t.slice(0, 200), at: now, read: false, kind: "general", thread: thread });
      }
    }
  }
  function watchThread(thread, cb) {
    var off = null, dead = false;
    ensure().then(function () {
      if (dead) return;
      var q = S._fs.query(S._fs.collection(S.sDb, "threads", thread, "messages"), S._fs.orderBy("at", "asc"), S._fs.limit(100));
      off = S._fs.onSnapshot(q, function (snap) {
        snap.docChanges().forEach(function (c) { if (c.type === "added") cb(c.doc.data()); });
      }, function () { cb(null); });
    }).catch(function () { cb(null); });
    return function () { dead = true; try { if (off) off(); } catch (e) {} };
  }
  async function myThreads() {
    try {
      var me = await currentUser(); if (!me) return [];
      await ensure();
      var q = S._fs.query(S._fs.collection(S.sDb, "threads"), S._fs.where("id", ">=", me.uid), S._fs.limit(40));
      var snap = await S._fs.getDocs(q), out = [];
      snap.forEach(function (d) { var v = d.data() || {}; if ((v.id || "").indexOf(me.uid + "__") === 0 || (v.id || "").indexOf("__" + me.uid) >= 0) out.push(v); });
      var c = await S._fs.getDoc(S._fs.doc(S.sDb, "threads", "community"));
      if (c.exists()) out.unshift(c.data());
      return out.sort(function (a, b) { return (b.lastAt || 0) - (a.lastAt || 0); });
    } catch (e) { return []; }
  }
  function watchInbox(uid, cb) {
    var phone = phoneLocal();
    if (phone && phone.uid === uid) {
      var cancelled = false;
      var timer = null;
      var refresh = function () {
        if (cancelled) return;
        inbox(uid, 30).then(function (rows) { if (!cancelled) cb(rows); })
          .catch(function () { if (!cancelled) cb(null); });
      };
      refresh();
      timer = setInterval(refresh, 15000);
      return function () { cancelled = true; if (timer) clearInterval(timer); };
    }
    var off = null, dead = false;
    ensure().then(function () {
      if (dead) return;
      var q = S._fs.query(S._fs.collection(S.sDb, "users", uid, "inbox"), S._fs.orderBy("at", "desc"), S._fs.limit(30));
      off = S._fs.onSnapshot(q, function (snap) {
        var rows = []; snap.forEach(function (d) { rows.push(Object.assign({ id: d.id }, d.data() || {})); });
        cb(rows);
      }, function () { cb(null); });
    }).catch(function () { cb(null); });
    return function () { dead = true; try { if (off) off(); } catch (e) {} };
  }
  async function inbox(uid, n) {
    try {
      var phone = phoneLocal();
      if (phone && phone.uid === uid) {
        var result = await window.SK.api.phoneProfile("inbox", { limit: n || 30 });
        return result && Array.isArray(result.items) ? result.items : [];
      }
      await ensure();
      var q = S._fs.query(S._fs.collection(S.sDb, "users", uid, "inbox"), S._fs.orderBy("at", "desc"), S._fs.limit(n || 30));
      var snap = await S._fs.getDocs(q), out = [];
      snap.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data() || {})); });
      return out;
    } catch (e) {
      var phoneUser = phoneLocal();
      if (phoneUser && phoneUser.uid === uid) throw e;
      return [];
    }
  }
  async function unreadCount(uid) {
    try {
      var rows = await inbox(uid, 40);
      return rows.filter(function (m) { return m.read !== true && m.kind !== "sent" && m.from !== uid; }).length;
    } catch (e) { return 0; }
  }
  async function markInboxRead(uid, id) {
    try {
      var phone = phoneLocal();
      if (phone && phone.uid === uid) {
        await window.SK.api.phoneProfile("mark-inbox-read", { id: id });
        return true;
      }
      await ensure();
      await S._fs.setDoc(S._fs.doc(S.sDb, "users", uid, "inbox", id), { read: true, readAt: Date.now() }, { merge: true });
      return true;
    } catch (e) { return false; }
  }
  async function pushInbox(uid, msg) {
    await ensure();
    var now = Date.now(), mid = msg.id || ("n_" + now + "_" + Math.random().toString(36).slice(2, 8));
    var payload = Object.assign({
      from: "admin", fromName: "Studio team", authorRole: "admin", at: now, read: false, kind: "general"
    }, msg);
    delete payload.id;
    await S._fs.setDoc(S._fs.doc(S.sDb, "users", uid, "inbox", mid), payload);
    return mid;
  }

  /* ---------- notices (targeted, timed, view-limited) ---------- */
  function noticeLive(n, views) {
    if (!n || n.active === false) return false;
    if (n.expiresAt && Date.now() > Number(n.expiresAt)) return false;
    if (n.maxViews && Number(views || 0) >= Number(n.maxViews)) return false;
    return true;
  }
  function noticeForUser(n, uid) {
    if (!n) return false;
    if (n.audience === "user") return String(n.uid || n.targetUid || "") === String(uid);
    if (Array.isArray(n.uids) && n.uids.length) return n.uids.indexOf(uid) >= 0;
    if (n.uid && n.audience !== "all") return String(n.uid) === String(uid);
    return n.audience === "all" || !n.audience;
  }
  async function noticeViews(uid) {
    try {
      await ensure();
      var snap = await S._fs.getDocs(S._fs.query(S._fs.collection(S.sDb, "users", uid, "noticeViews"), S._fs.limit(120)));
      var out = {};
      snap.forEach(function (d) { out[d.id] = d.data() || {}; });
      return out;
    } catch (e) { return {}; }
  }
  async function notices(uid) {
    try {
      await ensure();
      var snap = await S._fs.getDocs(S._fs.query(S._fs.collection(S.sDb, "notices"), S._fs.orderBy("createdAt", "desc"), S._fs.limit(60)));
      var views = await noticeViews(uid), out = [];
      snap.forEach(function (d) {
        var n = Object.assign({ id: d.id }, d.data() || {});
        var v = views[d.id] || {};
        if (v.dismissed === true) return;
        if (!noticeForUser(n, uid)) return;
        if (!noticeLive(n, v.views)) return;
        n.views = Number(v.views) || 0;
        out.push(n);
      });
      return out;
    } catch (e) { return []; }
  }
  async function markNoticeView(uid, id) {
    try {
      await ensure();
      var ref = S._fs.doc(S.sDb, "users", uid, "noticeViews", id);
      var snap = await S._fs.getDoc(ref);
      var cur = snap.exists() ? (snap.data() || {}) : {};
      await S._fs.setDoc(ref, { views: (Number(cur.views) || 0) + 1, lastAt: Date.now(), msgId: id }, { merge: true });
      return true;
    } catch (e) { return false; }
  }
  async function dismissNotice(uid, id) {
    try {
      await ensure();
      await S._fs.setDoc(S._fs.doc(S.sDb, "users", uid, "noticeViews", id), { dismissed: true, dismissedAt: Date.now() }, { merge: true });
      return true;
    } catch (e) { return false; }
  }

  /* ---------- security strikes ---------- */
  async function recordStrike(uid, reason) {
    if (!uid) return { strikes: 0, banned: false };
    var localKey = "sk_strikes_" + uid;
    try {
      var phone = phoneLocal();
      if (phone && phone.uid === uid) {
        var result = await window.SK.api.phoneProfile("strike", { reason: reason });
        try { localStorage.setItem(localKey, String(result.strikes)); } catch (e) {}
        return { strikes: result.strikes, banned: result.banned, ignored: result.ignored === true };
      }
      if (await verifyAdmin(uid)) return { strikes: 0, banned: false, ignored: true };
      await ensure();
      var ref = S._fs.doc(S.sDb, "users", uid), snap = await S._fs.getDoc(ref);
      var d = (snap.exists() && snap.data()) || {};
      var n = (Number(d.strikes) || 0) + 1;
      var now = Date.now();
      var patch = {
        strikes: n,
        lastStrikeAt: now,
        strikeReason: String(reason || "devtools").slice(0, 80),
        banned: true,
        banReason: "Automatic: developer tools opened",
        bannedAt: now
      };
      await S._fs.setDoc(ref, patch, { merge: true });
      try { localStorage.setItem(localKey, String(n)); } catch (e) {}
      return { strikes: n, banned: true };
    } catch (e) {
      var existing = 0;
      try { existing = parseInt(localStorage.getItem(localKey) || "0", 10) || 0; } catch (e2) {}
      return { strikes: existing, banned: false, offline: true };
    }
  }
  async function resetStrikes(uid) {
    try {
      await ensure();
      await S._fs.setDoc(S._fs.doc(S.sDb, "users", uid), { strikes: 0, lastStrikeAt: 0, strikeReason: "" }, { merge: true });
      try { localStorage.removeItem("sk_strikes_" + uid); } catch (e) {}
      return true;
    } catch (e) { return false; }
  }

  /* ---------- reports ---------- */
  async function replyReport(report, text, adminName) {
    if (!report || !report.by) throw new Error("No reporter on this report");
    var clean = String(text || "").trim().slice(0, 500);
    if (!clean) throw new Error("Write a reply first");
    var now = Date.now();
    await pushInbox(report.by, {
      fromName: String(adminName || "Studio team").slice(0, 40),
      kind: "report_reply",
      text: clean,
      link: "msgs.html",
      reportId: report.id || "",
      postId: report.postId || "",
      read: false,
      at: now
    });
    try {
      await ensure();
      if (report.id) {
        await S._fs.setDoc(S._fs.doc(S.sDb, "post_reports", report.id), { status: "replied", reply: clean, repliedAt: now }, { merge: true });
      }
    } catch (e) {}
    return true;
  }

  /* ---------- force messages ---------- */
  function forceViewCount(f) {
    var key = "sk_fv_" + String((f && (f.id || f.adminAt)) || "global");
    try { return parseInt(localStorage.getItem(key) || "0", 10) || 0; } catch (e) { return 0; }
  }
  async function bumpForceView(uid, f) {
    try {
      var vk = "sk_fv_" + String((f && (f.id || f.adminAt)) || "global");
      try { localStorage.setItem(vk, String(forceViewCount(f) + 1)); } catch (e) {}
      await ensure();
      var ref = S._fs.doc(S.sDb, "forceViews", uid);
      var snap = await S._fs.getDoc(ref);
      var cur = (snap.exists() && snap.data()) || {};
      await S._fs.setDoc(ref, {
        count: (Number(cur.count) || 0) + 1,
        lastAt: Date.now(),
        name: String((f && f.fromName) || "admin").slice(0, 40),
        text: String((f && f.text) || "").slice(0, 180)
      }, { merge: true });
      return true;
    } catch (e) { return false; }
  }
  function ackForce(uid, f) {
    return Promise.resolve({ released: !forceActive(f) });
  }
  /* Force msg: admin writes forceMsgs/{uid}; every page redirects the user to
     forcemsg.html while adminAt is fresh (<2 min) and allowLeave is false. */
  function watchForce(uid, cb) {
    var off = null, dead = false;
    ensure().then(function () {
      if (dead) return;
      off = S._fs.onSnapshot(S._fs.doc(S.sDb, "forceMsgs", uid), function (s) {
        cb(s.exists() ? s.data() : null);
      }, function () { cb(null); });
    }).catch(function () { cb(null); });
    return function () { dead = true; try { if (off) off(); } catch (e) {} };
  }
  /* A forced notice stays until the admin removes it, its timer expires, or
     the learner has seen it maxViews times — whichever comes first. */
  function forceActive(f) {
    if (!f || f.active === false || f.allowLeave === true || f.released === true) return false;
    var now = Date.now();
    var started = Number(f.adminAt || f.createdAt || 0);
    if (started && now - started > 30 * 86400000) return false;
    var expires = Number(f.expiresAt) || 0;
    if (expires > 0 && now > expires) return false;
    var max = Number(f.maxViews) || 0;
    if (max > 0 && forceViewCount(f) >= max) return false;
    return true;
  }
  function searchUsers(term, n) {
    try {
      var t = String(term || "").trim().toLowerCase();
      if (t.length < 2) return Promise.resolve([]);
      return ensure().then(function () {
        var q = S._fs.query(S._fs.collection(S.sDb, "users"), S._fs.limit(300));
        return S._fs.getDocs(q).then(function (snap) {
          var out = [];
          snap.forEach(function (d) {
            var v = d.data() || {};
            var hay = String(v.displayName || "") + " " + String(v.email || "") + " " + d.id;
            if (hay.toLowerCase().indexOf(t) >= 0 && out.length < (n || 8)) out.push({ uid: d.id, name: v.displayName || v.email || d.id, email: v.email || "" });
          });
          return out;
        });
      });
    } catch (e) { return Promise.resolve([]); }
  }

  /* App versions (admin publishes, app.html downloads latest). */
  async function appLatest() {
    try {
      await ensure();
      var q = S._fs.query(S._fs.collection(S.sDb, "app"), S._fs.orderBy("versionCode", "desc"), S._fs.limit(1));
      var snap = await S._fs.getDocs(q);
      if (snap.empty) return null;
      var d = snap.docs[0];
      return Object.assign({ id: d.id }, d.data());
    } catch (e) { return null; }
  }
  async function appVersions() {
    try {
      await ensure();
      var q = S._fs.query(S._fs.collection(S.sDb, "app"), S._fs.orderBy("versionCode", "desc"), S._fs.limit(8));
      var snap = await S._fs.getDocs(q), out = [];
      snap.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data() || {})); });
      return out;
    } catch (e) { return []; }
  }

  /* Raw access for heavy pages (admin/posts) — uses the same initialized db. */
  function raw() { return { get S() { return S; } }; }

  /* ---------- admin helpers ---------- */
  async function createNotice(data) {
    await ensure();
    var now = Date.now();
    var n = {
      title: String((data && data.title) || "Notice").slice(0, 120),
      body: String((data && data.body) || "").slice(0, 1200),
      link: String((data && data.link) || "").slice(0, 300),
      audience: (data && data.audience === "user") ? "user" : "all",
      uid: (data && data.audience === "user") ? String(data.uid || "") : "",
      createdAt: now,
      active: true,
      maxViews: Math.max(0, Math.min(999, Number(data && data.maxViews) || 0)),
      expiresAt: Number(data && data.expiresAt) || 0
    };
    var id = "nt_" + now + "_" + Math.random().toString(36).slice(2, 7);
    await S._fs.setDoc(S._fs.doc(S.sDb, "notices", id), n);
    return Object.assign({ id: id }, n);
  }
  async function noticesAll(n) {
    try {
      await ensure();
      var snap = await S._fs.getDocs(S._fs.query(S._fs.collection(S.sDb, "notices"), S._fs.orderBy("createdAt", "desc"), S._fs.limit(n || 20)));
      var out = [];
      snap.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data() || {})); });
      return out;
    } catch (e) { return []; }
  }
  async function setNoticeActive(id, active) {
    await ensure();
    await S._fs.setDoc(S._fs.doc(S.sDb, "notices", id), { active: !!active, updatedAt: Date.now() }, { merge: true });
  }
  async function deleteNotice(id) {
    await ensure();
    await S._fs.deleteDoc(S._fs.doc(S.sDb, "notices", id));
  }
  async function forceViews(n) {
    try {
      await ensure();
      var snap = await S._fs.getDocs(S._fs.query(S._fs.collection(S.sDb, "forceViews"), S._fs.orderBy("lastAt", "desc"), S._fs.limit(n || 10)));
      var out = [];
      snap.forEach(function (d) { out.push(Object.assign({ uid: d.id }, d.data() || {})); });
      return out;
    } catch (e) { return []; }
  }

  async function studyLog(mins) {
    try {
      var me = await currentUser(); if (!me) return;
      await ensure();
      var ref = S._fs.doc(S.sDb, "studyLog", me.uid + "_" + new Date().toDateString());
      var s = await S._fs.getDoc(ref);
      await S._fs.setDoc(ref, { minutes: ((s.exists() && s.data().minutes) || 0) + mins, at: Date.now() }, { merge: true });
    } catch (e) {}
  }

  /* notes / chat / community */
  async function saveNote(courseId, contentId, at, note) {
    var me = await currentUser(); if (!me) throw new Error("signin");
    await ensure();
    await S._fs.setDoc(S._fs.doc(S.sDb, "notes", me.uid + "_" + courseId + "_" + contentId + "_" + Date.now()),
      { userId: me.uid, courseId: String(courseId), contentId: String(contentId), at: at, note: String(note).slice(0, 500), createdAt: Date.now() });
  }
  async function listNotes(courseId, contentId) {
    try {
      var me = await currentUser(); if (!me) return [];
      await ensure();
      var q = S._fs.query(S._fs.collection(S.sDb, "notes"), S._fs.where("userId", "==", me.uid), S._fs.where("contentId", "==", String(contentId)));
      var snap = await S._fs.getDocs(q), out = [];
      snap.forEach(function (d) { out.push(d.data()); });
      return out.filter(function (n) { return String(n.courseId) === String(courseId); }).sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    } catch (e) { return []; }
  }
  async function sendChat(courseId, contentId, text) {
    var me = await currentUser(); if (!me) throw new Error("signin");
    await ensure();
    var admin = await isAdmin(me.uid);
    await S._fs.setDoc(S._fs.doc(S.sDb, "lecture_chats", courseId + "_" + contentId, "messages", Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
      { uid: me.uid, name: admin ? "Admin" : String(me.displayName || "learner").slice(0, 40), authorRole: admin ? "admin" : "user", text: String(text).slice(0, 300), at: Date.now(), deleteAt: Date.now() + 43200000 });
  }
  async function listChat(courseId, contentId) {
    try {
      await ensure();
      var q = S._fs.query(S._fs.collection(S.sDb, "lecture_chats", courseId + "_" + contentId, "messages"), S._fs.orderBy("at", "asc"), S._fs.limit(50));
      var snap = await S._fs.getDocs(q), out = [], cutoff = Date.now() - 43200000;
      snap.forEach(function (d) { var m = d.data() || {}; if ((m.at || 0) >= cutoff) out.push(m); });
      return out;
    } catch (e) { return []; }
  }
  async function announcements(n) {
    try {
      await ensure();
      var snap = await S._fs.getDocs(S._fs.query(S._fs.collection(S.sDb, "announcements"), S._fs.orderBy("createdAt", "desc"), S._fs.limit(n || 3)));
      var out = [];
      snap.forEach(function (d) { var a = d.data() || {}; if (a.active !== false) out.push({ id: d.id, title: a.title || "Announcement", body: a.body || "", link: a.link || "" }); });
      return out;
    } catch (e) { return []; }
  }
  async function postsRecent(n) {
    try {
      await ensure();
      var snap = await S._fs.getDocs(S._fs.query(S._fs.collection(S.sDb, "posts"), S._fs.orderBy("at", "desc"), S._fs.limit(n || 3)));
      var out = [];
      snap.forEach(function (d) { var p = d.data() || {}; out.push({ name: p.name || "learner", text: p.text || "", at: p.at || 0 }); });
      return out;
    } catch (e) { return []; }
  }

  /* enrollment (device-local) */
  function enrolled() { try { return JSON.parse(localStorage.getItem("sk_enrolled") || "[]"); } catch (e) { return []; } }
  function toggleEnroll(id) {
    var ids = enrolled(), i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1); else ids.push(id);
    try { localStorage.setItem("sk_enrolled", JSON.stringify(ids)); } catch (e) {}
    return ids;
  }

  return {
    ensure: ensure, currentUser: currentUser, userDoc: userDoc, requireLogin: requireLogin, signOut: signOut,
    banCheck: banCheck, phoneSession: phoneSession, idToken: idToken, authHeaders: authHeaders,
    syncPhone: syncPhone, syncGoogle: syncGoogle, saveProfile: saveProfile, checkPhone: checkPhone, mintKey: mintKey,
    prefs: prefs, saveOnboarding: saveOnboarding, myBatches: myBatches, mainBatch: mainBatch, setMainBatch: setMainBatch,
    progress: progress, saveProgress: saveProgress, gamification: gamification,
    activity: activity, activityMap: activityMap, syncActivity: syncActivity, dayKey: dayKey,
    captureReferral: captureReferral, consumeReferral: consumeReferral, claimRewards: claimRewards, myReferrals: myReferrals,
    focusJoin: focusJoin, focusRoster: focusRoster, focusRooms: focusRooms, sendRoomChat: sendRoomChat, watchRoomChat: watchRoomChat,
    studyLog: studyLog, saveNote: saveNote, listNotes: listNotes, sendChat: sendChat, listChat: listChat,
    announcements: announcements, postsRecent: postsRecent, enrolled: enrolled, toggleEnroll: toggleEnroll,
    presenceBeat: presenceBeat, isAdmin: isAdmin, verifyAdmin: verifyAdmin,
    threadId: threadId, sendMsg: sendMsg, watchThread: watchThread, myThreads: myThreads,
    watchInbox: watchInbox, inbox: inbox, unreadCount: unreadCount, markInboxRead: markInboxRead, pushInbox: pushInbox,
    notices: notices, noticeLive: noticeLive, noticeForUser: noticeForUser, markNoticeView: markNoticeView, dismissNotice: dismissNotice,
    recordStrike: recordStrike, resetStrikes: resetStrikes, replyReport: replyReport,
    bumpForceView: bumpForceView, forceViewCount: forceViewCount, ackForce: ackForce, watchForce: watchForce, forceActive: forceActive, forceViews: forceViews,
    createNotice: createNotice, noticesAll: noticesAll, setNoticeActive: setNoticeActive, deleteNotice: deleteNotice,
    searchUsers: searchUsers, appLatest: appLatest, appVersions: appVersions, raw: raw
  };
})();
