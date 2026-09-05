
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
