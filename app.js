
const { useState, useMemo, useCallback, useEffect } = React;

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');`;

// Magic color-pie mapping, grounded in the folder naming the user already uses
function folderAccent(folder = "") {
  const f = folder.toLowerCase();
  if (f.includes("bianc")) return { name: "Bianco", c: "#D8CFA8", glow: "rgba(216,207,168,0.18)" };
  if (f.includes("verd")) return { name: "Verde", c: "#5B8A52", glow: "rgba(91,138,82,0.22)" };
  if (f.includes("ross")) return { name: "Rosso", c: "#B5482F", glow: "rgba(181,72,47,0.22)" };
  if (f.includes("ner")) return { name: "Nero", c: "#9C8FBF", glow: "rgba(156,143,191,0.16)" };
  if (f.includes("blu") || f.includes("azzur")) return { name: "Blu", c: "#3E7CB1", glow: "rgba(62,124,177,0.22)" };
  if (f.includes("terr") || f.includes("land")) return { name: "Terre", c: "#C9A227", glow: "rgba(201,162,39,0.22)" };
  if (f.includes("mult") || f.includes("oro") || f.includes("gold")) return { name: "Multicolore", c: "#C9A227", glow: "rgba(201,162,39,0.22)" };
  return { name: folder || "Altro", c: "#8B9490", glow: "rgba(139,148,144,0.16)" };
}

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function fmtEur(n) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

// Scryfall's public image endpoint returns a card image directly for a given
// name/set — no API key needed, safe for client-side use.
function scryfallImg(name, setCode, size = "small") {
  const params = new URLSearchParams({ fuzzy: name, format: "image", version: size });
  if (setCode) params.set("set", setCode.toLowerCase());
  return `https://api.scryfall.com/cards/named?${params.toString()}`;
}

let nextIdCounter = 100000;
function freshId() {
  nextIdCounter += 1;
  return `new-${nextIdCounter}`;
}

function Grimorio() {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState("Tutte");
  const [sortKey, setSortKey] = useState("market");
  const [sortDir, setSortDir] = useState("desc");
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState(null);
  const [marked, setMarked] = useState(() => new Set());
  const [onlyMarked, setOnlyMarked] = useState(false);
  const [imgFailed, setImgFailed] = useState(() => new Set());
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [tab, setTab] = useState("collezione");
  const [newsData, setNewsData] = useState(null);
  const [newsError, setNewsError] = useState(false);
  const [legalityResults, setLegalityResults] = useState(null);
  const [legalityLoading, setLegalityLoading] = useState(false);
  const [priceMoves, setPriceMoves] = useState(null);

  // News generali: legge news.json dallo stesso dominio (nessuna chiamata
  // cross-origin dal telefono). In questa anteprima di chat il file non
  // esiste ancora — fallisce silenziosamente e mostriamo un avviso chiaro.
  React.useEffect(() => {
    fetch("./news.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setNewsData(data))
      .catch(() => setNewsError(true));
  }, []);

  // Prezzi in movimento: confronta lo snapshot salvato nel telefono
  // l'ultima volta che l'app è stata aperta con i prezzi di oggi.
  React.useEffect(() => {
    if (!rows) return;
    try {
      const key = "grimorio_price_snapshot";
      const prevRaw = window.localStorage ? window.localStorage.getItem(key) : null;
      const prev = prevRaw ? JSON.parse(prevRaw) : null;
      const today = {};
      rows.forEach((r) => {
        if (r.market !== null) today[r.id] = { market: r.market, name: r.name, setName: r.setName };
      });
      if (prev) {
        const moves = [];
        Object.keys(today).forEach((id) => {
          if (prev[id] && prev[id].market !== today[id].market) {
            const delta = today[id].market - prev[id].market;
            const pct = prev[id].market > 0 ? (delta / prev[id].market) * 100 : 0;
            moves.push({ id, name: today[id].name, setName: today[id].setName, from: prev[id].market, to: today[id].market, delta, pct });
          }
        });
        moves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
        setPriceMoves({ moves: moves.slice(0, 15), comparedTo: prev.__savedAt || null });
      } else {
        setPriceMoves({ moves: [], comparedTo: null, firstRun: true });
      }
      today.__savedAt = new Date().toISOString();
      if (window.localStorage) window.localStorage.setItem(key, JSON.stringify(today));
    } catch (e) {
      // localStorage non disponibile (es. anteprima sandbox) — non è grave,
      // semplicemente non mostriamo i movimenti prezzo.
    }
  }, [rows]);

  const checkLegality = async () => {
    if (!rows || rows.length === 0) return;
    setLegalityLoading(true);
    const uniqueNames = Array.from(new Set(rows.map((r) => r.name)));
    const chunks = [];
    for (let i = 0; i < uniqueNames.length; i += 75) chunks.push(uniqueNames.slice(i, i + 75));
    const flagged = [];
    try {
      for (const chunk of chunks) {
        const res = await fetch("https://api.scryfall.com/cards/collection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        (data.data || []).forEach((card) => {
          const watched = ["historic", "pioneer", "commander"];
          const issues = watched
            .filter((fmt) => card.legalities && ["banned", "restricted", "suspended"].includes(card.legalities[fmt]))
            .map((fmt) => ({ format: fmt, status: card.legalities[fmt] }));
          if (issues.length > 0) flagged.push({ name: card.name, issues });
        });
      }
      setLegalityResults(flagged);
    } catch (e) {
      setLegalityResults([]);
    }
    setLegalityLoading(false);
  };

  const toggleMarked = (key) => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const markImgFailed = (key) => {
    setImgFailed((prev) => new Set(prev).add(key));
  };

  const updateRow = (id, patch) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setSelected((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  };

  const deleteRow = (id) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setMarked((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSelected(null);
  };

  const addRow = (data) => {
    const id = freshId();
    const newRow = {
      id,
      folder: data.folder || "Senza cartella",
      name: data.name,
      setName: data.setName || "",
      setCode: data.setCode || "",
      number: data.number || "",
      condition: data.condition || "Mint",
      printing: data.printing || "Normal",
      language: data.language || "Italian",
      qty: toNum(data.qty) ?? 1,
      bought: toNum(data.bought),
      low: null,
      mid: null,
      market: toNum(data.market),
      dateBought: new Date().toISOString().slice(0, 10),
    };
    setRows((prev) => (prev ? [newRow, ...prev] : [newRow]));
    setShowAddForm(false);
  };

  const parseFile = useCallback((file) => {
    setError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      let text = String(e.target.result || "");
      // Strip a UTF-8 BOM if present (common in exports from mobile apps)
      text = text.replace(/^\uFEFF/, "");
      // Strip a leading "sep=,;" directive some exports include, on its own line —
      // handle both bare (sep=,) and quoted ("sep=,") forms
      const lines = text.split(/\r?\n/);
      if (lines.length && /^"?sep=/i.test(lines[0].trim())) {
        lines.shift();
      }
      text = lines.join("\n");
      const result = Papa.parse(text, { header: true, skipEmptyLines: true });
      if (!result.data || result.data.length === 0) {
        setError("Non ho trovato righe leggibili in questo file.");
        return;
      }
      const headers = result.meta?.fields || [];
      const hasNameCol = headers.some((h) => h && h.trim() === "Card Name");
      if (!hasNameCol) {
        setError(
          `Non riconosco le colonne di questo file (trovate: ${headers.slice(0, 5).join(", ")}${
            headers.length > 5 ? "…" : ""
          }). Mi serve una colonna "Card Name".`
        );
        return;
      }
      const parsed = result.data
        .map((r, idx) => {
          const qty = toNum(r["Quantity"]) ?? 1;
          const market = toNum(r["MARKET"]);
          const bought = toNum(r["Price Bought"]);
          return {
            id: `row-${idx}`,
            folder: r["Folder Name"] || "Senza cartella",
            name: r["Card Name"] || "",
            setName: r["Set Name"] || "",
            setCode: r["Set Code"] || "",
            number: r["Card Number"] || "",
            condition: r["Condition"] || "",
            printing: r["Printing"] || "",
            language: r["Language"] || "",
            qty,
            bought,
            low: toNum(r["LOW"]),
            mid: toNum(r["MID"]),
            market,
            dateBought: r["Date Bought"] || "",
          };
        })
        .filter((r) => r.name);
      if (parsed.length === 0) {
        setError("Il file è stato letto ma non contiene righe con un nome carta valido.");
        return;
      }
      setRows(parsed);
    };
    reader.onerror = () => setError("Non sono riuscito a leggere il file.");
    reader.readAsText(file);
  }, []);

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file);
  };

  const folders = useMemo(() => {
    if (!rows) return [];
    const set = new Set(rows.map((r) => r.folder));
    return ["Tutte", ...Array.from(set).sort()];
  }, [rows]);

  const stats = useMemo(() => {
    if (!rows) return null;
    let totalMarket = 0,
      totalBought = 0,
      cardCount = 0,
      known = 0;
    for (const r of rows) {
      cardCount += r.qty;
      if (r.market !== null) totalMarket += r.market * r.qty;
      if (r.bought !== null) {
        totalBought += r.bought * r.qty;
        known += r.qty;
      }
    }
    const gainPct = totalBought > 0 ? ((totalMarket - totalBought) / totalBought) * 100 : null;
    return { totalMarket, totalBought, cardCount, gainPct, uniqueLines: rows.length };
  }, [rows]);

  const topMovers = useMemo(() => {
    if (!rows) return [];
    return [...rows]
      .filter((r) => r.market !== null)
      .sort((a, b) => b.market * b.qty - a.market * a.qty)
      .slice(0, 8);
  }, [rows]);

  const maxTopValue = topMovers.length ? topMovers[0].market * topMovers[0].qty : 1;

  const filtered = useMemo(() => {
    if (!rows) return [];
    let out = rows;
    if (folderFilter !== "Tutte") out = out.filter((r) => r.folder === folderFilter);
    if (onlyMarked) out = out.filter((r) => marked.has(r.id));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.setName.toLowerCase().includes(q) ||
          r.setCode.toLowerCase().includes(q)
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      const av =
        sortKey === "market"
          ? (a.market ?? -1) * a.qty
          : sortKey === "bought"
          ? a.bought ?? -1
          : sortKey === "gain"
          ? a.bought ? ((a.market ?? 0) - a.bought) / a.bought : -Infinity
          : String(a[sortKey] || "").toLowerCase();
      const bv =
        sortKey === "market"
          ? (b.market ?? -1) * b.qty
          : sortKey === "bought"
          ? b.bought ?? -1
          : sortKey === "gain"
          ? b.bought ? ((b.market ?? 0) - b.bought) / b.bought : -Infinity
          : String(b[sortKey] || "").toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return out;
  }, [rows, folderFilter, onlyMarked, marked, query, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div style={styles.app}>
      <style>{`
        ${FONT_IMPORT}
        * { box-sizing: border-box; }
        .grim-row:hover { background: rgba(201,162,39,0.06) !important; }
        .grim-th { cursor: pointer; user-select: none; }
        .grim-th:hover { color: #E8E2D0 !important; }
        input[type="text"]::placeholder { color: #6B7570; }
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: #12181A; }
        ::-webkit-scrollbar-thumb { background: #2A342F; border-radius: 6px; }
      `}</style>

      {/* Hero */}
      <header style={styles.hero}>
        <div style={styles.heroTop}>
          <div style={styles.heroMark}>
            <span style={{color:"#C9A227",fontSize:16}}>✦</span>
          </div>
          <span style={styles.heroKicker}>Registro della collezione</span>
        </div>
        <h1 style={styles.heroTitle}>Grimorio</h1>
        {!stats && (
          <p style={styles.heroSub}>
            Carica l'export CSV della tua collezione per vedere valore, guadagni e i pezzi che contano.
          </p>
        )}
        {stats && (
          <div style={styles.heroStats}>
            <div style={styles.heroStat}>
              <div style={styles.heroStatValue}>{fmtEur(stats.totalMarket)}</div>
              <div style={styles.heroStatLabel}>Valore di mercato</div>
            </div>
            <div style={styles.heroDivider} />
            <div style={styles.heroStat}>
              <div style={styles.heroStatValue}>{stats.cardCount}</div>
              <div style={styles.heroStatLabel}>Carte ({stats.uniqueLines} voci)</div>
            </div>
            <div style={styles.heroDivider} />
            <div style={styles.heroStat}>
              <div
                style={{
                  ...styles.heroStatValue,
                  color: stats.gainPct >= 0 ? "#7BAE6F" : "#C4634A",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>{stats.gainPct >= 0 ? "↑" : "↓"}</span>
                {stats.gainPct !== null ? `${stats.gainPct >= 0 ? "+" : ""}${stats.gainPct.toFixed(0)}%` : "—"}
              </div>
              <div style={styles.heroStatLabel}>rispetto a {fmtEur(stats.totalBought)} spesi</div>
            </div>
          </div>
        )}
      </header>

      {!rows && (
        <div
          style={{ ...styles.dropzone, ...(dragOver ? styles.dropzoneActive : {}) }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <span style={{color:"#C9A227",fontSize:26}}>⬆</span>
          <div style={styles.dropzoneText}>Trascina qui il tuo file CSV</div>
          <div style={styles.dropzoneSub}>oppure</div>
          <label style={styles.uploadBtn}>
            Scegli file
            <input type="file" accept=".csv" onChange={handleFileInput} style={{ display: "none" }} />
          </label>
          {error && <div style={styles.errorText}>{error}</div>}
        </div>
      )}

      {rows && (
        <>
          <nav style={styles.tabBar}>
            <button
              onClick={() => setTab("collezione")}
              style={{ ...styles.tabBtn, ...(tab === "collezione" ? styles.tabBtnActive : {}) }}
            >
              Collezione
            </button>
            <button
              onClick={() => setTab("news")}
              style={{ ...styles.tabBtn, ...(tab === "news" ? styles.tabBtnActive : {}) }}
            >
              News
            </button>
          </nav>

          {tab === "collezione" && (
        <>
          {/* Top movers */}
          {topMovers.length > 0 && (
            <section style={styles.moversSection}>
              <h2 style={styles.sectionTitle}>Le carte che pesano di più</h2>
              <div style={styles.moversList}>
                {topMovers.map((c, i) => {
                  const accent = folderAccent(c.folder);
                  const value = c.market * c.qty;
                  const pct = Math.max(4, (value / maxTopValue) * 100);
                  const gain = c.bought ? ((c.market - c.bought) / c.bought) * 100 : null;
                  const key = c.id;
                  return (
                    <div key={i} style={styles.moverRow} onClick={() => { setSelected(c); setEditMode(false); }}>
                      <div style={styles.moverRank}>{i + 1}</div>
                      {!imgFailed.has(key) ? (
                        <img
                          src={scryfallImg(c.name, c.setCode, "small")}
                          alt=""
                          loading="lazy"
                          style={styles.moverThumb}
                          onError={() => markImgFailed(key)}
                        />
                      ) : (
                        <div style={styles.moverThumbFallback} />
                      )}
                      <div style={styles.moverInfo}>
                        <div style={styles.moverName}>{c.name}</div>
                        <div style={styles.moverSet}>{c.setName}</div>
                      </div>
                      <div style={styles.moverBarTrack}>
                        <div
                          style={{
                            ...styles.moverBarFill,
                            width: `${pct}%`,
                            background: `linear-gradient(90deg, ${accent.c}55, ${accent.c})`,
                          }}
                        />
                      </div>
                      <div style={styles.moverValue}>{fmtEur(value)}</div>
                      <div
                        style={{
                          ...styles.moverGain,
                          color: gain === null ? "#6B7570" : gain >= 0 ? "#7BAE6F" : "#C4634A",
                        }}
                      >
                        {gain === null ? "—" : `${gain >= 0 ? "+" : ""}${gain.toFixed(0)}%`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Controls */}
          <section style={styles.controls}>
            <div style={styles.searchBox}>
              <span style={{color:"#6B7570",fontSize:14}}>⌕</span>
              <input
                type="text"
                placeholder="Cerca per nome o espansione…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={styles.searchInput}
              />
            </div>
            <div style={styles.folderPills}>
              {folders.map((f) => {
                const accent = f === "Tutte" ? { c: "#8B9490" } : folderAccent(f);
                const active = folderFilter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setFolderFilter(f)}
                    style={{
                      ...styles.pill,
                      borderColor: active ? accent.c : "#2A342F",
                      color: active ? "#E8E2D0" : "#8B9490",
                      background: active ? `${accent.c}22` : "transparent",
                    }}
                  >
                    <span style={{ ...styles.pillDot, background: accent.c }} />
                    {f}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setOnlyMarked((v) => !v)}
              style={{
                ...styles.pill,
                borderColor: onlyMarked ? "#C9A227" : "#2A342F",
                color: onlyMarked ? "#C9A227" : "#8B9490",
                background: onlyMarked ? "rgba(201,162,39,0.12)" : "transparent",
              }}
            >
              ★ Solo segnate {marked.size > 0 ? `(${marked.size})` : ""}
            </button>
            <div style={styles.resultCount}>{filtered.length} risultati</div>
            <button style={styles.addBtn} onClick={() => setShowAddForm(true)}>
              + Aggiungi carta
            </button>
          </section>

          {/* Ledger table */}
          <section style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, width: 4 }}></th>
                  <th style={{ ...styles.th, width: 34 }}></th>
                  <th style={styles.th} className="grim-th" onClick={() => toggleSort("name")}>
                    Carta <span style={{opacity:0.5,fontSize:10}}>↕</span>
                  </th>
                  <th style={styles.th}>Espansione</th>
                  <th style={styles.th}>Cond. / Stampa</th>
                  <th style={styles.th} className="grim-th" onClick={() => toggleSort("bought")}>
                    Pagata
                  </th>
                  <th style={styles.th} className="grim-th" onClick={() => toggleSort("market")}>
                    Mercato
                  </th>
                  <th style={styles.th} className="grim-th" onClick={() => toggleSort("gain")}>
                    Var.
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((r, i) => {
                  const accent = folderAccent(r.folder);
                  const value = r.market !== null ? r.market * r.qty : null;
                  const gain = r.bought && r.market !== null ? ((r.market - r.bought) / r.bought) * 100 : null;
                  const key = r.id;
                  const isMarked = marked.has(key);
                  return (
                    <tr
                      key={i}
                      className="grim-row"
                      style={{ ...styles.tr, cursor: "pointer", background: isMarked ? "rgba(201,162,39,0.05)" : undefined }}
                      onClick={() => { setSelected(r); setEditMode(false); }}
                    >
                      <td style={{ ...styles.td, padding: 0 }}>
                        <div style={{ width: 3, height: 28, background: accent.c, borderRadius: 2 }} />
                      </td>
                      <td style={{ ...styles.td, padding: "4px 6px 4px 10px" }}>
                        {!imgFailed.has(key) ? (
                          <img
                            src={scryfallImg(r.name, r.setCode, "small")}
                            alt=""
                            loading="lazy"
                            style={styles.rowThumb}
                            onError={() => markImgFailed(key)}
                          />
                        ) : (
                          <div style={styles.rowThumbFallback} />
                        )}
                      </td>
                      <td style={{ ...styles.td, fontFamily: "'Fraunces', serif", fontWeight: 500 }}>
                        {isMarked && <span style={{ color: "#C9A227", marginRight: 6 }}>★</span>}
                        {r.name}
                        {r.qty > 1 && <span style={styles.qtyBadge}>×{r.qty}</span>}
                        {r.printing === "Foil" && <span style={styles.foilBadge}>foil</span>}
                      </td>
                      <td style={{ ...styles.td, color: "#8B9490" }}>{r.setName}</td>
                      <td style={{ ...styles.td, color: "#6B7570", fontSize: 12 }}>
                        {r.condition} · {r.language}
                      </td>
                      <td style={styles.tdNum}>{fmtEur(r.bought)}</td>
                      <td style={{ ...styles.tdNum, color: "#E8E2D0", fontWeight: 600 }}>{fmtEur(value)}</td>
                      <td
                        style={{
                          ...styles.tdNum,
                          color: gain === null ? "#6B7570" : gain >= 0 ? "#7BAE6F" : "#C4634A",
                        }}
                      >
                        {gain === null ? "—" : `${gain >= 0 ? "+" : ""}${gain.toFixed(0)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 200 && (
              <div style={styles.moreNote}>Mostrate le prime 200 righe su {filtered.length} — affina la ricerca per vedere altro.</div>
            )}
          </section>
        </>
          )}

          {tab === "news" && (
            <section style={styles.newsWrap}>
              {/* Notizie generali */}
              <div style={styles.newsCard}>
                <h3 style={styles.newsCardTitle}>Notizie generali</h3>
                {newsError && (
                  <p style={styles.newsMuted}>
                    news.json non trovato — normale qui nell'anteprima di chat. Una volta pubblicata l'app su GitHub
                    Pages insieme alla GitHub Action, questa sezione si popola da sola.
                  </p>
                )}
                {!newsError && newsData && newsData.general && newsData.general.length === 0 && (
                  <p style={styles.newsMuted}>
                    {newsData.note || "Nessuna notizia ancora — in attesa del primo aggiornamento automatico."}
                  </p>
                )}
                {newsData && newsData.general && newsData.general.length > 0 && (
                  <ul style={styles.newsList}>
                    {newsData.general.map((n, i) => (
                      <li key={i} style={styles.newsItem}>
                        <a href={n.link} target="_blank" rel="noreferrer" style={styles.newsLink}>
                          {n.title}
                        </a>
                        {n.summary && <div style={styles.newsSummary}>{n.summary}</div>}
                      </li>
                    ))}
                  </ul>
                )}
                {newsData && newsData.generatedAt && (
                  <div style={styles.newsTimestamp}>
                    Aggiornato: {new Date(newsData.generatedAt).toLocaleString("it-IT")}
                  </div>
                )}
              </div>

              {/* Ban e restrizioni recenti dal feed */}
              {newsData && newsData.bannedRestricted && newsData.bannedRestricted.length > 0 && (
                <div style={styles.newsCard}>
                  <h3 style={styles.newsCardTitle}>Ban &amp; restrizioni recenti</h3>
                  <ul style={styles.newsList}>
                    {newsData.bannedRestricted.map((n, i) => (
                      <li key={i} style={styles.newsItem}>
                        <a href={n.link} target="_blank" rel="noreferrer" style={styles.newsLink}>
                          {n.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Controllo legalità sulla propria collezione */}
              <div style={styles.newsCard}>
                <h3 style={styles.newsCardTitle}>Carte bannate/ristrette nella tua collezione</h3>
                <p style={styles.newsMuted}>Controlla Historic, Pioneer e Commander per tutte le carte che possiedi.</p>
                <button style={styles.saveBtn} onClick={checkLegality} disabled={legalityLoading}>
                  {legalityLoading ? "Controllo in corso…" : "Controlla la mia collezione"}
                </button>
                {legalityResults !== null && !legalityLoading && (
                  <div style={{ marginTop: 14 }}>
                    {legalityResults.length === 0 ? (
                      <p style={styles.newsMuted}>Nessuna carta bannata o ristretta nei formati che segui. ✓</p>
                    ) : (
                      <ul style={styles.newsList}>
                        {legalityResults.map((r, i) => (
                          <li key={i} style={styles.newsItem}>
                            <strong style={{ color: "#E8E2D0" }}>{r.name}</strong>
                            {r.issues.map((iss, j) => (
                              <span key={j} style={styles.legalityBadge}>
                                {iss.format}: {iss.status}
                              </span>
                            ))}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* Movimenti di prezzo nella propria collezione */}
              <div style={styles.newsCard}>
                <h3 style={styles.newsCardTitle}>Carte della tua collezione in movimento</h3>
                {!priceMoves && <p style={styles.newsMuted}>In attesa dei dati…</p>}
                {priceMoves && priceMoves.firstRun && (
                  <p style={styles.newsMuted}>
                    Primo controllo salvato su questo dispositivo — la prossima volta che apri l'app vedrai qui i prezzi che si sono mossi di più.
                  </p>
                )}
                {priceMoves && !priceMoves.firstRun && priceMoves.moves.length === 0 && (
                  <p style={styles.newsMuted}>Nessuna variazione di prezzo rilevata dall'ultima apertura.</p>
                )}
                {priceMoves && priceMoves.moves.length > 0 && (
                  <ul style={styles.newsList}>
                    {priceMoves.moves.map((m, i) => (
                      <li key={i} style={styles.newsItem}>
                        <strong style={{ color: "#E8E2D0" }}>{m.name}</strong>
                        <span style={{ color: m.delta >= 0 ? "#7BAE6F" : "#C4634A", marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5 }}>
                          {fmtEur(m.from)} → {fmtEur(m.to)} ({m.pct >= 0 ? "+" : ""}
                          {m.pct.toFixed(0)}%)
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {selected && (
        <div style={styles.overlay} onClick={() => { setSelected(null); setEditMode(false); }}>
          <div style={styles.detailCard} onClick={(e) => e.stopPropagation()}>
            <button style={styles.closeBtn} onClick={() => { setSelected(null); setEditMode(false); }}>
              ✕
            </button>
            <div style={styles.detailGrid}>
              {!imgFailed.has(selected.id) ? (
                <img
                  src={scryfallImg(selected.name, selected.setCode, "normal")}
                  alt={selected.name}
                  style={styles.detailImg}
                  onError={() => markImgFailed(selected.id)}
                />
              ) : (
                <div style={{ ...styles.detailImgFallback, background: `linear-gradient(160deg, ${folderAccent(selected.folder).c}33, #171F1C)` }}>
                  <span style={styles.detailImgFallbackLetter}>{selected.name.charAt(0)}</span>
                </div>
              )}
              <div style={styles.detailInfo}>
                <div style={{ ...styles.heroKicker, marginBottom: 6 }}>{selected.setName}</div>

                {!editMode ? (
                  <>
                    <h3 style={styles.detailName}>{selected.name}</h3>
                    <div style={styles.detailMeta}>
                      {selected.condition} · {selected.printing} · {selected.language}
                      {selected.qty > 1 ? ` · ×${selected.qty}` : ""}
                    </div>

                    <div style={styles.detailPrices}>
                      <div>
                        <div style={styles.detailPriceLabel}>Pagata</div>
                        <div style={styles.detailPriceValue}>{fmtEur(selected.bought)}</div>
                      </div>
                      <div>
                        <div style={styles.detailPriceLabel}>Low</div>
                        <div style={styles.detailPriceValue}>{fmtEur(selected.low)}</div>
                      </div>
                      <div>
                        <div style={styles.detailPriceLabel}>Mid</div>
                        <div style={styles.detailPriceValue}>{fmtEur(selected.mid)}</div>
                      </div>
                      <div>
                        <div style={styles.detailPriceLabel}>Mercato</div>
                        <div style={{ ...styles.detailPriceValue, color: "#C9A227" }}>{fmtEur(selected.market)}</div>
                      </div>
                    </div>

                    {selected.bought ? (
                      <div
                        style={{
                          ...styles.detailGain,
                          color: selected.market >= selected.bought ? "#7BAE6F" : "#C4634A",
                        }}
                      >
                        <span>{selected.market >= selected.bought ? "↑" : "↓"}</span>
                        {(((selected.market - selected.bought) / selected.bought) * 100).toFixed(0)}% dall'acquisto
                        {selected.dateBought ? ` (${selected.dateBought})` : ""}
                      </div>
                    ) : null}

                    <div style={styles.detailActions}>
                      <button
                        style={{
                          ...styles.detailBtn,
                          ...(marked.has(selected.id) ? styles.detailBtnActive : {}),
                        }}
                        onClick={() => toggleMarked(selected.id)}
                      >
                        {marked.has(selected.id) ? "★ Segnata da vendere" : "☆ Segna da vendere"}
                      </button>
                      <button
                        style={styles.detailBtn}
                        onClick={() => {
                          setEditDraft({ ...selected });
                          setEditMode(true);
                        }}
                      >
                        ✎ Modifica dati
                      </button>
                      <a
                        href={`https://www.cardmarket.com/it/Magic/Products/Search?searchString=${encodeURIComponent(
                          selected.name
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        style={styles.detailLink}
                      >
                        Cerca su Cardmarket →
                      </a>
                      <button style={styles.deleteLink} onClick={() => deleteRow(selected.id)}>
                        Elimina carta
                      </button>
                    </div>
                  </>
                ) : (
                  <EditForm
                    draft={editDraft}
                    setDraft={setEditDraft}
                    onCancel={() => setEditMode(false)}
                    onSave={() => {
                      updateRow(selected.id, {
                        ...editDraft,
                        qty: toNum(editDraft.qty) ?? 1,
                        bought: toNum(editDraft.bought),
                        low: toNum(editDraft.low),
                        mid: toNum(editDraft.mid),
                        market: toNum(editDraft.market),
                      });
                      setEditMode(false);
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddForm && (
        <div style={styles.overlay} onClick={() => setShowAddForm(false)}>
          <div style={styles.detailCard} onClick={(e) => e.stopPropagation()}>
            <button style={styles.closeBtn} onClick={() => setShowAddForm(false)}>
              ✕
            </button>
            <h3 style={{ ...styles.detailName, marginBottom: 16 }}>Aggiungi carta</h3>
            <AddCardForm onAdd={addRow} folders={folders.filter((f) => f !== "Tutte")} />
          </div>
        </div>
      )}
    </div>
  );
}

function field(label, value, onChange, opts = {}) {
  return (
    <label style={styles.fieldLabel}>
      {label}
      <input
        style={styles.fieldInput}
        type={opts.type || "text"}
        step={opts.step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={opts.placeholder}
      />
    </label>
  );
}

function EditForm({ draft, setDraft, onCancel, onSave }) {
  if (!draft) return null;
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <div>
      <div style={styles.formGrid}>
        {field("Nome carta", draft.name, set("name"))}
        {field("Espansione", draft.setName, set("setName"))}
        {field("Codice set", draft.setCode, set("setCode"))}
        {field("Numero", draft.number, set("number"))}
        {field("Cartella", draft.folder, set("folder"))}
        {field("Condizione", draft.condition, set("condition"))}
        {field("Stampa", draft.printing, set("printing"))}
        {field("Lingua", draft.language, set("language"))}
        {field("Quantità", draft.qty, set("qty"), { type: "number" })}
        {field("Pagata (€)", draft.bought, set("bought"), { type: "number", step: "0.01" })}
        {field("Low (€)", draft.low, set("low"), { type: "number", step: "0.01" })}
        {field("Mid (€)", draft.mid, set("mid"), { type: "number", step: "0.01" })}
        {field("Market (€)", draft.market, set("market"), { type: "number", step: "0.01" })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button style={styles.saveBtn} onClick={onSave}>
          Salva modifiche
        </button>
        <button style={styles.detailBtn} onClick={onCancel}>
          Annulla
        </button>
      </div>
    </div>
  );
}

function AddCardForm({ onAdd, folders }) {
  const [draft, setDraft] = useState({
    name: "",
    setName: "",
    setCode: "",
    number: "",
    folder: folders[0] || "",
    condition: "Mint",
    printing: "Normal",
    language: "Italian",
    qty: 1,
    bought: "",
    market: "",
  });
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  const canSave = draft.name.trim().length > 0;
  return (
    <div>
      <div style={styles.formGrid}>
        {field("Nome carta *", draft.name, set("name"), { placeholder: "es. Sol Ring" })}
        {field("Espansione", draft.setName, set("setName"))}
        {field("Codice set", draft.setCode, set("setCode"), { placeholder: "es. CMM" })}
        {field("Numero", draft.number, set("number"))}
        {field("Cartella", draft.folder, set("folder"))}
        {field("Condizione", draft.condition, set("condition"))}
        {field("Stampa", draft.printing, set("printing"))}
        {field("Lingua", draft.language, set("language"))}
        {field("Quantità", draft.qty, set("qty"), { type: "number" })}
        {field("Pagata (€)", draft.bought, set("bought"), { type: "number", step: "0.01" })}
        {field("Market (€)", draft.market, set("market"), { type: "number", step: "0.01" })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button
          style={{ ...styles.saveBtn, opacity: canSave ? 1 : 0.4, cursor: canSave ? "pointer" : "not-allowed" }}
          onClick={() => canSave && onAdd(draft)}
          disabled={!canSave}
        >
          Aggiungi alla collezione
        </button>
      </div>
    </div>
  );
}

const styles = {
  app: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    background: "#12181A",
    minHeight: "100%",
    color: "#E8E2D0",
    padding: "28px 22px 60px",
    backgroundImage:
      "radial-gradient(ellipse 900px 500px at 50% -10%, rgba(201,162,39,0.08), transparent)",
  },
  hero: {
    maxWidth: 980,
    margin: "0 auto 28px",
    paddingBottom: 22,
    borderBottom: "1px solid #232D2A",
  },
  heroTop: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  heroMark: {
    width: 26,
    height: 26,
    borderRadius: "50%",
    border: "1px solid #3A4540",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  heroKicker: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.06em",
    color: "#8B9490",
  },
  heroTitle: {
    fontFamily: "'Fraunces', serif",
    fontOpticalSizing: "auto",
    fontWeight: 600,
    fontSize: "clamp(34px, 5vw, 52px)",
    margin: "2px 0 10px",
    color: "#F1ECDD",
    letterSpacing: "-0.01em",
  },
  heroSub: { color: "#8B9490", fontSize: 15, maxWidth: 480, lineHeight: 1.5 },
  heroStats: { display: "flex", alignItems: "center", gap: 26, marginTop: 18, flexWrap: "wrap" },
  heroStat: { minWidth: 140 },
  heroStatValue: { fontFamily: "'Fraunces', serif", fontSize: 30, fontWeight: 600, color: "#F1ECDD" },
  heroStatLabel: { fontSize: 12.5, color: "#6B7570", marginTop: 3 },
  heroDivider: { width: 1, height: 38, background: "#232D2A" },

  dropzone: {
    maxWidth: 520,
    margin: "40px auto",
    border: "1.5px dashed #2A342F",
    borderRadius: 10,
    padding: "44px 28px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    transition: "border-color 0.15s, background 0.15s",
  },
  dropzoneActive: { borderColor: "#C9A227", background: "rgba(201,162,39,0.05)" },
  dropzoneText: { fontFamily: "'Fraunces', serif", fontSize: 18, color: "#E8E2D0", marginTop: 4 },
  dropzoneSub: { fontSize: 12, color: "#6B7570" },
  uploadBtn: {
    marginTop: 4,
    padding: "9px 20px",
    borderRadius: 6,
    border: "1px solid #C9A227",
    color: "#C9A227",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    letterSpacing: "0.02em",
  },
  errorText: { color: "#C4634A", fontSize: 13, marginTop: 8 },

  sectionTitle: {
    fontFamily: "'Fraunces', serif",
    fontSize: 15,
    fontWeight: 500,
    color: "#8B9490",
    margin: "0 0 12px",
    maxWidth: 980,
    marginLeft: "auto",
    marginRight: "auto",
  },
  moversSection: { maxWidth: 980, margin: "0 auto 30px" },
  moversList: { display: "flex", flexDirection: "column", gap: 3 },
  moverRow: {
    display: "grid",
    gridTemplateColumns: "20px 30px 1.6fr 2fr 84px 60px",
    alignItems: "center",
    gap: 12,
    padding: "8px 4px",
    cursor: "pointer",
  },
  moverRank: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#4A5450", textAlign: "right" },
  moverInfo: { minWidth: 0 },
  moverName: {
    fontFamily: "'Fraunces', serif",
    fontSize: 14.5,
    color: "#E8E2D0",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  moverSet: { fontSize: 11.5, color: "#6B7570" },
  moverBarTrack: { height: 6, background: "#1E2724", borderRadius: 3, overflow: "hidden" },
  moverBarFill: { height: "100%", borderRadius: 3 },
  moverValue: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, textAlign: "right", color: "#E8E2D0" },
  moverGain: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: "right" },

  controls: {
    maxWidth: 980,
    margin: "0 auto 14px",
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  },
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #232D2A",
    borderRadius: 7,
    padding: "8px 12px",
    minWidth: 240,
    background: "#161E1B",
  },
  searchInput: {
    background: "transparent",
    border: "none",
    outline: "none",
    color: "#E8E2D0",
    fontSize: 13.5,
    fontFamily: "'IBM Plex Sans', sans-serif",
    width: "100%",
  },
  folderPills: { display: "flex", gap: 6, flexWrap: "wrap" },
  pill: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 20,
    border: "1px solid",
    fontSize: 12.5,
    cursor: "pointer",
    background: "transparent",
  },
  pillDot: { width: 6, height: 6, borderRadius: "50%" },
  resultCount: { fontSize: 12, color: "#6B7570", marginLeft: "auto", fontFamily: "'IBM Plex Mono', monospace" },

  tableWrap: { maxWidth: 980, margin: "0 auto" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    fontSize: 11,
    fontFamily: "'IBM Plex Mono', monospace",
    letterSpacing: "0.03em",
    color: "#6B7570",
    fontWeight: 500,
    padding: "10px 10px",
    borderBottom: "1px solid #232D2A",
  },
  tr: { borderBottom: "1px solid #1B2422" },
  td: { padding: "9px 10px", fontSize: 13.5, color: "#C9C3AF" },
  tdNum: {
    padding: "9px 10px",
    fontSize: 13,
    fontFamily: "'IBM Plex Mono', monospace",
    textAlign: "right",
  },
  qtyBadge: {
    marginLeft: 8,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10.5,
    color: "#6B7570",
  },
  foilBadge: {
    marginLeft: 8,
    fontSize: 9.5,
    fontFamily: "'IBM Plex Mono', monospace",
    color: "#C9A227",
    border: "1px solid #C9A22766",
    borderRadius: 4,
    padding: "1px 5px",
    letterSpacing: "0.03em",
  },
  moreNote: { textAlign: "center", color: "#4A5450", fontSize: 12, padding: "16px 0 4px" },

  moverThumb: { width: 30, height: 42, objectFit: "cover", borderRadius: 4, border: "1px solid #232D2A" },
  moverThumbFallback: { width: 30, height: 42, borderRadius: 4, background: "#1B2422", border: "1px solid #232D2A" },
  rowThumb: { width: 26, height: 36, objectFit: "cover", borderRadius: 3, border: "1px solid #232D2A", display: "block" },
  rowThumbFallback: { width: 26, height: 36, borderRadius: 3, background: "#1B2422", border: "1px solid #232D2A" },
  detailImgFallbackLetter: {
    fontFamily: "'Fraunces', serif",
    fontSize: 44,
    color: "#F1ECDD44",
  },

  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(8,12,11,0.72)",
    backdropFilter: "blur(3px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 50,
  },
  detailCard: {
    position: "relative",
    background: "#171F1C",
    border: "1px solid #2A342F",
    borderRadius: 12,
    padding: 26,
    maxWidth: 560,
    width: "100%",
    maxHeight: "86vh",
    overflowY: "auto",
  },
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    background: "transparent",
    border: "none",
    color: "#6B7570",
    fontSize: 16,
    cursor: "pointer",
  },
  detailGrid: { display: "flex", gap: 20, flexWrap: "wrap" },
  detailImg: { width: 180, borderRadius: 10, border: "1px solid #2A342F", flexShrink: 0 },
  detailImgFallback: {
    width: 180,
    height: 250,
    borderRadius: 10,
    border: "1px solid #2A342F",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#4A5450",
    fontSize: 12,
    textAlign: "center",
    padding: 10,
  },
  detailInfo: { flex: 1, minWidth: 220 },
  detailName: { fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, color: "#F1ECDD", margin: "0 0 6px" },
  detailMeta: { fontSize: 12.5, color: "#8B9490", marginBottom: 16 },
  detailPrices: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 },
  detailPriceLabel: { fontSize: 10.5, color: "#6B7570", fontFamily: "'IBM Plex Mono', monospace" },
  detailPriceValue: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 14.5, color: "#E8E2D0", marginTop: 2 },
  detailGain: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 18 },
  detailActions: { display: "flex", flexDirection: "column", gap: 10 },
  detailBtn: {
    padding: "10px 16px",
    borderRadius: 7,
    border: "1px solid #2A342F",
    background: "transparent",
    color: "#C9C3AF",
    fontSize: 13,
    cursor: "pointer",
    textAlign: "left",
  },
  detailBtnActive: { borderColor: "#C9A227", color: "#C9A227", background: "rgba(201,162,39,0.08)" },
  detailLink: { fontSize: 12.5, color: "#8B9490", textDecoration: "none" },
  deleteLink: {
    fontSize: 12.5,
    color: "#8A5A4F",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    padding: 0,
    marginTop: 2,
  },
  addBtn: {
    padding: "7px 14px",
    borderRadius: 20,
    border: "1px solid #C9A227",
    color: "#C9A227",
    background: "transparent",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
  },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  fieldLabel: { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#8B9490" },
  fieldInput: {
    background: "#12181A",
    border: "1px solid #2A342F",
    borderRadius: 6,
    padding: "7px 9px",
    color: "#E8E2D0",
    fontSize: 13,
    fontFamily: "'IBM Plex Sans', sans-serif",
    outline: "none",
  },
  saveBtn: {
    padding: "9px 18px",
    borderRadius: 7,
    border: "1px solid #C9A227",
    background: "rgba(201,162,39,0.12)",
    color: "#C9A227",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },

  tabBar: { maxWidth: 980, margin: "0 auto 20px", display: "flex", gap: 6 },
  tabBtn: {
    padding: "8px 18px",
    borderRadius: 20,
    border: "1px solid #232D2A",
    background: "transparent",
    color: "#8B9490",
    fontSize: 13,
    fontFamily: "'Fraunces', serif",
    cursor: "pointer",
  },
  tabBtnActive: { borderColor: "#C9A227", color: "#C9A227", background: "rgba(201,162,39,0.08)" },

  newsWrap: { maxWidth: 700, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 },
  newsCard: { border: "1px solid #232D2A", borderRadius: 10, padding: "18px 20px", background: "#161E1B" },
  newsCardTitle: { fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: "#F1ECDD", margin: "0 0 10px" },
  newsMuted: { fontSize: 13, color: "#8B9490", lineHeight: 1.5, margin: 0 },
  newsList: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 },
  newsItem: { fontSize: 13.5, borderBottom: "1px solid #1F2A26", paddingBottom: 10 },
  newsLink: { color: "#D8CFA8", textDecoration: "none" },
  newsSummary: { color: "#6B7570", fontSize: 12, marginTop: 3 },
  newsTimestamp: { fontSize: 11, color: "#4A5450", marginTop: 12, fontFamily: "'IBM Plex Mono', monospace" },
  legalityBadge: {
    marginLeft: 8,
    fontSize: 11,
    fontFamily: "'IBM Plex Mono', monospace",
    color: "#C4634A",
    border: "1px solid #C4634A66",
    borderRadius: 4,
    padding: "1px 6px",
  },
};


const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<Grimorio />);
