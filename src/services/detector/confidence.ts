/**
 * Confidence scoring - Artupski ReSite
 * Source of truth: docs/specs/TECHNOLOGY-DETECTION.md section 4.1.
 *
 *   C(T) = 1 - ∏ (1 - w_i)   over the distinct matched signals of T
 *
 *   C >= 0.75          -> detected (high confidence)
 *   0.50 <= C < 0.75   -> probable
 *   0.20 <= C < 0.50   -> unknown (low-confidence candidate, suppressed)
 *   C <  0.20          -> not detected
 *
 * This module is pure and deterministic so the scoring model can be tested
 * exhaustively without any evidence or I/O.
 */

import type { ConfidenceStatus } from './types';

/** Aggregate the weighted signals into a single confidence value. */
export function computeConfidence(weights: readonly number[]): number {
  let product = 1;
  for (const weight of weights) {
    const clamped = Math.min(1, Math.max(0, weight));
    product *= 1 - clamped;
  }
  const score = 1 - product;
  // Guard against floating-point drift so identical inputs are identical.
  return Math.min(1, Math.max(0, Number(score.toFixed(6))));
}

/** Classify an aggregate confidence score into a status. */
export function classifyConfidence(score: number): ConfidenceStatus {
  if (score >= 0.75) {
    return 'detected';
  }
  if (score >= 0.5) {
    return 'probable';
  }
  return 'unknown';
}

/** Whether a confidence status should appear in the final report. */
export function isReportable(status: ConfidenceStatus): boolean {
  return status === 'detected' || status === 'probable';
}
