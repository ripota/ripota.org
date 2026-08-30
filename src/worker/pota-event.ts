import references from "../data/ri-references.json";
import {
  activateRiPotaEndDate,
  activateRiPotaStartDate,
  deriveParkPotaStatus,
  normalizePotaActivationHistory,
  spotToEventObservation,
  summarizeParkPotaStatuses,
  type ParkPotaFacts,
  type PotaActivationEvidence,
  type PotaSpotObservation,
} from "../lib/activate-ri/pota-event";
import type { LivePotaSpot } from "../lib/pota/spots";
import type { Env } from "./env";

const historyBatchSize = 20;
const historyConcurrency = 5;
const historyBatchIntervalMilliseconds = 15 * 60_000;
const parkHistoryIntervalMilliseconds = 55 * 60_000;
const historyLeaseMilliseconds = 10 * 60_000;
const historyTimeoutMilliseconds = 10_000;
const initialRetryMilliseconds = 60_000;
const maximumRetryMilliseconds = 60 * 60_000;
const activationHistorySourceVersion = "pota-park-activations-v1";

type SyncStateRow = {
  last_spot_ingest_at: number | null;
  last_history_batch_at: number | null;
  last_history_success_at: number | null;
  lease_until: number;
  retry_after: number;
  consecutive_failures: number;
  last_error_category: string;
  deep_requested_at: number | null;
  deep_completed_at: number | null;
};

type SpotObservationRow = {
  park_reference: string;
  spot_date: string;
  activator_callsign: string;
  location_desc: string;
  source_spot_id: string | null;
  last_observed_at: string;
  last_frequency: string;
  last_mode: string;
  last_source_label: string;
};

type ActivationEvidenceRow = {
  park_reference: string;
  location_desc: string;
  qso_date: string;
  activator_callsign: string;
  total_qsos: number;
  qsos_cw: number;
  qsos_data: number;
  qsos_phone: number;
  qualifying: number;
};

export type PublicPotaParkStatus = {
  reference: string;
  name: string;
  potaUrl: string;
  status: "confirmed" | "observed" | "scheduled" | "needed";
  live: boolean;
  scheduled: boolean;
  observed: boolean;
  attemptRecorded: boolean;
  confirmation: PublicActivationEvidence | null;
  confirmations: PublicActivationEvidence[];
  attempts: PublicActivationEvidence[];
  lastObservation: PublicSpotObservation | null;
};

type PublicActivationEvidence = {
  qsoDate: string;
  activeCallsign: string;
  totalQsos: number;
  qsosCw: number;
  qsosData: number;
  qsosPhone: number;
};

type PublicSpotObservation = {
  spotDate: string;
  activeCallsign: string;
  lastObservedAt: string;
  frequency: string;
  mode: string;
  sourceLabel: string;
};

export type PublicPotaParkStatusProjection = {
  ok: true;
  generatedAt: string;
  lastPotaSyncAt: string | null;
  lastSpotIngestAt: string | null;
  stale: boolean;
  warning: string | null;
  eventWindow: {
    startDate: typeof activateRiPotaStartDate;
    endDate: typeof activateRiPotaEndDate;
    timezone: "UTC";
  };
  summary: ReturnType<typeof summarizeParkPotaStatuses>;
  parks: PublicPotaParkStatus[];
};

export type PotaReconciliationResult = {
  acquired: boolean;
  deep: boolean;
  attempted: number;
  succeeded: number;
  failed: number;
  evidenceRows: number;
  complete: boolean;
};

export type PotaReconciliationOptions = {
  fetcher?: typeof fetch;
  now?: () => Date;
  force?: boolean;
};

export async function persistEventSpotObservations(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  spots: readonly LivePotaSpot[],
  observedAt = new Date(),
): Promise<number> {
  const observations = spots.flatMap((spot) => {
    const observation = spotToEventObservation(spot, observedAt);
    return observation ? [observation] : [];
  });
  const statements = observations.map((observation) => spotObservationUpsert(env, observation));
  if (statements.length > 0) await env.DB.batch(statements);
  await env.DB.prepare(
    `UPDATE activate_ri_pota_sync_state
     SET last_spot_ingest_at = ?
     WHERE event_id = ?`,
  ).bind(observedAt.valueOf(), env.ACTIVATE_RI_EVENT_ID).run();
  return observations.length;
}

export async function getPublicPotaParkStatus(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  now = new Date(),
): Promise<PublicPotaParkStatusProjection> {
  const [scheduled, observationResult, evidenceResult, syncState, liveReferences] = await Promise.all([
    scheduledReferences(env),
    env.DB.prepare(
      `SELECT park_reference, spot_date, activator_callsign, location_desc,
        source_spot_id, last_observed_at, last_frequency, last_mode,
        last_source_label
       FROM activate_ri_pota_spot_observations
       WHERE event_id = ?
       ORDER BY last_observed_at DESC`,
    ).bind(env.ACTIVATE_RI_EVENT_ID).all<SpotObservationRow>(),
    env.DB.prepare(
      `SELECT park_reference, location_desc, qso_date, activator_callsign,
        total_qsos, qsos_cw, qsos_data, qsos_phone, qualifying
       FROM activate_ri_pota_activation_evidence
       WHERE event_id = ?
       ORDER BY qso_date DESC, total_qsos DESC, activator_callsign ASC`,
    ).bind(env.ACTIVATE_RI_EVENT_ID).all<ActivationEvidenceRow>(),
    readSyncState(env),
    currentLiveReferences(env, now),
  ]);

  const observationsByPark = groupBy(observationResult.results ?? [], (row) => row.park_reference);
  const evidenceByPark = groupBy(evidenceResult.results ?? [], (row) => row.park_reference);
  const parks = references.map((reference): PublicPotaParkStatus => {
    const observationRows = observationsByPark.get(reference.reference) ?? [];
    const activationRows = evidenceByPark.get(reference.reference) ?? [];
    const facts: ParkPotaFacts = {
      scheduled: scheduled.has(reference.reference),
      live: liveReferences.has(reference.reference),
      observations: observationRows.map(observationFromRow),
      activations: activationRows.map(activationFromRow),
    };
    const derived = deriveParkPotaStatus(facts);
    const confirmations = activationRows.filter((row) => row.qualifying === 1).map(publicActivation);
    const attempts = activationRows.filter((row) => row.qualifying !== 1).map(publicActivation);
    return {
      reference: reference.reference,
      name: reference.name,
      potaUrl: reference.potaUrl,
      status: derived.status,
      live: derived.live,
      scheduled: derived.scheduled,
      observed: derived.observed,
      attemptRecorded: derived.attemptRecorded,
      confirmation: confirmations[0] ?? null,
      confirmations,
      attempts,
      lastObservation: observationRows[0] ? publicObservation(observationRows[0]) : null,
    };
  });
  const summary = summarizeParkPotaStatuses(parks.map((park) => ({
    status: park.status,
    scheduled: park.scheduled,
    live: park.live,
    observed: park.observed,
    attemptRecorded: park.attemptRecorded,
    confirmed: park.status === "confirmed",
  })));
  const stale = projectionIsStale(syncState, now);

  return {
    ok: true,
    generatedAt: now.toISOString(),
    lastPotaSyncAt: millisecondsToIso(syncState.last_history_success_at),
    lastSpotIngestAt: millisecondsToIso(syncState.last_spot_ingest_at),
    stale,
    warning: stale
      ? "POTA evidence updates are delayed. Persisted results remain visible while reconciliation recovers."
      : null,
    eventWindow: {
      startDate: activateRiPotaStartDate,
      endDate: activateRiPotaEndDate,
      timezone: "UTC",
    },
    summary,
    parks,
  };
}

export async function getPotaAdminStatus(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  now = new Date(),
): Promise<Record<string, unknown>> {
  await seedReconciliationRows(env);
  const projection = await getPublicPotaParkStatus(env, now);
  const state = await readSyncState(env);
  const next = await env.DB.prepare(
    `SELECT park_reference FROM activate_ri_pota_reconciliation
     WHERE event_id = ?
     ORDER BY COALESCE(last_attempted_at, 0) ASC, park_reference ASC
     LIMIT 1`,
  ).bind(env.ACTIVATE_RI_EVENT_ID).first<{ park_reference: string }>();
  const attempts = projection.parks.reduce((count, park) => count + park.attempts.length, 0);
  return {
    lastSpotIngestAt: projection.lastSpotIngestAt,
    lastHistoryBatchAt: millisecondsToIso(state.last_history_batch_at),
    lastHistorySuccessAt: projection.lastPotaSyncAt,
    confirmed: projection.summary.confirmed,
    observed: projection.summary.observedNotConfirmed,
    attempts,
    nextParkReference: next?.park_reference ?? null,
    consecutiveFailures: state.consecutive_failures,
    retryAfter: millisecondsToIso(state.retry_after || null),
    lastErrorCategory: state.last_error_category || null,
    deepReconciliationPending: Boolean(
      state.deep_requested_at && (!state.deep_completed_at || state.deep_completed_at < state.deep_requested_at),
    ),
    deepRequestedAt: millisecondsToIso(state.deep_requested_at),
    deepCompletedAt: millisecondsToIso(state.deep_completed_at),
  };
}

export async function requestDeepPotaReconciliation(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  now = new Date(),
): Promise<void> {
  await seedReconciliationRows(env);
  await env.DB.prepare(
    `UPDATE activate_ri_pota_sync_state
     SET deep_requested_at = ?, deep_completed_at = NULL, retry_after = 0
     WHERE event_id = ?`,
  ).bind(now.valueOf(), env.ACTIVATE_RI_EVENT_ID).run();
}

export async function runPotaHistoryReconciliation(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  options: PotaReconciliationOptions = {},
): Promise<PotaReconciliationResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().valueOf();
  await seedReconciliationRows(env);
  const state = await readSyncState(env);
  const deep = Boolean(
    state.deep_requested_at && (!state.deep_completed_at || state.deep_completed_at < state.deep_requested_at),
  );
  if (!options.force && !deep && state.last_history_batch_at &&
    startedAt - state.last_history_batch_at < historyBatchIntervalMilliseconds) {
    return emptyReconciliation(false, false);
  }

  const leaseToken = crypto.randomUUID();
  const lease = await env.DB.prepare(
    `UPDATE activate_ri_pota_sync_state
     SET lease_token = ?, lease_until = ?
     WHERE event_id = ? AND lease_until <= ? AND retry_after <= ?
     RETURNING event_id`,
  ).bind(
    leaseToken,
    startedAt + historyLeaseMilliseconds,
    env.ACTIVATE_RI_EVENT_ID,
    startedAt,
    startedAt,
  ).first<{ event_id: string }>();
  if (!lease) return emptyReconciliation(false, deep);

  const selected = await selectParksForReconciliation(env, startedAt, deep, state.deep_requested_at);
  if (selected.length === 0) {
    await finishReconciliation(env, leaseToken, startedAt, 0, 0, deep, state.deep_requested_at);
    return { ...emptyReconciliation(true, deep), complete: true };
  }

  const outcomes = await mapWithConcurrency(selected, historyConcurrency, async (parkReference) => {
    try {
      const evidence = await fetchParkHistory(
        options.fetcher ?? fetch,
        parkReference,
        deep,
      );
      const completedAt = now().valueOf();
      await storeActivationEvidence(env, parkReference, evidence, completedAt, deep);
      return { ok: true as const, evidenceRows: evidence.length };
    } catch (error) {
      await recordParkFailure(env, parkReference, now().valueOf(), classifySyncError(error));
      return { ok: false as const, evidenceRows: 0 };
    }
  });
  const succeeded = outcomes.filter((outcome) => outcome.ok).length;
  const failed = outcomes.length - succeeded;
  const evidenceRows = outcomes.reduce((total, outcome) => total + outcome.evidenceRows, 0);
  const complete = await finishReconciliation(
    env,
    leaseToken,
    now().valueOf(),
    succeeded,
    failed,
    deep,
    state.deep_requested_at,
  );
  return { acquired: true, deep, attempted: outcomes.length, succeeded, failed, evidenceRows, complete };
}

async function fetchParkHistory(
  fetcher: typeof fetch,
  parkReference: string,
  deep: boolean,
): Promise<PotaActivationEvidence[]> {
  const response = await fetcher(
    `https://api.pota.app/park/activations/${encodeURIComponent(parkReference)}?count=${deep ? "all" : "100"}`,
    {
      headers: {
        accept: "application/json",
        "user-agent": "ripota.org Activate All RI evidence reconciliation",
      },
      signal: AbortSignal.timeout(historyTimeoutMilliseconds),
    },
  );
  if (!response.ok) throw new SyncError(`http-${response.status}`);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new SyncError("invalid-json");
  }
  try {
    return normalizePotaActivationHistory(value, parkReference);
  } catch {
    throw new SyncError("invalid-shape");
  }
}

async function storeActivationEvidence(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  parkReference: string,
  evidence: readonly PotaActivationEvidence[],
  completedAt: number,
  deep: boolean,
): Promise<void> {
  const timestamp = new Date(completedAt).toISOString();
  const statements = evidence.map((row) => env.DB.prepare(
    `INSERT INTO activate_ri_pota_activation_evidence (
       event_id, park_reference, location_desc, qso_date, activator_callsign,
       total_qsos, qsos_cw, qsos_data, qsos_phone, qualifying,
       source_version, first_seen_at, last_verified_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, park_reference, location_desc, qso_date, activator_callsign)
     DO UPDATE SET
       total_qsos = excluded.total_qsos,
       qsos_cw = excluded.qsos_cw,
       qsos_data = excluded.qsos_data,
       qsos_phone = excluded.qsos_phone,
       qualifying = excluded.qualifying,
       source_version = excluded.source_version,
       last_verified_at = excluded.last_verified_at,
       updated_at = excluded.updated_at`,
  ).bind(
    env.ACTIVATE_RI_EVENT_ID,
    row.parkReference,
    row.locationDesc,
    row.qsoDate,
    row.activatorCallsign,
    row.totalQsos,
    row.qsosCw,
    row.qsosData,
    row.qsosPhone,
    row.qualifying ? 1 : 0,
    activationHistorySourceVersion,
    timestamp,
    timestamp,
    timestamp,
    timestamp,
  ));
  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
  await env.DB.prepare(
    `UPDATE activate_ri_pota_reconciliation
     SET last_attempted_at = ?, last_success_at = ?,
       last_deep_at = CASE WHEN ? THEN ? ELSE last_deep_at END,
       retry_after = 0, consecutive_failures = 0, last_error_category = ''
     WHERE event_id = ? AND park_reference = ?`,
  ).bind(
    completedAt,
    completedAt,
    deep ? 1 : 0,
    completedAt,
    env.ACTIVATE_RI_EVENT_ID,
    parkReference,
  ).run();
}

async function recordParkFailure(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  parkReference: string,
  failedAt: number,
  category: string,
): Promise<void> {
  const state = await env.DB.prepare(
    `SELECT consecutive_failures
     FROM activate_ri_pota_reconciliation
     WHERE event_id = ? AND park_reference = ?`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, parkReference).first<{ consecutive_failures: number }>();
  const retry = Math.min(
    initialRetryMilliseconds * (2 ** (state?.consecutive_failures ?? 0)),
    maximumRetryMilliseconds,
  );
  await env.DB.prepare(
    `UPDATE activate_ri_pota_reconciliation
     SET last_attempted_at = ?, retry_after = ?,
       consecutive_failures = consecutive_failures + 1,
       last_error_category = ?
     WHERE event_id = ? AND park_reference = ?`,
  ).bind(
    failedAt,
    failedAt + retry,
    category,
    env.ACTIVATE_RI_EVENT_ID,
    parkReference,
  ).run();
}

async function selectParksForReconciliation(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  now: number,
  deep: boolean,
  deepRequestedAt: number | null,
): Promise<string[]> {
  const result = deep
    ? await env.DB.prepare(
        `SELECT park_reference
         FROM activate_ri_pota_reconciliation r
         WHERE event_id = ? AND retry_after <= ?
           AND (last_deep_at IS NULL OR last_deep_at < ?)
         ORDER BY COALESCE(last_deep_at, 0) ASC, park_reference ASC
         LIMIT ?`,
      ).bind(env.ACTIVATE_RI_EVENT_ID, now, deepRequestedAt ?? now, historyBatchSize)
        .all<{ park_reference: string }>()
    : await env.DB.prepare(
        `SELECT r.park_reference
         FROM activate_ri_pota_reconciliation r
         WHERE r.event_id = ? AND r.retry_after <= ?
           AND (r.last_attempted_at IS NULL OR r.last_attempted_at <= ?)
           AND NOT EXISTS (
             SELECT 1 FROM activate_ri_pota_activation_evidence e
             WHERE e.event_id = r.event_id
               AND e.park_reference = r.park_reference
               AND e.qualifying = 1
           )
         ORDER BY
           CASE
             WHEN EXISTS (
               SELECT 1 FROM activate_ri_pota_spot_observations o
               WHERE o.event_id = r.event_id AND o.park_reference = r.park_reference
             ) THEN 3
             WHEN EXISTS (
               SELECT 1 FROM activate_ri_pota_activation_evidence a
               WHERE a.event_id = r.event_id AND a.park_reference = r.park_reference
                 AND a.qualifying = 0
             ) THEN 2
             WHEN EXISTS (
               SELECT 1 FROM activate_ri_stops s
               WHERE s.event_id = r.event_id AND s.park_reference = r.park_reference
                 AND s.status = 'completed'
             ) THEN 1
             ELSE 0
           END DESC,
           COALESCE(r.last_attempted_at, 0) ASC,
           r.park_reference ASC
         LIMIT ?`,
      ).bind(
        env.ACTIVATE_RI_EVENT_ID,
        now,
        now - parkHistoryIntervalMilliseconds,
        historyBatchSize,
      ).all<{ park_reference: string }>();
  return (result.results ?? []).map((row) => row.park_reference);
}

async function finishReconciliation(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  leaseToken: string,
  completedAt: number,
  succeeded: number,
  failed: number,
  deep: boolean,
  deepRequestedAt: number | null,
): Promise<boolean> {
  let complete = false;
  if (deep && deepRequestedAt) {
    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM activate_ri_pota_reconciliation
       WHERE event_id = ? AND (last_deep_at IS NULL OR last_deep_at < ?)`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, deepRequestedAt).first<{ count: number }>();
    complete = (remaining?.count ?? 0) === 0;
  }
  const allFailed = failed > 0 && succeeded === 0;
  const retryAfter = allFailed ? completedAt + initialRetryMilliseconds : 0;
  await env.DB.prepare(
    `UPDATE activate_ri_pota_sync_state
     SET last_history_batch_at = ?,
       last_history_success_at = CASE WHEN ? > 0 THEN ? ELSE last_history_success_at END,
       lease_token = NULL, lease_until = 0, retry_after = ?,
       consecutive_failures = CASE WHEN ? THEN consecutive_failures + 1 ELSE 0 END,
       last_error_category = CASE
         WHEN ? THEN 'upstream-unavailable'
         WHEN ? > 0 THEN 'partial-upstream'
         ELSE ''
       END,
       deep_completed_at = CASE WHEN ? THEN ? ELSE deep_completed_at END
     WHERE event_id = ? AND lease_token = ?`,
  ).bind(
    completedAt,
    succeeded,
    completedAt,
    retryAfter,
    allFailed ? 1 : 0,
    allFailed ? 1 : 0,
    failed,
    complete ? 1 : 0,
    complete ? completedAt : null,
    env.ACTIVATE_RI_EVENT_ID,
    leaseToken,
  ).run();
  return complete;
}

async function seedReconciliationRows(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
): Promise<void> {
  await env.DB.batch(references.map((reference) => env.DB.prepare(
    `INSERT OR IGNORE INTO activate_ri_pota_reconciliation (event_id, park_reference)
     VALUES (?, ?)`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, reference.reference)));
}

async function scheduledReferences(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
): Promise<Set<string>> {
  const result = await env.DB.prepare(
    `SELECT DISTINCT s.park_reference
     FROM activate_ri_stops s
     INNER JOIN activate_ri_activators a ON a.id = s.activator_id
     WHERE s.event_id = ? AND a.event_id = ? AND a.status = 'approved'
       AND s.status IN ('scheduled', 'delayed', 'completed')`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, env.ACTIVATE_RI_EVENT_ID)
    .all<{ park_reference: string }>();
  return new Set((result.results ?? []).map((row) => row.park_reference));
}

async function currentLiveReferences(
  env: Pick<Env, "DB">,
  now: Date,
): Promise<Set<string>> {
  const row = await env.DB.prepare(
    `SELECT payload_json, fetched_at FROM pota_spots_cache WHERE id = 'ri-live-spots'`,
  ).first<{ payload_json: string | null; fetched_at: number | null }>();
  if (!row?.payload_json || !row.fetched_at) return new Set();
  let spots: unknown;
  try {
    spots = JSON.parse(row.payload_json);
  } catch {
    return new Set();
  }
  if (!Array.isArray(spots)) return new Set();
  const elapsedSeconds = Math.max(0, Math.floor((now.valueOf() - row.fetched_at) / 1_000));
  return new Set(spots.flatMap((spot) => {
    if (!isRecord(spot) || spot.locationDesc !== "US-RI" || typeof spot.parkReference !== "string") return [];
    const expiry = typeof spot.expiresInSeconds === "number" ? spot.expiresInSeconds : null;
    return expiry === null || expiry - elapsedSeconds > 0 ? [spot.parkReference] : [];
  }));
}

async function readSyncState(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
): Promise<SyncStateRow> {
  const row = await env.DB.prepare(
    `SELECT last_spot_ingest_at, last_history_batch_at, last_history_success_at,
      lease_until, retry_after, consecutive_failures, last_error_category,
      deep_requested_at, deep_completed_at
     FROM activate_ri_pota_sync_state WHERE event_id = ?`,
  ).bind(env.ACTIVATE_RI_EVENT_ID).first<SyncStateRow>();
  if (!row) throw new Error("Activate RI POTA sync state is missing.");
  return row;
}

function spotObservationUpsert(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  observation: PotaSpotObservation,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO activate_ri_pota_spot_observations (
       event_id, park_reference, spot_date, activator_callsign, location_desc,
       source_spot_id, first_observed_at, last_observed_at, last_frequency,
       last_mode, last_source_label, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, park_reference, spot_date, activator_callsign)
     DO UPDATE SET
       location_desc = excluded.location_desc,
       source_spot_id = COALESCE(excluded.source_spot_id, source_spot_id),
       last_observed_at = excluded.last_observed_at,
       last_frequency = excluded.last_frequency,
       last_mode = excluded.last_mode,
       last_source_label = excluded.last_source_label,
       updated_at = excluded.updated_at`,
  ).bind(
    env.ACTIVATE_RI_EVENT_ID,
    observation.parkReference,
    observation.spotDate,
    observation.activatorCallsign,
    observation.locationDesc,
    observation.sourceSpotId,
    observation.observedAt,
    observation.observedAt,
    observation.frequency,
    observation.mode,
    observation.sourceLabel,
    observation.observedAt,
    observation.observedAt,
  );
}

function observationFromRow(row: SpotObservationRow): PotaSpotObservation {
  return {
    parkReference: row.park_reference,
    spotDate: row.spot_date,
    activatorCallsign: row.activator_callsign,
    locationDesc: "US-RI",
    sourceSpotId: row.source_spot_id,
    observedAt: row.last_observed_at,
    frequency: row.last_frequency,
    mode: row.last_mode,
    sourceLabel: row.last_source_label,
  };
}

function activationFromRow(row: ActivationEvidenceRow): PotaActivationEvidence {
  return {
    parkReference: row.park_reference,
    locationDesc: "US-RI",
    qsoDate: row.qso_date,
    activatorCallsign: row.activator_callsign,
    totalQsos: row.total_qsos,
    qsosCw: row.qsos_cw,
    qsosData: row.qsos_data,
    qsosPhone: row.qsos_phone,
    qualifying: row.qualifying === 1,
  };
}

function publicActivation(row: ActivationEvidenceRow): PublicActivationEvidence {
  return {
    qsoDate: row.qso_date,
    activeCallsign: row.activator_callsign,
    totalQsos: row.total_qsos,
    qsosCw: row.qsos_cw,
    qsosData: row.qsos_data,
    qsosPhone: row.qsos_phone,
  };
}

function publicObservation(row: SpotObservationRow): PublicSpotObservation {
  return {
    spotDate: row.spot_date,
    activeCallsign: row.activator_callsign,
    lastObservedAt: row.last_observed_at,
    frequency: row.last_frequency,
    mode: row.last_mode,
    sourceLabel: row.last_source_label,
  };
}

function projectionIsStale(state: SyncStateRow, now: Date): boolean {
  const eventStarted = now.valueOf() >= Date.parse(`${activateRiPotaStartDate}T00:00:00.000Z`);
  if (!eventStarted) return false;
  return !state.last_history_success_at || now.valueOf() - state.last_history_success_at > 2 * 60 * 60_000;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
  }
  return groups;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index]);
    }
  }));
  return results;
}

function millisecondsToIso(value: number | null): string | null {
  return value && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function classifySyncError(error: unknown): string {
  if (error instanceof SyncError) return error.category;
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  return "network";
}

function emptyReconciliation(acquired: boolean, deep: boolean): PotaReconciliationResult {
  return { acquired, deep, attempted: 0, succeeded: 0, failed: 0, evidenceRows: 0, complete: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class SyncError extends Error {
  constructor(readonly category: string) {
    super(category);
  }
}
