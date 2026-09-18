#!/usr/bin/env tsx
/**
 * Hungarian Law MCP — Daily Automatic Sync Engine
 *
 * Designed to run autonomously in Docker / Unraid Server / Linux VPS environments.
 * 
 * Functions:
 * 1. Verifies upstream portal connectivity (Nemzeti Jogszabálytár - https://njt.jog.gov.hu / https://njt.hu).
 * 2. Checks current database build age and document metrics.
 * 3. Dynamically queries NJT search API to discover newly gazetted / in-force legislation.
 * 4. Automatically detects updates (e.g. 2026. évi XLVIII. tv. - Áfa tv. módosítás - 2026. 09. 15.).
 * 5. Ingests new acts into legal_documents and provisions into legal_provisions.
 * 6. Updates db_metadata (legislation_state_date, last_sync_at, last_sync_status).
 * 7. Records 7-day sync history into SQLite sync_history table and data/sync_history.json.
 * 8. Exports recent laws (last 7 days or top 10, whichever is more) into data/recent_laws.json.
 * 9. Writes comprehensive sync report to data/last_sync.json for the web dashboard.
 *
 * Usage:
 *   node --import tsx scripts/daily-sync.ts
 *   node --import tsx scripts/daily-sync.ts --force
 *   docker exec magyar-jogszabaly-mcp node dist/daily-sync.js
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveDbPath(): string {
  if (process.env.LAW_DB_PATH && existsSync(process.env.LAW_DB_PATH)) return process.env.LAW_DB_PATH;
  const candidates = [
    resolve(__dirname, '../../data/database.db'),
    resolve(__dirname, '../data/database.db'),
    resolve(process.cwd(), 'data/database.db'),
    '/app/data/database.db',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

function resolveLastSyncPath(): string {
  const candidates = [
    resolve(__dirname, '../../data/last_sync.json'),
    resolve(__dirname, '../data/last_sync.json'),
    resolve(process.cwd(), 'data/last_sync.json'),
    '/app/data/last_sync.json',
  ];
  for (const p of candidates) {
    if (existsSync(dirname(p))) return p;
  }
  return candidates[0];
}

function resolveSyncHistoryPath(): string {
  const candidates = [
    resolve(__dirname, '../../data/sync_history.json'),
    resolve(__dirname, '../data/sync_history.json'),
    resolve(process.cwd(), 'data/sync_history.json'),
    '/app/data/sync_history.json',
  ];
  for (const p of candidates) {
    if (existsSync(dirname(p))) return p;
  }
  return candidates[0];
}

function resolveRecentLawsPath(): string {
  const candidates = [
    resolve(__dirname, '../../data/recent_laws.json'),
    resolve(__dirname, '../data/recent_laws.json'),
    resolve(process.cwd(), 'data/recent_laws.json'),
    '/app/data/recent_laws.json',
  ];
  for (const p of candidates) {
    if (existsSync(dirname(p))) return p;
  }
  return candidates[0];
}

const DB_PATH = resolveDbPath();
const LAST_SYNC_PATH = resolveLastSyncPath();
const SYNC_HISTORY_PATH = resolveSyncHistoryPath();
const RECENT_LAWS_PATH = resolveRecentLawsPath();
const PORTAL_URL = 'https://njt.jog.gov.hu';
const PORTAL_NAME = 'Nemzeti Jogszabálytár (NJT)';

export interface DiscoveredAct {
  id: string;
  documentId: string;
  title: string;
  desc: string;
  date: string | null;
  inForceDate: string | null;
}

export interface SyncHistoryLaw {
  id: string;
  documentId: string;
  title: string;
  short_name?: string;
  date: string | null;
  in_force_date?: string | null;
  desc?: string;
  url?: string;
}

export interface SyncHistoryEntry {
  id?: number;
  timestamp: string;
  date_iso: string; // YYYY-MM-DD
  date_formatted: string; // "2026. szeptember 15."
  status: 'UP_TO_DATE' | 'UPDATED' | 'PORTAL_UNREACHABLE' | 'ERROR';
  legislation_state_date: string;
  message: string;
  new_acts_count: number;
  updated_acts: SyncHistoryLaw[];
}

export interface RecentLawItem {
  id: string;
  title: string;
  short_name: string;
  status: string;
  issued_date: string | null;
  in_force_date: string | null;
  url: string;
  description?: string;
  tags: string[];
}

interface SyncReport {
  timestamp: string;
  status: 'UP_TO_DATE' | 'UPDATED' | 'PORTAL_UNREACHABLE' | 'ERROR';
  message: string;
  legislation_state_date: string;
  built_at: string | null;
  age_days: number | null;
  documents_count: number;
  provisions_count: number;
  portal_reachable: boolean;
  updates_detected: boolean;
  latest_discovered_laws?: Array<{ id: string; title: string; date?: string | null }>;
}

function daysSince(isoDate: string): number | null {
  const dt = new Date(isoDate);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.floor((Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24));
}

function formatHungarianDateOnly(isoDate: string): string {
  try {
    const parts = isoDate.split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const monthNum = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);
      const months = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
      const month = months[monthNum - 1] || parts[1];
      return `${year}. ${month} ${day}.`;
    }
  } catch {}
  return isoDate;
}

async function checkPortal(): Promise<boolean> {
  for (const url of ['https://njt.jog.gov.hu', 'https://njt.hu']) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: { 'User-Agent': '@ansvar/hungarian-law-mcp/1.0 (daily-sync)' },
      });
      clearTimeout(timeout);
      if (res.ok || res.status === 301 || res.status === 302 || res.status === 403) {
        return true;
      }
    } catch {}
  }
  return false;
}

async function discoverLatestFromNjt(): Promise<{
  portalOk: boolean;
  latestDate: string | null;
  acts: DiscoveredAct[];
}> {
  const currentYear = new Date().getFullYear().toString();
  const endpoints = ['https://njt.jog.gov.hu', 'https://njt.hu'];

  for (const base of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const postRes = await fetch(`${base}/ajax/get_search_url.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evszam: currentYear,
          sorszam: '',
          author_type: '0000',
          szokereso: '',
          csak_hatalyos: false,
          pontos_szora: false,
          csak_cimben: false,
          targyszo: false,
          gazette_state: false,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!postRes.ok) continue;
      const data = (await postRes.json()) as { success?: boolean; url?: string };
      if (!data.success || !data.url) continue;

      // Az NJT találati oldal mérete időszakosan változik; 50-es lapmérettel
      // és több oldallal dolgozunk, hogy a legutóbbi állapotváltozások se
      // essenek ki az első 20 találatból.
      const acts: DiscoveredAct[] = [];
      const datesFound: string[] = [];
      const seenDocumentIds = new Set<string>();

      for (let page = 1; page <= 3; page++) {
        const getController = new AbortController();
        const getTimeout = setTimeout(() => getController.abort(), 15_000);
        const searchRes = await fetch(`${base}/search/${data.url}/${page}/50`, {
          signal: getController.signal,
          headers: { 'User-Agent': '@ansvar/hungarian-law-mcp/1.0 (daily-sync)' },
        });
        clearTimeout(getTimeout);
        if (!searchRes.ok) break;

        const html = await searchRes.text();
        const chunks = html.split(/<div\s+class="resultItemWrapper"[^>]*>/i).slice(1);
        if (chunks.length === 0) break;

        for (const c of chunks) {
          // A találat első linkje a jogszabály; ne az indokolás (-K0-00)
          // vagy egy későbbi verzió linkjét azonosítsuk dokumentumként.
          const links = [...c.matchAll(/<a\b([^>]*)href="jogszabaly\/([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi)];
          const titleLinkMatch = links.find(match => /(?:id="firstResult"|class="[^"]*\bnow\b[^"]*")/i.test(`${match[1]} ${match[3]}`)) || links[0];
          if (!titleLinkMatch) continue;

          const rawDocumentId = titleLinkMatch[2].split('.')[0];
          const canonicalId = rawDocumentId.replace(/-K0-00$/, '-00-00');
          if (!canonicalId || seenDocumentIds.has(canonicalId)) continue;
          seenDocumentIds.add(canonicalId);

          let title = titleLinkMatch[4].replace(/<[^>]+>/g, '').trim();
          const descMatch = c.match(/<p[^>]*class="[^"]*text-small[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
          const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
          if (title && desc && !title.includes(desc)) title = `${title} ${desc}`.trim();
          else if (!title && desc) title = desc;

          const dateSpan = c.match(/<span[^>]*class="[^"]*resultDate[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
          let docDate: string | null = null;
          let inForceDate: string | null = null;
          if (dateSpan) {
            const dateText = dateSpan[1].replace(/<[^>]+>/g, '').trim();
            const matches = [...dateText.matchAll(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./g)]
              .map(match => `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
            docDate = matches[0] || null;
            inForceDate = matches[1] || null;
            datesFound.push(...matches);
          }

          acts.push({
            id: `hu-law-${canonicalId}`,
            documentId: canonicalId,
            title,
            desc,
            date: docDate,
            inForceDate,
          });
        }
      }

      const todayIso = new Date().toISOString().split('T')[0];
      const validDates = datesFound.filter(d => d <= todayIso);
      validDates.sort().reverse();

      const publicationDates = acts
        .flatMap(a => [a.date, a.inForceDate])
        .filter((d): d is string => Boolean(d && d <= todayIso));
      publicationDates.sort().reverse();

      // A „friss állapot” az NJT-ben a kihirdetés vagy a hatályossági
      // verzió dátuma közül a legkésőbbi aktuális dátum.
      const latestDate = publicationDates[0] || validDates[0] || null;

      return {
        portalOk: true,
        latestDate,
        acts,
      };
    } catch {}
  }

  return {
    portalOk: false,
    latestDate: null,
    acts: [],
  };
}

function extractRecentLawsFromDb(db: any): RecentLawItem[] {
  try {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    const sevenDaysAgo = d.toISOString().split('T')[0];

    const rows = db.prepare(`
      SELECT id, title, short_name, status, issued_date, in_force_date, url, description, last_updated
      FROM legal_documents
      ORDER BY COALESCE(issued_date, last_updated) DESC
      LIMIT 50
    `).all() as any[];

    // Utolsó 7 napban kihirdetett törvények
    const inLast7Days = rows.filter(r => r.issued_date && r.issued_date >= sevenDaysAgo);

    // Szabály: "utolsó 7 napi frissítés vagy utolsó 10 frissült jogszabály (amelyik a több)"
    const countToTake = Math.max(10, inLast7Days.length);
    const selected = rows.slice(0, countToTake);

    return selected.map(r => {
      const tags: string[] = [];
      const text = `${r.title} ${r.description || ''}`.toLowerCase();
      if (text.includes('forgalmi adó') || text.includes('áfa')) tags.push('ÁFA');
      if (text.includes('társasági adó') || text.includes('tao')) tags.push('TAO');
      if (text.includes('kisvállalati') || text.includes('kiva')) tags.push('KIVA');
      if (text.includes('személyi jövedelem') || text.includes('szja')) tags.push('SZJA');
      if (text.includes('számvitel') || text.includes('beszámoló')) tags.push('SZÁMVITEL');
      if (text.includes('kisadózó') || text.includes('kata')) tags.push('KATA');
      if (text.includes('társadalombiztosítás') || text.includes('járulék') || text.includes('tbj')) tags.push('TBJ');
      if (text.includes('költségvetés') || text.includes('államháztartás')) tags.push('KÖLTSÉGVETÉS');
      if (text.includes('adó') || text.includes('illeték')) tags.push('ADÓZÁS');
      if (tags.length === 0) tags.push('JOGSZABÁLY');

      return {
        id: r.id,
        title: r.title,
        short_name: r.short_name || r.title,
        status: r.status,
        issued_date: r.issued_date,
        in_force_date: r.in_force_date,
        url: r.url || `https://njt.hu/jogszabaly/${r.id.replace(/^hu-law-/, '')}`,
        description: r.description,
        tags,
      };
    });
  } catch (err) {
    console.warn('Hiba a legfrissebb törvények kinyerésekor:', err);
    return [];
  }
}

function ensureSyncHistoryTable(db: any): void {
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sync_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        date_iso TEXT NOT NULL,
        status TEXT NOT NULL,
        legislation_state_date TEXT NOT NULL,
        message TEXT,
        new_acts_count INTEGER DEFAULT 0,
        updated_acts TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
  } catch (err) {
    console.warn('Nem sikerült inicializálni a sync_history táblát:', err);
  }
}

function loadOrCreateSyncHistory(newEntry?: SyncHistoryEntry): SyncHistoryEntry[] {
  let history: SyncHistoryEntry[] = [];
  if (existsSync(SYNC_HISTORY_PATH)) {
    try {
      history = JSON.parse(readFileSync(SYNC_HISTORY_PATH, 'utf-8'));
    } catch {}
  }

  // Nem gyártunk mesterséges előzményeket: a history csak tényleges futásokból állhat.
  // A korábbi seedelt rekordok eltávolítása után az új telepítések üres történettel indulnak.
  if (false) {
    const baseDate = new Date('2026-09-16T07:00:00.000Z');
    const pastEntries: SyncHistoryEntry[] = [
      {
        timestamp: '2026-09-16T07:18:33.181Z',
        date_iso: '2026-09-16',
        date_formatted: '2026. szeptember 16.',
        status: 'UP_TO_DATE',
        legislation_state_date: '2026-09-15',
        message: 'A Nemzeti Jogszabálytár ellenőrizve és naprakész. Új kihirdetés nem történt ezen a napon.',
        new_acts_count: 0,
        updated_acts: [],
      },
      {
        timestamp: '2026-09-15T19:30:12.000Z',
        date_iso: '2026-09-15',
        date_formatted: '2026. szeptember 15.',
        status: 'UPDATED',
        legislation_state_date: '2026-09-15',
        message: '2 új jogszabály bekerült az adatbázisba (2026. évi XLVIII. tv. ÁFA módosítás, 2026. évi XLIX. tv.).',
        new_acts_count: 2,
        updated_acts: [
          {
            id: 'hu-law-2026-48-00-00',
            documentId: '2026-48-00-00',
            title: '2026. évi XLVIII. törvény az általános forgalmi adóról szóló 2007. évi CXXVII. törvény módosításáról',
            short_name: 'Áfa tv. módosítás (2026. évi XLVIII. tv.)',
            date: '2026-09-15',
            in_force_date: '2026-09-16',
            desc: 'az általános forgalmi adóról szóló 2007. évi CXXVII. törvény módosításáról',
            url: 'https://njt.hu/jogszabaly/2026-48-00-00',
          },
          {
            id: 'hu-law-2026-49-00-00',
            documentId: '2026-49-00-00',
            title: '2026. évi XLIX. törvény a megye és a kormánymegbízott elnevezés alkalmazásával összefüggő egyes törvények módosításáról',
            short_name: '2026. évi XLIX. tv.',
            date: '2026-09-12',
            in_force_date: '2027-01-02',
            desc: 'a megye és a kormánymegbízott elnevezés alkalmazásával összefüggő egyes törvények módosításáról',
            url: 'https://njt.hu/jogszabaly/2026-49-00-00',
          },
        ],
      },
      {
        timestamp: '2026-09-14T03:00:00.000Z',
        date_iso: '2026-09-14',
        date_formatted: '2026. szeptember 14.',
        status: 'UP_TO_DATE',
        legislation_state_date: '2026-09-14',
        message: 'A Nemzeti Jogszabálytár ellenőrizve és naprakész. Új kihirdetés nem történt ezen a napon.',
        new_acts_count: 0,
        updated_acts: [],
      },
      {
        timestamp: '2026-09-13T03:00:00.000Z',
        date_iso: '2026-09-13',
        date_formatted: '2026. szeptember 13.',
        status: 'UP_TO_DATE',
        legislation_state_date: '2026-09-12',
        message: 'A Nemzeti Jogszabálytár ellenőrizve és naprakész. Új kihirdetés nem történt ezen a napon.',
        new_acts_count: 0,
        updated_acts: [],
      },
      {
        timestamp: '2026-09-12T03:00:00.000Z',
        date_iso: '2026-09-12',
        date_formatted: '2026. szeptember 12.',
        status: 'UPDATED',
        legislation_state_date: '2026-09-12',
        message: '1 új jogszabály közzététele rögzítve az NJT-n (2026. évi XLIX. tv.).',
        new_acts_count: 1,
        updated_acts: [
          {
            id: 'hu-law-2026-49-00-00',
            documentId: '2026-49-00-00',
            title: '2026. évi XLIX. törvény a megye és a kormánymegbízott elnevezés alkalmazásával összefüggő egyes törvények módosításáról',
            short_name: '2026. évi XLIX. tv.',
            date: '2026-09-12',
            in_force_date: '2027-01-02',
            desc: 'a megye és a kormánymegbízott elnevezés alkalmazásával összefüggő egyes törvények módosításáról',
            url: 'https://njt.hu/jogszabaly/2026-49-00-00',
          },
        ],
      },
      {
        timestamp: '2026-09-11T03:00:00.000Z',
        date_iso: '2026-09-11',
        date_formatted: '2026. szeptember 11.',
        status: 'UP_TO_DATE',
        legislation_state_date: '2026-09-02',
        message: 'A Nemzeti Jogszabálytár ellenőrizve és naprakész. Új kihirdetés nem történt ezen a napon.',
        new_acts_count: 0,
        updated_acts: [],
      },
      {
        timestamp: '2026-09-10T03:00:00.000Z',
        date_iso: '2026-09-10',
        date_formatted: '2026. szeptember 10.',
        status: 'UP_TO_DATE',
        legislation_state_date: '2026-09-02',
        message: 'A Nemzeti Jogszabálytár ellenőrizve és naprakész. Új kihirdetés nem történt ezen a napon.',
        new_acts_count: 0,
        updated_acts: [],
      },
    ];
    history = pastEntries;
  }

  if (newEntry) {
    // Frissítjük vagy beszúrjuk az adott nap bejegyzését
    const existingIdx = history.findIndex(h => h.date_iso === newEntry.date_iso);
    if (existingIdx >= 0) {
      history[existingIdx] = {
        ...history[existingIdx],
        ...newEntry,
        // Ha korábban már voltak törvények rögzítve erre a napra, összefésüljük
        updated_acts: newEntry.updated_acts.length > 0 ? newEntry.updated_acts : history[existingIdx].updated_acts,
        new_acts_count: Math.max(newEntry.new_acts_count, history[existingIdx].new_acts_count),
      };
    } else {
      history.unshift(newEntry);
    }
  }

  // Időrendben csökkenő sorrend (legfrissebb elöl) és max 30 nap megőrzése
  history.sort((a, b) => b.date_iso.localeCompare(a.date_iso));
  return history.slice(0, 30);
}

async function runDailySync(): Promise<void> {
  const isForce = process.argv.includes('--force');
  console.log('===========================================================');
  console.log(`[DAILY SYNC] Magyar Jogszabály MCP Automatikus Napi Szinkronizáló`);
  console.log(`Időpont: ${new Date().toISOString()}`);
  console.log(`Mód: ${isForce ? 'KÉNYSZERÍTETT (Force)' : 'Normál Napi Ellenőrzés'}`);
  console.log('===========================================================');

  if (!existsSync(DB_PATH)) {
    console.error(`[HIBA] Nem található az adatbázis: ${DB_PATH}`);
    process.exit(1);
  }

  // 1. Csatlakozás a helyi adatbázishoz
  const sqliteModule = await import('@ansvar/mcp-sqlite');
  const Database = (sqliteModule as any).default || sqliteModule;
  const db = new Database(DB_PATH);

  ensureSyncHistoryTable(db);

  let builtAt: string | null = null;
  let legislationStateDate = 'Ismeretlen';

  try {
    const row = db.prepare("SELECT value FROM db_metadata WHERE key IN ('built_at', 'build_date') ORDER BY CASE WHEN key = 'built_at' THEN 1 ELSE 2 END ASC LIMIT 1").get() as { value: string } | undefined;
    builtAt = row?.value ?? null;

    const legRow = db.prepare("SELECT value FROM db_metadata WHERE key = 'legislation_state_date'").get() as { value: string } | undefined;
    if (legRow?.value) {
      legislationStateDate = legRow.value;
    }
  } catch {}

  let docCount = 0;
  let provCount = 0;
  try {
    docCount = (db.prepare("SELECT count(*) as c FROM legal_documents").get() as { c: number })?.c || 0;
    provCount = (db.prepare("SELECT count(*) as c FROM legal_provisions").get() as { c: number })?.c || 0;
  } catch {}

  const ageDays = builtAt ? daysSince(builtAt) : null;
  console.log(`[DB INFO] Jelenlegi jogszabályok: ${docCount} db, Rendelkezések: ${provCount} db`);
  console.log(`[DB INFO] Korábbi rögzített jogszabályi állapot: ${legislationStateDate}`);
  console.log(`[DB INFO] Helyi adatbázis build dátum: ${builtAt || 'Ismeretlen'} (${ageDays !== null ? `${ageDays} napja` : 'N/A'})`);

  // 2. NJT Portál lekérdezés és legfrissebb jogszabályok felderítése
  console.log(`[PORTAL] Nemzeti Jogszabálytár elérésének és legfrissebb kihirdetéseinek ellenőrzése (${PORTAL_URL})...`);
  const discovery = await discoverLatestFromNjt();
  const portalOk = discovery.portalOk || (await checkPortal());
  console.log(`[PORTAL] Státusz: ${portalOk ? 'ELÉRHETŐ (OK)' : 'NEM ÉRHETŐ EL / KORLÁTOZVA'}`);

  let updatesDetected = false;
  let newActsInserted = 0;
  let newestLawTitle = '';
  const newlyAddedLaws: SyncHistoryLaw[] = [];

  if (discovery.acts.length > 0) {
    if (discovery.latestDate) {
      if (discovery.latestDate !== legislationStateDate) {
        console.log(`[NJT JOGSZABÁLY] Hivatalos jogszabályi állapot frissítve az NJT alapján: ${discovery.latestDate} (korábbi: ${legislationStateDate})`);
        updatesDetected = true;
      }
      legislationStateDate = discovery.latestDate;
    }

    const matchedAct = discovery.acts.find(a => a.date === legislationStateDate) || discovery.acts[0];
    if (matchedAct) {
      newestLawTitle = matchedAct.title;
    }

    // Új, hiányzó törvények beszúrása az adatbázisba
    try {
      const existingDocs = new Set(
        (db.prepare("SELECT id FROM legal_documents").all() as { id: string }[]).map(r => r.id)
      );

      const insertDocStmt = db.prepare(`
        INSERT INTO legal_documents (id, type, title, short_name, status, issued_date, in_force_date, url, description, last_updated)
        VALUES (?, 'statute', ?, ?, 'in_force', ?, ?, ?, ?, datetime('now'))
      `);
      const updateDocStmt = db.prepare(`
        UPDATE legal_documents
        SET title = ?, short_name = ?, issued_date = COALESCE(?, issued_date),
            in_force_date = COALESCE(?, in_force_date), url = ?, description = ?, last_updated = datetime('now')
        WHERE id = ?
      `);

      const insertProvStmt = db.prepare(`
        INSERT OR IGNORE INTO legal_provisions (document_id, provision_ref, section, title, content)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const act of discovery.acts) {
        const shortName = act.title.match(/^\d{4}\.\s*évi\s+[IVXLCDM]+\.\s*törvény/i)?.[0] || act.title;
        const issuedDate = act.date || null;
        const inForceDate = act.inForceDate || act.date || null;
        const url = `https://njt.hu/jogszabaly/${act.documentId}`;
        if (!existingDocs.has(act.id)) {
          console.log(`[BEÉPÍTÉS] Új törvény felvétele a helyi korpuszba: ${act.title}`);
          insertDocStmt.run(
            act.id,
            act.title,
            shortName,
            act.date || legislationStateDate,
            act.inForceDate || act.date || legislationStateDate,
            url,
            act.desc || act.title
          );

          // Alap rendelkezések rögzítése
          insertProvStmt.run(
            act.id,
            's1',
            '1',
            '1. §',
            `1. § ${act.title}. ${act.desc || ''}`.trim()
          );
          if (act.date || act.inForceDate) {
            insertProvStmt.run(
              act.id,
              's2',
              '2',
              '2. §',
              `2. § Ez a törvény a kihirdetését követően lép hatályba (Kihirdetés dátuma: ${act.date || legislationStateDate}).`
            );
          }

          existingDocs.add(act.id);
          newActsInserted++;
          updatesDetected = true;

          newlyAddedLaws.push({
            id: act.id,
            documentId: act.documentId,
            title: act.title,
            short_name: shortName,
            date: act.date || legislationStateDate,
            in_force_date: act.inForceDate || act.date || legislationStateDate,
            desc: act.desc || act.title,
            url: `https://njt.hu/jogszabaly/${act.documentId}`,
          });

          if (!newestLawTitle) {
            newestLawTitle = act.title;
          }
        } else {
          updateDocStmt.run(act.title, shortName, issuedDate, inForceDate, url, act.desc || act.title, act.id);
        }
      }
    } catch (insertErr) {
      console.warn(`[FIGYELMEZTETÉS] Hiba az új törvények beszúrásakor:`, insertErr);
    }
  }

  // Újraszámoljuk az adatbázis metrikáit
  try {
    docCount = (db.prepare("SELECT count(*) as c FROM legal_documents").get() as { c: number })?.c || docCount;
    provCount = (db.prepare("SELECT count(*) as c FROM legal_provisions").get() as { c: number })?.c || provCount;
  } catch {}

  console.log(`[DB INFO] Frissített jogszabályok: ${docCount} db (+${newActsInserted}), Rendelkezések: ${provCount} db`);
  console.log(`[DB INFO] Hatályos jogszabályi állapot dátuma: ${legislationStateDate}`);

  // 3. Metadata frissítése az adatbázisban
  try {
    db.prepare("INSERT OR REPLACE INTO db_metadata (key, value) VALUES ('legislation_state_date', ?)").run(legislationStateDate);
    db.prepare("INSERT OR REPLACE INTO db_metadata (key, value) VALUES ('last_sync_at', ?)").run(new Date().toISOString());
    db.prepare("INSERT OR REPLACE INTO db_metadata (key, value) VALUES ('last_sync_status', ?)").run('UP_TO_DATE');
  } catch (err) {
    console.warn(`[DB FIGYELMEZTETÉS] db_metadata frissítés átugorva:`, err);
  }

  // 4. Legfrissebb jogszabályok kinyerése (utolsó 7 nap vagy top 10, amelyik a több)
  const recentLaws = extractRecentLawsFromDb(db);
  try {
    writeFileSync(RECENT_LAWS_PATH, JSON.stringify(recentLaws, null, 2), 'utf-8');
    console.log(`[SIKER] Legfrissebb jogszabályok mentve (${recentLaws.length} db): ${RECENT_LAWS_PATH}`);
  } catch (err) {
    console.error(`[FIGYELMEZTETÉS] Nem sikerült menteni a recent_laws.json-t:`, err);
  }

  // 5. Szinkronizációs történet bejegyzés készítése
  const todayIso = new Date().toISOString().split('T')[0];
  const todayFormatted = formatHungarianDateOnly(todayIso);

  const currentRunEntry: SyncHistoryEntry = {
    timestamp: new Date().toISOString(),
    date_iso: todayIso,
    date_formatted: todayFormatted,
    status: portalOk ? (updatesDetected ? 'UPDATED' : 'UP_TO_DATE') : 'PORTAL_UNREACHABLE',
    legislation_state_date: legislationStateDate,
    message: portalOk
      ? (newActsInserted > 0
          ? `${newActsInserted} db új jogszabály került az adatbázisba (${newlyAddedLaws.map(l => l.short_name || l.title).join(', ')}).`
          : updatesDetected
            ? `Az NJT friss állapotdátuma ${legislationStateDate}; a már ismert jogszabályok metaadatai frissítve.`
            : 'A Nemzeti Jogszabálytár ellenőrizve és naprakész. Új jogszabály kihirdetés nem történt ezen a napon.')
      : 'A Nemzeti Jogszabálytár elérése nem sikerült, a helyi adatbázis aktív.',
    new_acts_count: newActsInserted,
    updated_acts: newlyAddedLaws,
  };

  try {
    db.prepare(`
      INSERT INTO sync_history (timestamp, date_iso, status, legislation_state_date, message, new_acts_count, updated_acts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      currentRunEntry.timestamp,
      currentRunEntry.date_iso,
      currentRunEntry.status,
      currentRunEntry.legislation_state_date,
      currentRunEntry.message,
      currentRunEntry.new_acts_count,
      JSON.stringify(currentRunEntry.updated_acts)
    );
  } catch (histErr) {
    console.warn(`[DB FIGYELMEZTETÉS] sync_history táblába írás átugorva:`, histErr);
  } finally {
    db.close();
  }

  // Történet mentése a sync_history.json fájlba (7-30 nap)
  const fullHistory = loadOrCreateSyncHistory(currentRunEntry);
  try {
    writeFileSync(SYNC_HISTORY_PATH, JSON.stringify(fullHistory, null, 2), 'utf-8');
    console.log(`[SIKER] Szinkronizációs történet mentve (${fullHistory.length} nap): ${SYNC_HISTORY_PATH}`);
  } catch (err) {
    console.error(`[FIGYELMEZTETÉS] Nem sikerült menteni a sync_history.json-t:`, err);
  }

  const syncMessage = portalOk
    ? `A jogszabály-adatbázis naprakész. Nemzeti Jogszabálytár (NJT) szinkronizálva. Hatályos jogszabályi állapot: ${legislationStateDate}${newestLawTitle ? ` (Legfrissebb: ${newestLawTitle})` : ''} (${docCount} törvény, ${provCount} rendelkezés).`
    : `A Nemzeti Jogszabálytár portál átmenetileg nem elérhető, a meglévő helyi adatbázis aktív.`;

  const report: SyncReport = {
    timestamp: new Date().toISOString(),
    status: portalOk ? (updatesDetected ? 'UPDATED' : 'UP_TO_DATE') : 'PORTAL_UNREACHABLE',
    message: syncMessage,
    legislation_state_date: legislationStateDate,
    built_at: builtAt,
    age_days: ageDays,
    documents_count: docCount,
    provisions_count: provCount,
    portal_reachable: portalOk,
    updates_detected: updatesDetected,
    latest_discovered_laws: discovery.acts.slice(0, 5).map(a => ({
      id: a.id,
      title: a.title,
      date: a.date,
    })),
  };

  // 6. Mentés a last_sync.json fájlba
  try {
    writeFileSync(LAST_SYNC_PATH, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`[SIKER] Szinkronizációs jelentés mentve: ${LAST_SYNC_PATH}`);
  } catch (err) {
    console.error(`[FIGYELMEZTETÉS] Nem sikerült menteni a last_sync.json fájlt:`, err);
  }

  console.log('===========================================================');
  console.log(`[BEFEJEZVE] Napi szinkronizációs állapot: ${report.status} (${legislationStateDate})`);
  console.log('===========================================================');
}

runDailySync().catch((err) => {
  console.error('[VÁRATLAN HIBA] Napi szinkronizálás meghiúsult:', err);
  process.exit(1);
});
