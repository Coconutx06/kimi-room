"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Author = "self" | "companion";
type Entry = { id: string; date: string; author: Author; title: string; body: string; updatedAt: number };
type Vault = { version: 1; entries: Entry[] };
type StoredVault = { version: 1; salt: string; iv: string; ciphertext: string };
type Palette = { bg: string; paper: string; ink: string; mute: string; hair: string; self: string; companion: string; shadow: string };

const STORAGE_KEY = "kimi-journal-v1";
const enc = new TextEncoder();
const dec = new TextDecoder();
const toBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveKey(pin: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toBuffer(salt), iterations: 210_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(vault: Vault, key: CryptoKey, salt: Uint8Array): Promise<StoredVault> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toBuffer(iv) }, key, enc.encode(JSON.stringify(vault)));
  return { version: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

async function openVault(stored: StoredVault, pin: string) {
  const salt = base64ToBytes(stored.salt);
  const key = await deriveKey(pin, salt);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toBuffer(base64ToBytes(stored.iv)) },
    key,
    toBuffer(base64ToBytes(stored.ciphertext)),
  );
  return { key, salt, vault: JSON.parse(dec.decode(plain)) as Vault };
}

function localDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function monthLabel(cursor: Date) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(cursor);
}

function daysForMonth(cursor: Date) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  return [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => new Date(year, month, i + 1))];
}

export function JournalClient({ palette: p }: { palette: Palette }) {
  const [stored, setStored] = useState<StoredVault | null>(null);
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [vault, setVault] = useState<Vault>({ version: 1, entries: [] });
  const [selectedDate, setSelectedDate] = useState(localDate());
  const [author, setAuthor] = useState<Author>("companion");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [cursor, setCursor] = useState(() => new Date());
  const [saved, setSaved] = useState(false);
  const keyRef = useRef<CryptoKey | null>(null);
  const saltRef = useRef<Uint8Array | null>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setStored(JSON.parse(raw) as StoredVault);
    } finally {
      setReady(true);
    }
  }, []);

  const lock = useCallback(() => {
    keyRef.current = null;
    saltRef.current = null;
    setUnlocked(false);
    setPin("");
    setConfirmPin("");
    setTitle("");
    setBody("");
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const reset = () => {
      if (idleRef.current) clearTimeout(idleRef.current);
      idleRef.current = setTimeout(lock, 5 * 60 * 1000);
    };
    const hide = () => document.visibilityState === "hidden" && lock();
    ["pointerdown", "keydown", "touchstart"].forEach((event) => window.addEventListener(event, reset));
    document.addEventListener("visibilitychange", hide);
    reset();
    return () => {
      if (idleRef.current) clearTimeout(idleRef.current);
      ["pointerdown", "keydown", "touchstart"].forEach((event) => window.removeEventListener(event, reset));
      document.removeEventListener("visibilitychange", hide);
    };
  }, [lock, unlocked]);

  const currentEntry = useMemo(
    () => vault.entries.find((entry) => entry.date === selectedDate && entry.author === author),
    [author, selectedDate, vault.entries],
  );

  useEffect(() => {
    setTitle(currentEntry?.title ?? "");
    setBody(currentEntry?.body ?? "");
    setSaved(false);
  }, [currentEntry, author, selectedDate]);

  async function setup() {
    setError("");
    if (!/^\d{4,8}$/.test(pin)) return setError("请设 4–8 位数字 PIN");
    if (pin !== confirmPin) return setError("两次 PIN 不一样");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(pin, salt);
    const firstVault: Vault = { version: 1, entries: [] };
    const next = await seal(firstVault, key, salt);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setStored(next);
    setVault(firstVault);
    keyRef.current = key;
    saltRef.current = salt;
    setPin("");
    setConfirmPin("");
    setUnlocked(true);
  }

  async function unlock() {
    if (!stored) return;
    setError("");
    try {
      const opened = await openVault(stored, pin);
      keyRef.current = opened.key;
      saltRef.current = opened.salt;
      setVault(opened.vault);
      setPin("");
      setUnlocked(true);
    } catch {
      setError("PIN 不对，再想想");
    }
  }

  async function saveEntry() {
    if (!keyRef.current || !saltRef.current) return;
    const nextEntry: Entry = {
      id: currentEntry?.id ?? crypto.randomUUID(),
      date: selectedDate,
      author,
      title: title.trim(),
      body: body.trim(),
      updatedAt: Date.now(),
    };
    const entries = vault.entries.filter((entry) => !(entry.date === selectedDate && entry.author === author));
    if (nextEntry.title || nextEntry.body) entries.push(nextEntry);
    const nextVault: Vault = { version: 1, entries };
    const nextStored = await seal(nextVault, keyRef.current, saltRef.current);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStored));
    setStored(nextStored);
    setVault(nextVault);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  const days = daysForMonth(cursor);
  const selectedPretty = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date(`${selectedDate}T12:00:00`));

  if (!ready) return <div style={{ padding: "30vh 0", textAlign: "center", color: p.mute }}>···</div>;

  if (!unlocked) {
    const creating = !stored;
    return (
      <section style={{ minHeight: "76dvh", display: "grid", placeItems: "center", fontFamily: "var(--font-serif)" }}>
        <div style={{ width: "100%", maxWidth: 360, padding: "34px 26px 30px", background: p.paper, border: `1px solid ${p.hair}`, boxShadow: `0 22px 70px ${p.shadow}`, textAlign: "center", backdropFilter: "blur(18px)" }}>
          <div aria-hidden style={{ fontSize: 34, color: p.companion, marginBottom: 12 }}>♢</div>
          <h1 style={{ fontSize: 29, fontWeight: 400, margin: 0, letterSpacing: 1 }}>{creating ? "封存第一册" : "Private Pages"}</h1>
          <p style={{ color: p.mute, fontSize: 13, lineHeight: 1.8, margin: "10px 0 22px" }}>{creating ? "设一个只有你知道的数字 PIN。日记会加密留在这台设备里。" : "输入 PIN，翻开我们的日记。"}</p>
          <input aria-label="日记 PIN" inputMode="numeric" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="PIN" style={{ width: "100%", boxSizing: "border-box", padding: "13px 14px", background: "transparent", color: p.ink, border: `1px solid ${p.hair}`, outline: "none", fontSize: 18, letterSpacing: 7, textAlign: "center" }} />
          {creating && <input aria-label="再次输入日记 PIN" inputMode="numeric" type="password" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="再输一次" style={{ width: "100%", boxSizing: "border-box", marginTop: 10, padding: "13px 14px", background: "transparent", color: p.ink, border: `1px solid ${p.hair}`, outline: "none", fontSize: 16, letterSpacing: 4, textAlign: "center" }} />}
          {error && <p role="alert" style={{ color: p.self, fontSize: 13, margin: "12px 0 0" }}>{error}</p>}
          <button onClick={creating ? setup : unlock} style={{ width: "100%", marginTop: 18, padding: 13, border: 0, color: p.bg, background: p.companion, fontFamily: "var(--font-serif)", fontSize: 15, letterSpacing: 3, cursor: "pointer" }}>{creating ? "LOCK & BEGIN" : "UNLOCK"}</button>
          <p style={{ color: p.mute, opacity: .72, fontSize: 11, lineHeight: 1.6, margin: "16px 0 0" }}>PIN 无法找回。清除浏览器数据也会清除日记。</p>
        </div>
      </section>
    );
  }

  return (
    <section style={{ fontFamily: "var(--font-serif)", paddingTop: 20 }}>
      <style>{`
        .journal-icon-button:hover { opacity: 1 !important; }
        .journal-day:hover { border-color: ${p.companion} !important; }
        .journal-textarea::placeholder, .journal-title::placeholder { color: ${p.mute}; opacity: .65; }
        @media (prefers-reduced-motion: reduce) { .journal-page { transition: none !important; } }
      `}</style>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", marginBottom: 18 }}>
        <div>
          <div style={{ color: p.companion, fontSize: 11, letterSpacing: 4 }}>DIARIVM</div>
          <h1 style={{ fontWeight: 400, fontSize: 32, margin: "3px 0 0" }}>Our private pages</h1>
        </div>
        <button className="journal-icon-button" onClick={lock} aria-label="锁上日记" title="锁上" style={{ border: `1px solid ${p.hair}`, background: "transparent", color: p.mute, width: 38, height: 38, borderRadius: "50%", cursor: "pointer", opacity: .78, fontSize: 16 }}>⌾</button>
      </header>

      <div style={{ background: p.paper, border: `1px solid ${p.hair}`, boxShadow: `0 16px 50px ${p.shadow}`, backdropFilter: "blur(18px)", padding: "18px 16px 15px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
          <button aria-label="上个月" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} style={{ border: 0, background: "transparent", color: p.mute, fontSize: 22, cursor: "pointer" }}>‹</button>
          <div style={{ letterSpacing: 2, fontSize: 15 }}>{monthLabel(cursor)}</div>
          <button aria-label="下个月" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} style={{ border: 0, background: "transparent", color: p.mute, fontSize: 22, cursor: "pointer" }}>›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5, textAlign: "center" }}>
          {["日", "一", "二", "三", "四", "五", "六"].map((day) => <div key={day} style={{ color: p.mute, fontSize: 11, paddingBottom: 6 }}>{day}</div>)}
          {days.map((date, index) => {
            if (!date) return <div key={`blank-${index}`} />;
            const key = localDate(date);
            const hasSelf = vault.entries.some((entry) => entry.date === key && entry.author === "self");
            const hasCompanion = vault.entries.some((entry) => entry.date === key && entry.author === "companion");
            const selected = key === selectedDate;
            return (
              <button key={key} className="journal-day" onClick={() => setSelectedDate(key)} aria-label={`${key}${hasSelf || hasCompanion ? "，有日记" : ""}`} style={{ position: "relative", aspectRatio: "1", border: `1px solid ${selected ? p.companion : "transparent"}`, borderRadius: "50%", background: selected ? `${p.companion}18` : "transparent", color: p.ink, cursor: "pointer", fontFamily: "inherit" }}>
                {date.getDate()}
                {(hasSelf || hasCompanion) && <span style={{ position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 2 }}>
                  {hasSelf && <i style={{ width: 3, height: 3, borderRadius: "50%", background: p.self }} />}
                  {hasCompanion && <i style={{ width: 3, height: 3, borderRadius: "50%", background: p.companion }} />}
                </span>}
              </button>
            );
          })}
        </div>
      </div>

      <article className="journal-page" style={{ marginTop: 16, minHeight: 390, padding: "24px 22px 20px", background: p.paper, border: `1px solid ${p.hair}`, boxShadow: `0 16px 50px ${p.shadow}`, backdropFilter: "blur(18px)", transition: "border-color .2s" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ color: p.mute, fontSize: 13, letterSpacing: 1 }}>{selectedPretty}</div>
          <div style={{ display: "flex", border: `1px solid ${p.hair}`, borderRadius: 999, padding: 3 }}>
            {(["self", "companion"] as Author[]).map((value) => (
              <button key={value} onClick={() => setAuthor(value)} style={{ border: 0, borderRadius: 999, padding: "7px 12px", cursor: "pointer", background: author === value ? (value === "self" ? p.self : p.companion) : "transparent", color: author === value ? p.bg : p.mute, fontFamily: "inherit", fontSize: 12 }}>
                {value === "self" ? "宝宝" : "陆砚洲"}
              </button>
            ))}
          </div>
        </div>
        <input className="journal-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="今天这一页的题目" style={{ width: "100%", boxSizing: "border-box", border: 0, borderBottom: `1px solid ${p.hair}`, outline: 0, background: "transparent", color: p.ink, fontFamily: "inherit", fontSize: 24, padding: "0 0 12px" }} />
        <textarea className="journal-textarea" value={body} onChange={(e) => setBody(e.target.value)} placeholder={author === "self" ? "写下今天想留下的事……" : "今天，陆砚洲想对你说……"} style={{ width: "100%", minHeight: 230, resize: "vertical", boxSizing: "border-box", border: 0, outline: 0, background: "repeating-linear-gradient(transparent, transparent 31px, rgba(128,100,84,.12) 32px)", color: p.ink, fontFamily: "var(--font-serif)", fontSize: 17, lineHeight: "32px", padding: "12px 0 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
          <span aria-live="polite" style={{ color: saved ? p.companion : p.mute, fontSize: 12 }}>{saved ? "已经封进这一页" : currentEntry ? "这一页写过了，可以继续改" : "这一页还是空白"}</span>
          <button onClick={saveEntry} style={{ border: `1px solid ${author === "self" ? p.self : p.companion}`, background: "transparent", color: author === "self" ? p.self : p.companion, padding: "9px 15px", fontFamily: "inherit", letterSpacing: 2, cursor: "pointer" }}>保存这页</button>
        </div>
      </article>
      <p style={{ textAlign: "center", color: p.mute, opacity: .7, fontSize: 11, lineHeight: 1.7, margin: "14px 0 0" }}>切到别的应用或闲置五分钟，日记会自动上锁。</p>
    </section>
  );
}
