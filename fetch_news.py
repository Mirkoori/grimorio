"""
fetch_news.py — genera news.json per Grimorio.

Gira dentro una GitHub Action a cadenza giornaliera. Legge l'RSS pubblico
di MTGGoldfish, separa gli articoli di Banned & Restricted dal resto, e
scrive un file statico che l'app legge come same-origin (nessuna
chiamata dal telefono a domini esterni, quindi nessun problema di CORS).

Uso: python fetch_news.py  -> scrive ./news.json
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from xml.etree import ElementTree

FEED_URL = "https://www.mtggoldfish.com/feed"
OUTPUT_PATH = "news.json"
MAX_GENERAL = 12
MAX_BANNED = 6

BAN_KEYWORDS = ("banned", "restricted", "suspended", "unbanned")


def fetch_feed(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Grimorio-NewsBot/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read()


def strip_html(text):
    return re.sub(r"<[^>]+>", "", text or "").strip()


def parse_rss(xml_bytes):
    root = ElementTree.fromstring(xml_bytes)
    items = []
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()
        description = strip_html(item.findtext("description") or "")[:220]
        if title and link:
            items.append({
                "title": title,
                "link": link,
                "pubDate": pub_date,
                "summary": description,
            })
    return items


def build_news():
    try:
        xml_bytes = fetch_feed(FEED_URL)
        items = parse_rss(xml_bytes)
    except Exception as exc:  # network hiccups, feed format changes, etc.
        # Non far fallire l'intera Action: scriviamo comunque un file valido
        # con un errore leggibile, così l'app mostra un messaggio sensato
        # invece di rompersi.
        return {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "error": f"{type(exc).__name__}: {exc}",
            "general": [],
            "bannedRestricted": [],
        }

    banned = [it for it in items if any(k in it["title"].lower() for k in BAN_KEYWORDS)]
    general = [it for it in items if it not in banned]

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": FEED_URL,
        "general": general[:MAX_GENERAL],
        "bannedRestricted": banned[:MAX_BANNED],
    }


if __name__ == "__main__":
    news = build_news()
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(news, f, ensure_ascii=False, indent=2)
    print(f"Scritto {OUTPUT_PATH}: {len(news.get('general', []))} generali, "
          f"{len(news.get('bannedRestricted', []))} ban/restrizioni")
    if news.get("error"):
        print(f"Attenzione — feed non raggiungibile: {news['error']}", file=sys.stderr)
