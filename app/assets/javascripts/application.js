// ----------------------------------------------------------------------
// Stock Chart — client side
//
// Talks only to our Rails JSON endpoints (/api/search, /api/quote,
// /api/candle, /api/profile). All Finnhub credentials stay server-side.
//
// Visualisation: lightweight-charts (TradingView) — handles candlestick
// data reliably and renders identically on desktop and mobile with
// built-in zoom and pan.
// ----------------------------------------------------------------------

(function () {
  "use strict";

  // ------------------------------------------------------------- helpers
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Number formatting: 2 decimals for small price moves, 4 for tiny ones.
  function fmtPrice(value) {
    if (value == null || isNaN(value)) return "—";
    const abs = Math.abs(value);
    const digits = abs >= 100 ? 2 : abs >= 1 ? 2 : 4;
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2, maximumFractionDigits: digits,
    }).format(value);
  }
  function fmtPct(value) {
    if (value == null || isNaN(value)) return "—";
    const sign = value > 0 ? "+" : "";
    return sign + value.toFixed(2) + "%";
  }

  // Throws a friendly-ish Error for non-2xx responses.
  async function fetchJSON(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin" });
    const ct  = res.headers.get("content-type") || "";
    const text = await res.text();
    const body = ct.includes("json") ? safeParse(text) : { error: text };
    if (!res.ok) {
      const msg = (body && body.error) || ("HTTP " + res.status);
      throw new Error(msg);
    }
    return body;
  }
  function safeParse(text) { try { return JSON.parse(text); } catch (_) { return null; } }

  // Debounce helper for the search input.
  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(ctx, args), ms);
    };
  }

  // ------------------------------------------------------------- state
  const state = {
    chart:            null,           // lightweight-charts IChartInstance
    candleSeries:     null,           // ISeriesApi for candles (or area-line)
    areaSeries:       null,           // ISeriesApi for the area variant
    activeSeries:     null,           // currently displayed series
    chartType:        "candlestick",
    range:            "1M",
    current:          null,            // last loaded candle payload
    debouncedSearch:  null,
    activeOption:     -1,
    lastResults:      [],
  };

  // ------------------------------------------------------------- DOM
  const els = {
    form:           $("#symbol-form"),
    input:          $("#symbol-input"),
    list:           $("#symbol-listbox"),
    combobox:       $("[data-combobox]"),
    rangeBtns:      $$(".range-btn"),
    chartTypeBtns:  $$(".chart-type-btn"),
    chartBox:       $("#chart"),
    chartEmpty:     $("#chart-empty"),
    chartStatus:    $("#chart-status"),
    summary:        $("#quote-summary"),
    symEl:          $("#quote-symbol"),
    nameEl:         $("#quote-name"),
    priceEl:        $("#quote-price"),
    changeEl:       $("#quote-change"),
    popularLink:    $("#popular-link"),
  };

  // ------------------------------------------------------------- chart
  // Convert our {t:[s], o, h, l, c:[number]} payload to the
  // lightweight-charts format: [{ time, open, high, low, close }, …]
  function toCandleData(payload) {
    const t = payload.t || [];
    const o = payload.o || [];
    const h = payload.h || [];
    const l = payload.l || [];
    const c = payload.c || [];
    const out = [];
    for (let i = 0; i < t.length; i++) {
      const time = t[i];                          // Finnhub gives us seconds
      const oo = o[i], hh = h[i], ll = l[i], cc = c[i];
      if (oo == null || hh == null || ll == null || cc == null) continue;
      out.push({ time, open: oo, high: hh, low: ll, close: cc });
    }
    // de-duplicate by time (lightweight-charts requires strictly increasing
    // time and no duplicates).
    const seen = new Set();
    return out.filter((p) => {
      if (seen.has(p.time)) return false;
      seen.add(p.time);
      return true;
    });
  }

  // Build initial chart and both series.
  function ensureChart() {
    if (state.chart) return;
    if (!window.LightweightCharts) {
      setStatus("Chart library failed to load. Check your network and reload.", true);
      return;
    }

    const chart = LightweightCharts.createChart(els.chartBox, {
      width:  els.chartBox.clientWidth,
      height: els.chartBox.clientHeight,
      layout: {
        background: { color: "transparent" },
        textColor:   "#cbd5e1",
        fontFamily:  "inherit",
      },
      grid: {
        vertLines: { color: "#1f2a44", style: 3 },
        horzLines: { color: "#1f2a44", style: 3 },
      },
      rightPriceScale:  { borderColor: "#1f2a44" },
      timeScale:        { borderColor: "#1f2a44", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      autoSize:  true,
    });

    // Pre-create both series so we can toggle them quickly.
    const candle = chart.addCandlestickSeries({
      upColor:       "#22c55e",
      downColor:     "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor:   "#22c55e",
      wickDownColor: "#ef4444",
      visible: true,
    });

    const area = chart.addAreaSeries({
      topColor:        "rgba(56, 189, 248, 0.45)",
      bottomColor:     "rgba(56, 189, 248, 0.04)",
      lineColor:       "#38bdf8",
      lineWidth:       2,
      priceLineVisible: false,
      lastValueVisible: true,
      visible: false,            // start hidden; toggled by chartType
    });

    state.chart       = chart;
    state.candleSeries = candle;
    state.areaSeries   = area;
    state.activeSeries = candle;

    window.addEventListener("resize", () => chart.applyOptions({ width: els.chartBox.clientWidth, height: els.chartBox.clientHeight }));
  }

  function switchToCandles() {
    if (state.activeSeries === state.candleSeries) return;
    // Repaint the candles now; the area series keeps its data so toggling
    // back is instant, but applyOptions hides it.
    state.candleSeries.applyOptions({ visible: true });
    state.areaSeries.applyOptions({ visible: false });
    state.activeSeries = state.candleSeries;
  }
  function switchToArea() {
    if (state.activeSeries === state.areaSeries) return;
    state.areaSeries.applyOptions({ visible: true });
    state.candleSeries.applyOptions({ visible: false });
    state.activeSeries = state.areaSeries;
  }

  function toAreaData(payload) {
    const t = payload.t || [];
    const c = payload.c || [];
    const out = [];
    for (let i = 0; i < t.length; i++) {
      if (c[i] == null) continue;
      out.push({ time: t[i], value: c[i] });
    }
    const seen = new Set();
    return out.filter((p) => {
      if (seen.has(p.time)) return false;
      seen.add(p.time);
      return true;
    });
  }

  function describeResponse(payload) {
    const bars       = payload.bars || (payload.t && payload.t.length) || 0;
    const resolution = payload.resolution || "?";
    const attempted  = payload.attempted_resolutions || [];
    const downgraded = attempted.length > 1 && payload.s !== "demo";
    let resNote = " · resolution " + resolution;
    if (downgraded) resNote += " (auto-downgraded for free tier)";
    return { bars, resolution, resNote, downgraded };
  }

  async function renderChart(symbol, range) {
    ensureChart();
    if (!state.chart) return;

    setStatus("Loading " + range + " data for " + symbol + "…", false);
    try {
      const payload = await fetchJSON("/api/candle?symbol=" + encodeURIComponent(symbol) + "&range=" + encodeURIComponent(range));

      if (!payload || (payload.s !== "ok" && payload.s !== "demo") || !payload.t || payload.t.length === 0) {
        renderEmptyChart("No data for " + symbol + " on the " + range + " range.");
        const attempted = (payload && payload.attempted_resolutions) || [];
        const hint = attempted.length > 1
          ? "  Tried resolutions: " + attempted.join(" → ") + "."
          : "";
        setStatus("No data available for " + symbol + " on the " + range + " range." + hint, true);
        state.current = null;
        return;
      }

      state.current = payload;

      const candleData = toCandleData(payload);
      const areaData   = toAreaData(payload);

      // Load data on the active series only — the other one stays empty.
      // We set both anyway so a toggle later is instant.
      state.candleSeries.setData(candleData);
      state.areaSeries.setData(areaData);

      if (state.chartType === "area") switchToArea();
      else                             switchToCandles();

      state.chart.timeScale().fitContent();

      els.chartEmpty.classList.add("is-hidden");
      const lastClose = payload.c[payload.c.length - 1];
      const desc = describeResponse(payload);
      const demoNote = payload.s === "demo" ? " · demo data (Finnhub plan doesn't support this endpoint)" : "";
      setStatus("Last price " + fmtPrice(lastClose) + " · " + desc.bars + " bars · range " + range + desc.resNote + demoNote, false);
    } catch (err) {
      renderEmptyChart();
      setStatus("Failed to load chart: " + (err && err.message || err), true);
    }
  }

  // Smooth in-place range change.  Sets data on both series and
  // re-fits the timeline; series switching happens if the chartType
  // doesn't match the new range naturally (we keep the user's choice).
  function changeRange(symbol, range) {
    if (!state.chart || !symbol) { return renderChart(symbol, range); }

    setStatus("Switching to " + range + "…", false);
    fetchJSON("/api/candle?symbol=" + encodeURIComponent(symbol) + "&range=" + encodeURIComponent(range))
      .then((payload) => {
        if (!payload || (payload.s !== "ok" && payload.s !== "demo") || !payload.t || payload.t.length === 0) {
          const attempted = (payload && payload.attempted_resolutions) || [];
          const hint = attempted.length > 1 ? "  Tried: " + attempted.join(" → ") + "." : "";
          setStatus("No data for " + symbol + " on " + range + "." + hint, true);
          return;
        }

        state.current = payload;
        const candleData = toCandleData(payload);
        const areaData   = toAreaData(payload);
        state.candleSeries.setData(candleData);
        state.areaSeries.setData(areaData);

        if (state.chartType === "area") switchToArea();
        else                             switchToCandles();

        state.chart.timeScale().fitContent();

        const lastClose = payload.c[payload.c.length - 1];
        const desc = describeResponse(payload);
        const demoNote = payload.s === "demo" ? " · demo data (Finnhub plan doesn't support this endpoint)" : "";
        setStatus("Last price " + fmtPrice(lastClose) + " · " + desc.bars + " bars · range " + range + desc.resNote + demoNote, false);
      })
      .catch((err) => setStatus("Failed to load " + range + ": " + (err && err.message || err), true));
  }

  function renderEmptyChart(message) {
    if (state.candleSeries) state.candleSeries.setData([]);
    if (state.areaSeries)   state.areaSeries.setData([]);
    if (message) {
      const p = els.chartEmpty.querySelector("p:first-child");
      if (p) p.textContent = message;
    }
    els.chartEmpty.classList.remove("is-hidden");
  }

  // ------------------------------------------------------------- quote
  async function loadQuote(symbol) {
    try {
      const [quote, profile] = await Promise.all([
        fetchJSON("/api/quote?symbol=" + encodeURIComponent(symbol)),
        fetchJSON("/api/profile?symbol=" + encodeURIComponent(symbol)),
      ]);

      const cp  = quote && quote.c;
      const pc  = quote && quote.pc;
      if (cp == null) {
        els.summary.hidden = true;
        return;
      }
      const change     = cp - pc;
      const changePct  = pc ? (change / pc) * 100 : 0;
      const isUp       = change >= 0;

      els.symEl.textContent   = symbol;
      els.nameEl.textContent  = (profile && (profile.name || profile.ticker)) || "";
      els.priceEl.textContent = fmtPrice(cp) + (profile && profile.currency ? " " + profile.currency : "");
      els.changeEl.textContent = (isUp ? "▲ " : "▼ ") + fmtPrice(change) + " (" + fmtPct(changePct) + ")";

      els.changeEl.classList.toggle("is-up",   isUp && change !== 0);
      els.changeEl.classList.toggle("is-down", !isUp && change !== 0);
      els.changeEl.classList.toggle("is-flat", change === 0);
      els.summary.hidden = false;
    } catch (err) {
      els.summary.hidden = true;
      // eslint-disable-next-line no-console
      console.warn("quote/profile load failed:", err);
    }
  }

  // ------------------------------------------------------------- autocompl
  function renderList(items) {
    els.list.innerHTML = "";
    if (!items || items.length === 0) {
      els.list.hidden = true;
      els.input.setAttribute("aria-expanded", "false");
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((it, idx) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("data-symbol", it.symbol);
      li.setAttribute("data-description", it.description || "");
      li.id = "symbol-opt-" + idx;
      li.innerHTML =
        '<span class="row-symbol">' + escapeHtml(it.displaySymbol || it.symbol) + '</span>' +
        '<span class="row-desc">'  + escapeHtml(it.description || "") + '</span>' +
        '<span class="row-type">'  + escapeHtml(it.type || "") + '</span>';
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        chooseSymbol(it.symbol, it.description);
      });
      frag.appendChild(li);
    });
    els.list.appendChild(frag);
    els.list.hidden = false;
    els.input.setAttribute("aria-expanded", "true");
    state.lastResults  = items;
    state.activeOption = -1;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function chooseSymbol(symbol, description) {
    els.input.value = symbol;
    els.list.hidden = true;
    els.input.setAttribute("aria-expanded", "false");
    runSearch(symbol, description);
  }

  function pickActive() {
    const li = els.list.querySelector("li.is-focused") || els.list.querySelector("li");
    if (li) {
      chooseSymbol(li.dataset.symbol, li.dataset.description);
    } else {
      const raw = els.input.value.trim();
      if (raw) runSearch(raw, "");
    }
  }

  function highlightOption(delta) {
    const items = $$("#symbol-listbox li");
    if (items.length === 0) return;
    state.activeOption = (state.activeOption + delta + items.length) % items.length;
    items.forEach((it, i) => it.classList.toggle("is-focused", i === state.activeOption));
    const next = items[state.activeOption];
    if (next) next.scrollIntoView({ block: "nearest" });
  }

  // ------------------------------------------------------------- search
  state.debouncedSearch = debounce(async function (q) {
    if (!q || q.length < 1) { renderList([]); return; }
    try {
      const data = await fetchJSON("/api/search?q=" + encodeURIComponent(q));
      const items = (data && data.result) || [];
      const seen = new Set();
      const deduped = items.filter((it) => {
        if (!it.symbol || seen.has(it.symbol)) return false;
        seen.add(it.symbol);
        return true;
      }).slice(0, 12);
      renderList(deduped);
    } catch (_err) {
      renderList([]);
    }
  }, 180);

  // ------------------------------------------------------------- wiring
  function runSearch(symbol, _description) {
    if (!symbol) return;
    state.range = currentActiveRange();
    loadQuote(symbol);
    renderChart(symbol, state.range);
    if (window.history && window.history.replaceState) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("s", symbol);
        url.searchParams.set("r", state.range);
        url.searchParams.set("t", state.chartType);
        window.history.replaceState(null, "", url.toString());
      } catch (_) { /* ignore */ }
    }
  }

  function currentActiveRange() {
    const active = $$(".range-btn").find((b) => b.classList.contains("is-active"));
    return (active && active.dataset.range) || "1M";
  }

  els.input.addEventListener("input", (e) => state.debouncedSearch(e.target.value.trim()));
  els.input.addEventListener("focus", (e) => { if (e.target.value.trim()) state.debouncedSearch(e.target.value.trim()); });
  els.input.addEventListener("blur", () => {
    setTimeout(() => { els.list.hidden = true; els.input.setAttribute("aria-expanded", "false"); }, 120);
  });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { highlightOption(1); e.preventDefault(); }
    else if (e.key === "ArrowUp")   { highlightOption(-1); e.preventDefault(); }
    else if (e.key === "Enter")     { pickActive(); e.preventDefault(); }
    else if (e.key === "Escape")    { els.list.hidden = true; }
  });

  els.form.addEventListener("submit", (e) => { e.preventDefault(); pickActive(); });

  els.rangeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.rangeBtns.forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      state.range = btn.dataset.range;
      const symbol = els.input.value.trim();
      if (symbol && window.history && window.history.replaceState) {
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("r", state.range);
          url.searchParams.set("t", state.chartType);
          url.searchParams.set("s", symbol);
          window.history.replaceState(null, "", url.toString());
        } catch (_) {}
      }
      if (symbol) changeRange(symbol, state.range);
    });
  });

  els.chartTypeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("is-active")) return;
      els.chartTypeBtns.forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-checked", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-checked", "true");
      state.chartType = btn.dataset.type;
      ensureChart();
      if (state.chartType === "area") switchToArea();
      else                             switchToCandles();
    });
  });

  $$(".chip").forEach((c) => {
    c.addEventListener("click", () => {
      const symbol = c.dataset.symbol;
      els.input.value = symbol;
      runSearch(symbol, "");
    });
  });

  function setStatus(text, isError) {
    els.chartStatus.textContent = text || "";
    els.chartStatus.classList.toggle("is-error", !!isError);
  }

  // ------------------------------------------------------------- boot
  function bootFromURL() {
    try {
      const url = new URL(window.location.href);
      const s = url.searchParams.get("s");
      const r = url.searchParams.get("r");
      const t = url.searchParams.get("t");
      if (t === "area" || t === "candlestick") {
        const btn = $$(".chart-type-btn").find((b) => b.dataset.type === t);
        if (btn) btn.click();
      }
      if (r) {
        const btn = $$(".range-btn").find((b) => b.dataset.range === r);
        if (btn && !btn.classList.contains("is-active")) btn.click();
      }
      if (s) {
        els.input.value = s;
        runSearch(s, "");
      }
    } catch (_) { /* ignore */ }
  }

  document.addEventListener("DOMContentLoaded", bootFromURL);
})();
