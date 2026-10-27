/* Speed Reader — RSVP with an optimal recognition point. Pure text maths; nothing leaves the page. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var KEY = "speedreader.v1";

  // ---------- text maths ----------
  var SENT_END = /[.!?؟…]["'”’»)\]]*$/;          // word closes a sentence
  var CLAUSE = /[,;:،؛—–]["'”’»)\]]*$/;          // word closes a clause
  var LEAD = /^[^\p{L}\p{N}]+/u, TRAIL = /[^\p{L}\p{N}\p{M}]+$/u;
  var AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-ﻼ]/;

  // Optimal recognition point: 0-based letter index for a word of n letters (as in OpenSpritz).
  function orpIndex(n) { return n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4; }
  // Letters with their combining marks (Arabic harakat stay on their letter).
  function clusters(s) { return s.match(/\P{M}\p{M}*/gu) || []; }
  // Split a word into [before, pivot, after] around its ORP, skipping leading/trailing punctuation.
  function pivotOf(word) {
    var cl = clusters(word), lead = (word.match(LEAD) || [""])[0], trail = (word.replace(LEAD, "").match(TRAIL) || [""])[0];
    var nLead = clusters(lead).length, core = cl.length - nLead - clusters(trail).length;
    if (core <= 0) return [word, "", ""];
    var i = nLead + orpIndex(core);
    return [cl.slice(0, i).join(""), cl[i], cl.slice(i + 1).join("")];
  }
  function letterCount(w) { return clusters(w.replace(LEAD, "").replace(TRAIL, "")).length; }

  // Words with sentence / paragraph marks.
  function tokenize(text) {
    var words = [], paras = String(text || "").split(/\n\s*\n/);
    paras.forEach(function (p, pi) {
      var ws = p.split(/\s+/).filter(Boolean);
      ws.forEach(function (w, i) {
        var prev = words[words.length - 1];
        words.push({ w: w, start: !prev || i === 0 || SENT_END.test(prev.w), paraEnd: i === ws.length - 1 && pi < paras.length - 1 });
      });
    });
    return words;
  }
  // Chunks of up to n words that never run across the end of a sentence or clause.
  function chunk(words, n) {
    var out = [];
    for (var i = 0; i < words.length;) {
      var c = { from: i, words: [] };
      while (i < words.length && c.words.length < n) {
        if (c.words.length && words[i].start) break;
        var w = words[i++]; c.words.push(w.w);
        if (SENT_END.test(w.w) || CLAUSE.test(w.w) || w.paraEnd) break;
      }
      c.text = c.words.join(" "); c.last = words[i - 1]; c.to = i;
      out.push(c);
    }
    return out;
  }
  // Milliseconds a chunk stays on screen.
  function delayFor(c, wpm, pauses) {
    var base = 60000 / wpm, ms = base * c.words.length;
    if (!pauses) return ms;
    var last = c.last.w;
    if (c.last.paraEnd) ms += base * 1.5;
    else if (SENT_END.test(last)) ms += base;
    else if (CLAUSE.test(last)) ms += base * 0.5;
    c.words.forEach(function (w) { if (letterCount(w) > 8) ms += base * 0.3; });
    return ms;
  }
  function sentenceStarts(words) { var s = []; words.forEach(function (w, i) { if (w.start) s.push(i); }); return s; }

  // ---------- state ----------
  var sv = S3.store(KEY) || {};
  var st = { wpm: Math.min(1000, Math.max(100, +sv.wpm || 300)), n: [1, 2, 3].indexOf(+sv.n) >= 0 ? +sv.n : 1, pauses: sv.pauses !== false,
    words: [], chunks: [], starts: [], ci: 0, playing: false, timer: null };
  var text = $("#text"), wordEl = $("#word"), stage = $("#stage");
  var SAMPLE_EN = "Speed reading with RSVP works by showing one word at a time in the same place on the screen. Your eyes stop jumping across the line, so more of your attention goes to the meaning.\n\nThe coloured letter marks the optimal recognition point: the spot, slightly left of the middle, where the eye recognises a word fastest. Start at around 300 words per minute, then raise the speed a little each day. If you lose the thread, press the left arrow to go back one sentence.";
  var SAMPLE_AR = "القراءة السريعة بطريقة العرض المتتابع تعرض كلمة واحدة في كل مرة وفي المكان نفسه من الشاشة. بهذا لا تتنقل عيناك على طول السطر، فيذهب انتباهك كله إلى المعنى.\n\nالحرف الملوّن هو النقطة التي تلتقط عندها العين الكلمة بأسرع ما يمكن. ابدأ بسرعة ثلاثمئة كلمة في الدقيقة تقريباً، ثم زد السرعة قليلاً كل يوم. وإذا فاتك شيء، فاضغط السهم لتعود جملة واحدة إلى الوراء.";

  function save() { S3.store(KEY, { wpm: st.wpm, n: st.n, pauses: st.pauses, text: text.value.length <= 200000 ? text.value : "", ci: st.chunks[st.ci] ? st.chunks[st.ci].from : 0 }); }
  var saveSoon = S3.debounce(save, 400);

  function load(keepWord) {
    var at = keepWord != null ? keepWord : 0;
    st.words = tokenize(text.value);
    st.chunks = chunk(st.words, st.n);
    st.starts = sentenceStarts(st.words);
    st.ci = 0;
    for (var i = 0; i < st.chunks.length; i++) if (st.chunks[i].from <= at) st.ci = i; else break;
    stats(); show();
  }
  function chunkAtWord(w) { var ci = 0; for (var i = 0; i < st.chunks.length; i++) if (st.chunks[i].from <= w) ci = i; else break; return ci; }

  function show() {
    var c = st.chunks[st.ci];
    wordEl.innerHTML = "";
    if (!c) {
      wordEl.appendChild(S3.h("span", { "class": "sr-hint", text: st.words.length ? "Done · انتهى" : "Paste text below · الصق النص في الأسفل" }));
      wordEl.removeAttribute("dir"); place(null); progress(); context(); return;
    }
    var p = pivotOf(c.text.length && st.n > 1 ? longest(c.words) : c.text), rtl = AR.test(c.text);
    if (st.n > 1) {   // several words: highlight the ORP of the longest one
      var lw = longest(c.words), idx = c.words.indexOf(lw), before = c.words.slice(0, idx).join(" "), after = c.words.slice(idx + 1).join(" ");
      p = [(before ? before + " " : "") + p[0], p[1], p[2] + (after ? " " + after : "")];
    }
    wordEl.setAttribute("dir", rtl ? "rtl" : "ltr");
    wordEl.setAttribute("lang", rtl ? "ar" : "en");
    wordEl.appendChild(document.createTextNode(p[0]));
    var piv = S3.h("span", { "class": "sr-piv", text: p[1] });
    wordEl.appendChild(piv);
    wordEl.appendChild(document.createTextNode(p[2]));
    place(piv); progress(); context();
  }
  function longest(ws) { return ws.reduce(function (a, b) { return letterCount(b) > letterCount(a) ? b : a; }, ws[0]); }
  // Move the word so the pivot letter's centre sits on the stage's centre line.
  function place(piv) {
    if (!piv || !piv.textContent) { wordEl.style.left = "50%"; wordEl.style.transform = "translateX(-50%)"; return; }
    wordEl.style.transform = "none"; wordEl.style.left = "0px";
    var sr = stage.getBoundingClientRect(), wr = wordEl.getBoundingClientRect(), pr = piv.getBoundingClientRect();
    var off = pr.left + pr.width / 2 - wr.left;
    wordEl.style.left = Math.round(sr.width / 2 - off) + "px";
  }
  function progress() {
    var total = st.words.length, at = st.chunks[st.ci] ? st.chunks[st.ci].from : total, pct = total ? at / total * 100 : 0;
    $("#fill").style.width = pct.toFixed(2) + "%";
    $("#bar").setAttribute("aria-valuenow", Math.round(pct));
    $("#pos").textContent = Math.min(at + 1, total).toLocaleString() + " / " + total.toLocaleString();
    var ms = 0;
    for (var i = st.ci; i < st.chunks.length; i++) ms += delayFor(st.chunks[i], st.wpm, st.pauses);
    $("#left").textContent = total ? fmtTime(ms) + " left" : "";
  }
  function fmtTime(ms) { var s = Math.round(ms / 1000); return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s"; }
  // While paused, show the sentence around the current word so you can find your place.
  function context() {
    var box = $("#context"); box.innerHTML = "";
    var c = st.chunks[st.ci];
    if (st.playing || !c) return;
    var s = 0, e = st.words.length;
    for (var i = 0; i < st.starts.length; i++) { if (st.starts[i] <= c.from) s = st.starts[i]; else { e = st.starts[i]; break; } }
    for (var j = s; j < e; j++) {
      var on = j >= c.from && j < c.to;
      box.appendChild(on ? S3.h("mark", { text: st.words[j].w }) : document.createTextNode(st.words[j].w));
      if (j < e - 1) box.appendChild(document.createTextNode(" "));
    }
  }
  function stats() {
    var w = st.words.length, ms = 0;
    st.chunks.forEach(function (c) { ms += delayFor(c, st.wpm, st.pauses); });
    var box = $("#stats"); box.innerHTML = "";
    [[w.toLocaleString(), "words · كلمة"], [st.starts.length.toLocaleString(), "sentences · جملة"], [w ? fmtTime(ms) : "—", "at " + st.wpm + " wpm"], [w ? fmtTime(w / 230 * 60000) : "—", "normal reading (230 wpm)"]]
      .forEach(function (s) { box.appendChild(S3.h("div", { "class": "stat" }, [S3.h("b", { text: s[0] }), S3.h("span", { text: s[1] })])); });
  }

  // ---------- playback ----------
  function tick() {
    var c = st.chunks[st.ci];
    if (!c) { pause(); return; }
    show();
    st.timer = setTimeout(function () {
      st.ci++;
      if (st.ci >= st.chunks.length) { pause(); show(); S3.done(); return; }
      tick();
    }, delayFor(c, st.wpm, st.pauses));
  }
  function play() {
    if (!st.chunks.length) { S3.toast("Paste some text first", "error"); text.focus(); return; }
    if (st.ci >= st.chunks.length) st.ci = 0;
    st.playing = true; setPlayUi(); tick();
  }
  function pause() { st.playing = false; clearTimeout(st.timer); setPlayUi(); context(); saveSoon(); }
  function toggle() { if (st.playing) pause(); else play(); }
  function setPlayUi() {
    $("#play-l").textContent = st.playing ? "Pause" : "Play";
    $("#play").setAttribute("aria-label", st.playing ? "Pause" : "Play");
    $("#play-i").innerHTML = '<use href="#i-' + (st.playing ? "pause" : "play") + '"/>';
    stage.classList.toggle("playing", st.playing);
  }
  function jumpSentence(dir) {
    var c = st.chunks[Math.min(st.ci, st.chunks.length - 1)];
    if (!c) return;
    var cur = c.from, target = cur;
    if (dir < 0) {
      var prevStarts = st.starts.filter(function (s) { return s < cur; }), here = st.starts.filter(function (s) { return s <= cur; }).pop() || 0;
      // Mid-sentence goes to its start; at a start goes to the sentence before.
      target = cur > here ? here : (prevStarts.length ? prevStarts[prevStarts.length - 1] : 0);
    } else {
      var next = st.starts.filter(function (s) { return s > cur; })[0];
      if (next == null) return;
      target = next;
    }
    st.ci = chunkAtWord(target);
    if (st.playing) { clearTimeout(st.timer); tick(); } else show();
  }
  function setWpm(v) { st.wpm = Math.min(1000, Math.max(100, Math.round(v / 10) * 10)); $("#wpm").value = st.wpm; $("#wpm-v").textContent = st.wpm + " wpm"; stats(); progress(); saveSoon(); }

  // ---------- wiring ----------
  $("#play").addEventListener("click", toggle);
  stage.addEventListener("click", toggle);
  $("#back").addEventListener("click", function () { jumpSentence(-1); });
  $("#fwd").addEventListener("click", function () { jumpSentence(1); });
  $("#restart").addEventListener("click", function () { st.ci = 0; if (st.playing) { clearTimeout(st.timer); tick(); } else show(); });
  $("#wpm").addEventListener("input", function () { setWpm(+this.value); });
  $$("#chunk button").forEach(function (b) {
    b.setAttribute("aria-pressed", String(+b.dataset.v === st.n));
    b.addEventListener("click", function () {
      $$("#chunk button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      var at = st.chunks[st.ci] ? st.chunks[st.ci].from : 0;
      st.n = +b.dataset.v; st.chunks = chunk(st.words, st.n); st.ci = chunkAtWord(at); show(); stats(); saveSoon();
    });
  });
  $("#pause").checked = st.pauses;
  $("#pause").addEventListener("change", function () { st.pauses = this.checked; stats(); progress(); saveSoon(); });
  $("#bar").addEventListener("click", function (e) {
    var r = this.getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    st.ci = chunkAtWord(Math.floor(f * st.words.length)); if (st.playing) { clearTimeout(st.timer); tick(); } else show();
  });
  text.addEventListener("input", S3.debounce(function () { if (st.playing) pause(); load(0); saveSoon(); }, 300));
  $("#s-en").addEventListener("click", function () { pause(); text.value = SAMPLE_EN; load(0); save(); });
  $("#s-ar").addEventListener("click", function () { pause(); text.value = SAMPLE_AR; load(0); save(); });
  $("#clear").addEventListener("click", function () { pause(); text.value = ""; load(0); save(); text.focus(); });
  $("#open input").addEventListener("change", function (e) {
    var f = e.target.files[0]; if (!f) return;
    S3.readFile(f, "text").then(function (t) { pause(); text.value = t; load(0); save(); });
    e.target.value = "";
  });
  document.addEventListener("keydown", function (e) {
    var t = e.target, typing = t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" && t.type !== "range" && t.type !== "checkbox" || t.tagName === "SELECT");
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " " && !(t && t.tagName === "BUTTON" && t !== $("#play"))) { e.preventDefault(); if (t !== $("#play")) toggle(); }
    else if (e.key === "ArrowLeft" && t.type !== "range") { e.preventDefault(); jumpSentence(-1); }
    else if (e.key === "ArrowRight" && t.type !== "range") { e.preventDefault(); jumpSentence(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setWpm(st.wpm + 25); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setWpm(st.wpm - 25); }
    else if (e.key === "Home") { e.preventDefault(); $("#restart").click(); }
  });
  window.addEventListener("resize", S3.debounce(show, 100));
  document.addEventListener("visibilitychange", function () { if (document.hidden && st.playing) pause(); });

  setWpm(st.wpm);
  text.value = typeof sv.text === "string" && sv.text ? sv.text : SAMPLE_EN;
  load(+sv.ci || 0);

  window.S3_DEMO = function () {
    pause(); text.value = SAMPLE_EN; setWpm(350); load(0);
    st.ci = chunkAtWord(st.words.map(function (w) { return w.w; }).indexOf("recognition")); show();
  };

  // Returns true, or a list of failed checks.
  window.S3_SELFTEST = function () {
    var fails = [];
    function eq(a, b, what) { if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(what + ": got " + JSON.stringify(a)); }
    var orp = [];
    for (var n = 1; n <= 13; n++) orp.push(orpIndex(n));
    eq(orp, [0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3], "ORP index for lengths 1..13");
    eq(orpIndex(20), 4, "ORP for long words");
    eq(pivotOf("a"), ["", "a", ""], "pivot of a");
    eq(pivotOf("hello,"), ["h", "e", "llo,"], "pivot skips trailing comma");
    eq(pivotOf("\"Hi"), ["\"H", "i", ""], "pivot skips leading quote");
    eq(pivotOf("recognition"), ["rec", "o", "gnition"], "11 letters -> index 3");
    eq(pivotOf("مرحبا"), ["م", "ر", "حبا"], "Arabic pivot");
    eq(pivotOf("مَرْحَبًا"), ["مَ", "رْ", "حَبًا"], "harakat stay on their letter");
    eq(pivotOf("—"), ["—", "", ""], "punctuation only");
    // timing at 300 wpm: 200 ms a word
    var words = tokenize("One two, three. Four extraordinary\n\nFive");
    var c1 = chunk(words, 1), d = c1.map(function (c) { return Math.round(delayFor(c, 300, true)); });
    eq(c1.map(function (c) { return c.text; }), ["One", "two,", "three.", "Four", "extraordinary", "Five"], "chunks of one");
    eq(d, [200, 300, 400, 200, 560, 200], "delays with pauses (clause +0.5, sentence +1, paragraph +1.5, long word +0.3)");
    eq(c1.map(function (c) { return Math.round(delayFor(c, 300, false)); }), [200, 200, 200, 200, 200, 200], "delays without pauses");
    eq(Math.round(delayFor(c1[0], 100, false)), 600, "100 wpm = 600 ms");
    eq(Math.round(delayFor(c1[0], 1000, false)), 60, "1000 wpm = 60 ms");
    var total = 0, ws = tokenize(new Array(301).join("word "));
    chunk(ws, 1).forEach(function (c) { total += delayFor(c, 300, true); });
    eq(Math.round(total), 60000, "300 plain words at 300 wpm take one minute");
    var c3 = chunk(tokenize("a b c d. e f, g h i j"), 3);
    eq(c3.map(function (c) { return c.text; }), ["a b c", "d.", "e f,", "g h i", "j"], "chunks of three stop at punctuation");
    eq(Math.round(delayFor(c3[0], 300, true)), 600, "three words = three word-times");
    eq(sentenceStarts(tokenize("One. Two three? Four")), [0, 1, 3], "sentence starts");
    eq(sentenceStarts(tokenize("مرحبا. كيف حالك؟ تمام")), [0, 1, 3], "Arabic sentence starts (؟)");
    eq(sentenceStarts(tokenize("He said \"stop.\" Then left")), [0, 3], "quote after full stop");
    return fails.length ? fails.slice(0, 6) : true;
  };
})();
