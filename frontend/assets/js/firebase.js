/* StudiKitEZ Firebase — dual projects, classic script, dynamic SDK imports.
   studiki = users/progress/bans; smexgod = anonymous playback-key minting only. */
window.SK = window.SK || {};
window.SK.fb = (function () {
  var S = { ready: false, sAuth: null, sDb: null, gAuth: null, gDb: null, anon: null };
  var V = "https://www.gstatic.com/firebasejs/11.6.1/";

  async function ensure() {
    if (S.ready) return S;
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
      if (t && m) return { uid: "phone_" + m, mobile: m, email: "", displayName: "+91 " + m, provider: "phone", token: t };
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
    await ensure();
    var ref = S._fs.doc(S.sDb, "users", "phone_" + mobile), snap = await S._fs.getDoc(ref);
    if (!snap.exists()) await S._fs.setDoc(ref, { mobile: mobile, email: "", displayName: "", provider: "phone", banned: false, createdAt: S._fs.serverTimestamp(), lastLoginAt: S._fs.serverTimestamp() });
    else await S._fs.setDoc(ref, { lastLoginAt: S._fs.serverTimestamp() }, { merge: true });
  }
  async function syncGoogle(fbUser) {
    await ensure();
    var ref = S._fs.doc(S.sDb, "users", fbUser.uid), snap = await S._fs.getDoc(ref);
    if (!snap.exists()) await S._fs.setDoc(ref, { email: fbUser.email || "", displayName: fbUser.displayName || "", photoURL: fbUser.photoURL || "", provider: "google", banned: false, createdAt: S._fs.serverTimestamp(), lastLoginAt: S._fs.serverTimestamp() });
    else await S._fs.setDoc(ref, { lastLoginAt: S._fs.serverTimestamp() }, { merge: true });
  }
  async function saveProfile(mobile, name, email) {
    await ensure();
    var ref = S._fs.doc(S.sDb, "users", "phone_" + mobile), snap = await S._fs.getDoc(ref);
    var cur = snap.exists() ? snap.data() : {}, up = {};
    if (name && !(cur.displayName || "").trim()) up.displayName = name;
    if (email && !(cur.email || "").trim()) up.email = email;
    if (Object.keys(up).length) await S._fs.setDoc(ref, up, { merge: true });
  }
  async function checkPhone(mobile) {
    try {
      await ensure();
      var snap = await S._fs.getDoc(S._fs.doc(S.sDb, "users", "phone_" + mobile));
      if (!snap.exists()) return { exists: false, hasName: false };
      return { exists: true, hasName: !!((snap.data().displayName || "").trim()) };
    } catch (e) { return { exists: false, hasName: false }; }
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
  function activity(n) {
    try {
      var k = "sk_activity_" + dayKey(), c = parseInt(localStorage.getItem(k) || "0", 10) || 0;
      localStorage.setItem(k, String(Math.min(999, c + n)));
    } catch (e) {}
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
    w[contentId] = { pct: Math.max(old.pct || 0, o.pct || 0), done: old.done || !!o.done, at: Date.now(), title: o.title || "", type: o.type || "video" };
    p.watched = w; p.lastContentId = contentId; p.lastTitle = o.title || ""; p.updatedAt = Date.now();
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
    }
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
        var old = (us.exists() && us.data().freeUntil) || 0;
        await S._fs.setDoc(uref, { freeUntil: Math.max(Date.now(), old) + 86400000 }, { merge: true });
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
      var fu = us.exists() ? (us.data().freeUntil || 0) : 0;
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
    await S._fs.setDoc(S._fs.doc(S.sDb, "lecture_chats", courseId + "_" + contentId, "messages", Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
      { uid: me.uid, name: (me.displayName || "learner").slice(0, 40), text: String(text).slice(0, 300), at: Date.now(), deleteAt: Date.now() + 43200000 });
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
      snap.forEach(function (d) { var a = d.data() || {}; if (a.active !== false) out.push({ title: a.title || "Announcement", body: a.body || "" }); });
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

  return { ensure: ensure, currentUser: currentUser, userDoc: userDoc, requireLogin: requireLogin, signOut: signOut, banCheck: banCheck, phoneSession: phoneSession, idToken: idToken, authHeaders: authHeaders, syncPhone: syncPhone, syncGoogle: syncGoogle, saveProfile: saveProfile, checkPhone: checkPhone, mintKey: mintKey, progress: progress, saveProgress: saveProgress, gamification: gamification, activity: activity, dayKey: dayKey, captureReferral: captureReferral, consumeReferral: consumeReferral, claimRewards: claimRewards, myReferrals: myReferrals, focusJoin: focusJoin, focusRoster: focusRoster, focusRooms: focusRooms, studyLog: studyLog, saveNote: saveNote, listNotes: listNotes, sendChat: sendChat, listChat: listChat, announcements: announcements, postsRecent: postsRecent, enrolled: enrolled, toggleEnroll: toggleEnroll };
})();
