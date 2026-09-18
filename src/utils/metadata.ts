/**
 * Response metadata utilities for Hungarian Law MCP.
 */

import type Database from '@ansvar/mcp-sqlite';

export interface ResponseMetadata {
  data_source: string;
  jurisdiction: string;
  disclaimer: string;
  freshness?: string;
  legislation_state_date?: string;
  database_built_at?: string;
  last_sync_at?: string;
  note?: string;
  query_strategy?: string;
}

export interface ToolResponse<T> {
  results: T;
  _metadata: ResponseMetadata;
  _citation?: any;
}

export function generateResponseMetadata(
  db: InstanceType<typeof Database>,
): ResponseMetadata {
  let builtAt: string | undefined;
  let legislationStateDate: string = '2026-09-15';

  try {
    const builtRow = db.prepare(
      "SELECT value FROM db_metadata WHERE key = 'built_at'"
    ).get() as { value: string } | undefined;
    if (builtRow) builtAt = builtRow.value;

    const legRow = db.prepare(
      "SELECT value FROM db_metadata WHERE key = 'legislation_state_date'"
    ).get() as { value: string } | undefined;
    if (legRow?.value) {
      legislationStateDate = legRow.value;
    }
  } catch {
    // Ignore
  }

  return {
    data_source: 'Nemzeti Jogszabálytár (National Legislation Database) (njt.hu) — Magyar Közlöny (Hungarian Official Gazette)',
    jurisdiction: 'HU',
    legislation_state_date: legislationStateDate,
    database_built_at: builtAt,
    disclaimer:
      'Ez az adatbázis a Nemzeti Jogszabálytár (njt.hu) és a Magyar Közlöny folyamatosan kihirdetett hivatalos jogszabályi adatait dolgozza fel. ' +
      `Hatályos jogszabályi állapot: ${legislationStateDate}. Hivatalos jogszabályi ellenőrzéshez látogassa meg az njt.hu portált.`,
    freshness: `Hatályos jogszabályi állapot: ${legislationStateDate} (Nemzeti Jogszabálytár - njt.hu)`,
    note: `A Nemzeti Jogszabálytár folyamatosan frissülő hivatalos forrás (legutóbbi jogszabályi változás: ${legislationStateDate}). A helyi adatbázis ezt a hatályos korpuszt indexeli.`,
  };
}
