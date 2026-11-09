/**
 * Image-transform evidence and survey evidence are different claims.
 * A sampled JPEG/GeoTIFF registration can make horizontal estimates usable
 * without becoming a ground survey. Dimensions, roundtrips, and correlation
 * residuals never open safe_for_authoritative_measurement.
 */

export const APPROXIMATE_DISTANCE_LABEL = "Approximate horizontal distance; ground accuracy unverified";

const PRIVATE_KEYS = new Set([
  "source_path",
  "tiff_path",
  "jpeg_path",
  "pc_numeric_analysis_log",
  "source_machine_id",
  "machine_id",
]);

const PRIVATE_TEXT = /(?:\/home\/|\/Users\/|\\Users\\|terminals\/\d+\.txt)[^\s'"]*/g;
const PRIVATE_KEY = /path|password|passwd|secret|token|serial|credential|machine_id/i;

function scrubText(text) {
  return text.replace(PRIVATE_TEXT, "[private-path]");
}

function stripPrivate(value) {
  if (typeof value === "string") {
    const next = scrubText(value);
    return next.includes("[private-path]") && next.trim() === "[private-path]" ? undefined : next;
  }
  if (Array.isArray(value)) return value.map(stripPrivate).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key) || PRIVATE_KEY.test(key)) continue;
    const next = stripPrivate(entry);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

function surveyRecord(record) {
  return Boolean(
    record
    && record.explicitly_validated === true
    && record.survey_accuracy_validated === true
    && typeof record.method === "string"
    && record.method.trim()
    && typeof record.approved_by === "string"
    && record.approved_by.trim(),
  );
}

export function evaluateCalibration(metadata) {
  const record = metadata?.validated_calibration ?? null;
  const survey = surveyRecord(record) && metadata?.survey_accuracy_validated === true && metadata?.safe_for_authoritative_measurement === true;
  const imageReady = metadata?.image_transform_validated === true && metadata?.horizontal_estimates_ready === true;
  let status = "unverified";
  let banner = "JPEG-to-raster registration is not validated. Horizontal figures use the candidate affine only. No positional accuracy is claimed.";
  let distanceLabel = "Candidate-affine horizontal estimate. Image registration is not validated. No positional accuracy is claimed.";
  if (survey) {
    status = "validated";
    banner = "Survey calibration recorded. Field use still depends on the recorded method.";
    distanceLabel = "Survey-calibrated horizontal distance";
  } else if (imageReady) {
    status = "approximate";
    banner = `${APPROXIMATE_DISTANCE_LABEL}. The sampled image transform is validated. This is not a survey.`;
    distanceLabel = APPROXIMATE_DISTANCE_LABEL;
  }
  return {
    safe_for_authoritative_measurement: survey,
    survey_accuracy_validated: survey,
    image_transform_validated: metadata?.image_transform_validated === true,
    horizontal_estimates_ready: metadata?.horizontal_estimates_ready === true,
    status,
    banner,
    distanceLabel,
    explicit_validation: survey,
    downgraded: metadata?.safe_for_authoritative_measurement === true && !survey,
    numeric_consistency_is_not_validation: true,
    registration_residual_is_not_ground_accuracy: true,
    calibration_status: metadata?.calibration_status ?? null,
  };
}

/**
 * Store a later calibration. Image-transform flags may update the working
 * affine and the approximate-distance label. Only an explicit ground-survey
 * record opens the authoritative gate.
 */
export function proposeCalibration(metadata, proposal) {
  const next = stripPrivate({
    ...metadata,
    candidate_georeferencing: proposal?.candidate_georeferencing
      ? proposal.candidate_georeferencing
      : metadata.candidate_georeferencing,
  });
  if (proposal?.image_transform_validated === true) next.image_transform_validated = true;
  if (proposal?.horizontal_estimates_ready === true) next.horizontal_estimates_ready = true;
  if (typeof proposal?.calibration_status === "string") next.calibration_status = proposal.calibration_status;
  const record = proposal?.validated_calibration ?? null;
  if (!surveyRecord(record)) {
    next.safe_for_authoritative_measurement = false;
    next.survey_accuracy_validated = false;
    next.validated_calibration = record
      ? { ...stripPrivate(record), explicitly_validated: false, survey_accuracy_validated: false }
      : null;
    if (!next.calibration_status || next.calibration_status === "EXPLICITLY_VALIDATED" || next.calibration_status === "SURVEY_VALIDATED") {
      next.calibration_status = next.image_transform_validated
        ? "IMAGE_TRANSFORM_VALIDATED_BY_SAMPLED_REGISTRATION_NOT_SURVEY"
        : "CANDIDATE_NOT_EXPLICITLY_VALIDATED";
    }
    return next;
  }
  next.validated_calibration = {
    explicitly_validated: true,
    survey_accuracy_validated: true,
    method: String(record.method).trim(),
    approved_by: String(record.approved_by).trim(),
    note: record.note ? String(record.note) : "",
    recorded_at: record.recorded_at || new Date().toISOString(),
  };
  next.safe_for_authoritative_measurement = true;
  next.survey_accuracy_validated = true;
  next.calibration_status = "SURVEY_VALIDATED";
  return next;
}

function finiteTransform(value) {
  return Array.isArray(value) && value.length === 6 && value.every((item) => Number.isFinite(item));
}

/**
 * Apply an Atlas calibration or metadata file. A new affine is used at once
 * for horizontal estimates. Image-transform validation does not become survey
 * accuracy. Local filesystem paths are removed before the result is kept.
 */
export function importCalibration(metadata, doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    const error = new Error("Calibration import must be a JSON object");
    error.code = "CALIBRATION";
    throw error;
  }
  const clean = stripPrivate(doc);
  const candidate = clean.candidate_georeferencing && typeof clean.candidate_georeferencing === "object"
    ? clean.candidate_georeferencing
    : null;
  const transform = candidate?.gdal_geotransform || clean.gdal_geotransform;
  if (transform != null && !finiteTransform(transform)) {
    const error = new Error("gdal_geotransform must be six finite numbers");
    error.code = "CALIBRATION";
    throw error;
  }
  const roundtripOnly = clean.numeric_roundtrip_ok === true
    || clean.basis === "roundtrip"
    || clean.basis === "dimensions"
    || clean.validation_basis === "numeric-roundtrip";
  let record = clean.validated_calibration ?? null;
  if (roundtripOnly && !surveyRecord(record)) record = null;
  if (record && record.survey_accuracy_validated !== true) record = { ...record, survey_accuracy_validated: false, explicitly_validated: false };
  const next = proposeCalibration(metadata, {
    candidate_georeferencing: transform
      ? {
        ...(metadata.candidate_georeferencing || {}),
        ...(candidate || {}),
        gdal_geotransform: [...transform],
      }
      : undefined,
    validated_calibration: record,
    image_transform_validated: clean.image_transform_validated === true ? true : undefined,
    horizontal_estimates_ready: clean.horizontal_estimates_ready === true ? true : undefined,
    calibration_status: typeof clean.calibration_status === "string" ? clean.calibration_status : undefined,
  });
  if (clean.image_transform_validated === true) next.image_transform_validated = true;
  if (clean.horizontal_estimates_ready === true) next.horizontal_estimates_ready = true;
  if (clean.accuracy) next.accuracy = clean.accuracy;
  if (Array.isArray(clean.blockers)) next.blockers = clean.blockers;
  next.calibration_imported_at = new Date().toISOString();
  return stripPrivate(next);
}
