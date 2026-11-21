import { verifyB17IsolatedD1 } from "./b17-isolated-d1.mjs";
import {
  copyB17R2Objects,
  hashB17R2Evidence,
  hashB17R2Manifest,
  reconcileB17R2Copy,
} from "./b17-isolated-r2.mjs";

const MAX_KEYS = 1000;
const REVIEW_SEGMENT = /^[a-zA-Z0-9_-]{1,128}$/;
const REVIEW_KEY = /^reviews\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-]{1,128}\.jpg$/;
const BATCH_ID = /^temp100-[a-f0-9]{16}$/;
const SOURCE_ID = /^temp100-(?:0[0-9][1-9]|0[1-9]0|100)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const D1_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const IMAGE_EXTENSIONS = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);

const REFERENCE_QUERIES = [
  `SELECT id,review_id,object_key,content_type,byte_size
     FROM reviewer_visit_photos LIMIT ${MAX_KEYS + 1}`,
  `SELECT id,batch_id,source_id,json_extract(payload_json,'$.sourceId') AS payload_source_id,
          json_type(payload_json,'$.photo') AS photo_type,
          json_extract(payload_json,'$.photo.contentType') AS content_type,
          json_extract(payload_json,'$.photo.sha256') AS sha256
     FROM temp_catalog_entries
     WHERE json_type(payload_json,'$.photo') IS NOT 'null' LIMIT ${MAX_KEYS + 1}`,
  `SELECT e.id,e.batch_id,e.source_id,b.target_batch_id,s.object_key,
          json_extract(s.payload_json,'$.sourceId') AS payload_source_id,
          json_extract(s.payload_json,'$.contentType') AS content_type,
          json_extract(s.payload_json,'$.sha256') AS sha256,
          (json_type(e.payload_json,'$.photo') IS 'null'
           AND json_extract(e.payload_json,'$.sourceId') IS e.source_id
           AND json_extract(e.payload_json,'$.name') IS json_extract(s.payload_json,'$.name')
           AND json_extract(e.payload_json,'$.address') IS json_extract(s.payload_json,'$.address')
           AND json_extract(s.payload_json,'$.rightsStatus') IS 'UNVERIFIED'
           AND EXISTS (SELECT 1 FROM json_each(b.manifest_json,'$.entries') j
                       WHERE json(j.value)=json(s.payload_json))) AS matched
     FROM temp_photo_supplements s
     LEFT JOIN temp_catalog_entries e ON e.id=s.entry_id
     LEFT JOIN temp_photo_supplement_batches b ON b.id=s.supplement_batch_id
     LIMIT ${MAX_KEYS + 1}`,
  `SELECT 1 FROM temp_photo_supplement_batches b
     WHERE json_type(b.manifest_json,'$.entries') IS NOT 'array'
        OR json_array_length(b.manifest_json,'$.entries') IS NOT 77
        OR json_extract(b.manifest_json,'$.targetBatchId') IS NOT b.target_batch_id
        OR (SELECT count(*) FROM temp_photo_supplements s WHERE s.supplement_batch_id=b.id)<>77
        OR NOT EXISTS (
           SELECT 1 FROM admin_audit_logs a
           WHERE a.id='temp-photo-apply-'||b.id AND a.action='TEMP_PHOTO_SUPPLEMENT_APPLIED'
             AND a.target_type='TEMP_PHOTO_BATCH' AND a.target_id=b.id
             AND json_extract(a.after_state,'$.manifestHash') IS b.manifest_hash
             AND json_extract(a.after_state,'$.targetBatchId') IS b.target_batch_id
             AND json_extract(a.after_state,'$.count') IS 77
             AND json_extract(a.after_state,'$.rightsStatus') IS 'UNVERIFIED')
     LIMIT 1`,
  `SELECT 1 FROM reviewer_photo_cleanup_jobs
     WHERE json_type(object_keys_json) IS NOT 'array' LIMIT 1`,
  `SELECT review_id,purpose,j.atom AS object_key FROM reviewer_photo_cleanup_jobs, json_each(object_keys_json) j
     LIMIT ${MAX_KEYS + 1}`,
  `SELECT review_id FROM reviewer_photo_cleanup_jobs WHERE purpose='DELETE' LIMIT ${MAX_KEYS + 1}`,
  `SELECT DISTINCT hero_image_url FROM places
     WHERE lower(substr(hero_image_url,1,15))='/review-photos/'
        OR lower(substr(hero_image_url,1,13))='/temp-photos/'
     LIMIT ${MAX_KEYS + 1}`,
];

class B17ReferenceError extends Error {}
function requireReference(condition, code) {
  if (!condition) throw new B17ReferenceError(code);
}

function tempReference(row, prefix) {
  const ext = IMAGE_EXTENSIONS.get(row.content_type);
  requireReference(BATCH_ID.test(row.batch_id) && SOURCE_ID.test(row.source_id)
    && row.id === `${row.batch_id}-${row.source_id}` && row.payload_source_id === row.source_id
    && SHA256.test(row.sha256) && ext, "B17_TRANSFER_TEMP_REFERENCE");
  return {
    key: `${prefix}/${row.batch_id}/${row.source_id}-${row.sha256}.${ext}`,
    contentType: row.content_type,
    sha256: row.sha256,
  };
}

// The result contains private object keys. Store it only with the approved transfer evidence.
export async function readB17IsolatedR2References(source) {
  const results = await source.batch(REFERENCE_QUERIES.map(sql => source.prepare(sql)));
  requireReference(Array.isArray(results) && results.length === REFERENCE_QUERIES.length
    && results.every(result => result.success === true && Array.isArray(result.results)
      && result.results.length <= MAX_KEYS), "B17_TRANSFER_REFERENCE_QUERY");
  const [reviewerRows, tempRows, supplementRows, badSupplementBatches, badCleanupJobs, cleanupRows, deletes, heroRows] =
    results.map(result => result.results);
  requireReference(!badSupplementBatches.length, "B17_TRANSFER_TEMP_SUPPLEMENT_MANIFEST");
  requireReference(!badCleanupJobs.length, "B17_TRANSFER_CLEANUP_SHAPE");

  const pendingDeletes = new Set(deletes.map(row => row.review_id));
  const reviewer = reviewerRows.map(row => {
    requireReference(REVIEW_SEGMENT.test(row.id) && REVIEW_SEGMENT.test(row.review_id)
      && row.object_key === `reviews/${row.review_id}/${row.id}.jpg`
      && row.content_type === "image/jpeg" && Number.isSafeInteger(row.byte_size)
      && row.byte_size > 0 && row.byte_size <= 8 * 1024 * 1024, "B17_TRANSFER_REVIEW_REFERENCE");
    requireReference(!pendingDeletes.has(row.review_id), "B17_TRANSFER_CLEANUP_COLLISION");
    return { key: row.object_key, contentType: row.content_type, size: row.byte_size };
  });
  const originals = tempRows.map(row => {
    requireReference(row.photo_type === "object", "B17_TRANSFER_TEMP_REFERENCE");
    return tempReference(row, "temp100");
  });
  const supplements = supplementRows.map(row => {
    const reference = tempReference(row, "temp100-naver");
    requireReference(row.batch_id === row.target_batch_id && row.matched === 1
      && row.object_key === reference.key, "B17_TRANSFER_TEMP_SUPPLEMENT");
    return reference;
  });
  const cleanupKeys = new Set(cleanupRows.map(row => {
    requireReference((row.purpose === "ORPHAN" || row.purpose === "DELETE")
      && REVIEW_SEGMENT.test(row.review_id) && REVIEW_KEY.test(row.object_key)
      && row.object_key.startsWith(`reviews/${row.review_id}/`), "B17_TRANSFER_CLEANUP_SHAPE");
    return row.object_key;
  }));
  const internalPhotoPaths = new Set([
    ...reviewerRows.map(row => `/review-photos/${row.id}`),
    ...[...tempRows, ...supplementRows].map(row => `/temp-photos/${row.id}`),
  ]);
  requireReference(heroRows.every(row => {
    const path = row.hero_image_url.split(/[?#]/, 1)[0];
    const end = path.lastIndexOf("/");
    return internalPhotoPaths.has(path.slice(0, end).toLowerCase() + path.slice(end));
  }), "B17_TRANSFER_HERO_REFERENCE");
  const references = [...reviewer, ...originals, ...supplements];
  requireReference(references.length <= MAX_KEYS && new Set(references.map(row => row.key)).size === references.length,
    "B17_TRANSFER_REFERENCE_COUNT");
  requireReference(references.every(row => !cleanupKeys.has(row.key)), "B17_TRANSFER_CLEANUP_COLLISION");

  return {
    references,
    counts: { reviewer: reviewer.length, originalTemp: originals.length, supplementalTemp: supplements.length,
      heldCleanupKeys: cleanupKeys.size, heldDeleteJobs: pendingDeletes.size },
  };
}

export function assertB17ReferenceCoverage(references, objects) {
  const manifest = new Map(objects.map(object => [object.key, object]));
  requireReference(manifest.size === objects.length && manifest.size === references.length,
    "B17_TRANSFER_R2_COVERAGE");
  for (const reference of references) {
    const object = manifest.get(reference.key);
    requireReference(object && Number.isSafeInteger(object.size) && object.size > 0
      && object.httpMetadata?.contentType === reference.contentType
      && (reference.size === undefined || object.size === reference.size)
      && (reference.sha256 === undefined || object.sha256 === reference.sha256),
    "B17_TRANSFER_R2_REFERENCE_MISMATCH");
  }
}

export function hashB17TransferApproval(approval) {
  return hashB17R2Evidence({
    format: "b17-isolated-transfer-v1",
    sourceD1Id: approval.sourceD1Id,
    candidateD1Id: approval.candidateD1Id,
    d1SnapshotSha256: approval.d1SnapshotSha256,
    r2ManifestSha256: approval.r2ManifestSha256,
    r2LockPlanSha256: approval.r2LockPlanSha256,
  });
}

const hold = code => ({ status: "HOLD", code });

async function readVerifiedSnapshot(d1, expectedSha256) {
  try {
    const evidence = await verifyB17IsolatedD1(d1);
    return evidence.ok && evidence.snapshotSha256 === expectedSha256 ? evidence : null;
  } catch {
    return null;
  }
}

// A trusted driver must identify the actual bound D1 databases. A label alone is not a binding attestation.
export async function runB17IsolatedTransfer(input, adapters) {
  try {
    const { approval, reviewedApprovalSha256, manifest, lockPlan, receipt, expectedReceiptSha256 } = input;
    if (!["copy", "reconcile"].includes(input.mode)
      || !D1_ID.test(approval.sourceD1Id) || !D1_ID.test(approval.candidateD1Id)
      || approval.sourceD1Id === approval.candidateD1Id || adapters.sourceD1 === adapters.candidateD1
      || !SHA256.test(approval.d1SnapshotSha256)
      || hashB17TransferApproval(approval) !== reviewedApprovalSha256
      || hashB17R2Manifest(manifest) !== approval.r2ManifestSha256
      || lockPlan.sha256 !== approval.r2LockPlanSha256) return hold("B17_TRANSFER_APPROVAL");
    const identities = await adapters.d1Identities();
    if (identities.sourceD1Id !== approval.sourceD1Id || identities.candidateD1Id !== approval.candidateD1Id
      || identities.accountId !== manifest.accountId) return hold("B17_TRANSFER_D1_IDENTITY");

    const d1 = { source: adapters.sourceD1, candidate: adapters.candidateD1 };
    const before = await readVerifiedSnapshot(d1, approval.d1SnapshotSha256);
    if (!before) return hold("B17_TRANSFER_D1_BEFORE");
    const { references, counts } = await readB17IsolatedR2References(d1.source);
    assertB17ReferenceCoverage(references, manifest.objects);
    const r2 = { manifest, reviewedManifestSha256: approval.r2ManifestSha256, lockPlan, receipt, expectedReceiptSha256 };
    const result = input.mode === "copy"
      ? await copyB17R2Objects(r2, adapters.r2)
      : await reconcileB17R2Copy(r2, adapters.r2);
    const complete = input.mode === "copy"
      ? result.status === "VERIFIED"
      : result.status === "VERIFIED_RECONCILED" && result.canProceed === true;
    if (!complete) return result;

    const after = await readVerifiedSnapshot(d1, before.snapshotSha256);
    if (!after) return { ...result, ...hold("B17_TRANSFER_D1_AFTER"), canProceed: false };
    return {
      ...result,
      status: "VERIFIED_BASELINE",
      tableCount: after.tableCount,
      d1SnapshotSha256: after.snapshotSha256,
      counts,
    };
  } catch (error) {
    return hold(error instanceof B17ReferenceError ? error.message : "B17_TRANSFER_UNAVAILABLE");
  }
}
