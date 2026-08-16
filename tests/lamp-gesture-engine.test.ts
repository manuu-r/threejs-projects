import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MAPPINGS,
  GestureStateMachine,
  WaveDetector,
  solveTwoBoneIK,
} from "../projects/lamp/gestureEngine.ts";

test("requires a sustained high-confidence gesture before acting", () => {
  const machine = new GestureStateMachine();
  const observation = { gesture: "peace" as const, confidence: 0.94 };

  const candidate = machine.update(observation, 1_000, DEFAULT_MAPPINGS);
  assert.equal(candidate.state, "Gesture candidate");
  assert.equal(candidate.triggeredAction, undefined);

  const stillHolding = machine.update(observation, 1_300, DEFAULT_MAPPINGS);
  assert.ok(stillHolding.progress > 0.7 && stillHolding.progress < 1);
  assert.equal(stillHolding.triggeredAction, undefined);

  const confirmed = machine.update(observation, 1_430, DEFAULT_MAPPINGS);
  assert.equal(confirmed.state, "Performing action");
  assert.equal(confirmed.triggeredAction, "friendly");

  const debounced = machine.update(observation, 1_600, DEFAULT_MAPPINGS);
  assert.equal(debounced.triggeredAction, undefined);
});

test("emergency stop confirms far faster than friendly gestures", () => {
  const machine = new GestureStateMachine();
  const stop = { gesture: "open_palm" as const, confidence: 0.98 };
  machine.update(stop, 0, DEFAULT_MAPPINGS);
  const result = machine.update(stop, 115, DEFAULT_MAPPINGS);
  assert.equal(result.triggeredAction, "freeze");
});

test("low-confidence observations cannot trigger an action", () => {
  const machine = new GestureStateMachine();
  const weak = { gesture: "thumbs_up" as const, confidence: 0.7 };
  machine.update(weak, 0, DEFAULT_MAPPINGS);
  const result = machine.update(weak, 2_000, DEFAULT_MAPPINGS);
  assert.equal(result.state, "Idle");
  assert.equal(result.triggeredAction, undefined);
});

test("wave detector requires reversals, travel, and a cooldown", () => {
  const detector = new WaveDetector();
  const samples = [0.35, 0.48, 0.62, 0.47, 0.31, 0.49, 0.64];
  const results = samples.map((x, index) => detector.update(x, index * 100));
  assert.equal(results.at(-1), true);
  assert.equal(detector.update(0.3, 700), false);
});

test("two-bone IK stays finite for unreachable targets", () => {
  for (const [vertical, forward] of [[0, 0], [9, 7], [-4, 3], [0.35, 0.2]]) {
    const solution = solveTwoBoneIK(vertical, forward);
    assert.ok(Number.isFinite(solution.shoulder));
    assert.ok(Number.isFinite(solution.elbow));
    assert.ok(solution.elbow >= 0 && solution.elbow <= Math.PI);
  }
});
