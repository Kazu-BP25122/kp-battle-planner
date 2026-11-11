/**
 * 操作の列を先頭から再生して、各時点の状態を求める（§4.10、§4.12）。
 * エンジンはブランチの仕組みを知らない。呼び出し側が根から先端までの操作を渡す。
 */
import type { Op } from "../schema/chart";
import { Battle, cloneState } from "./battle";
import type { BattleState, EngineInput, EngineOptions, OpResult } from "./types";

export interface ReplayStep {
  result: OpResult;
  /** この操作の後の状態 */
  state: BattleState;
}

export interface ReplayResult {
  /** 操作をする前（戦闘開始・1 ターン目のターン開始処理の後）の状態 */
  initial: BattleState;
  steps: ReplayStep[];
  battle: Battle;
}

export function replay(input: EngineInput, ops: readonly Op[], options: EngineOptions = {}): ReplayResult {
  const battle = new Battle(input, options);
  const initial = cloneState(battle.state);
  const steps: ReplayStep[] = [];
  for (const op of ops) {
    const result = battle.apply(op);
    steps.push({ result, state: cloneState(battle.state) });
  }
  return { initial, steps, battle };
}

/** i 番目の操作の後の状態（-1 なら操作前） */
export function stateAt(r: ReplayResult, index: number): BattleState {
  if (index < 0) return r.initial;
  return r.steps[index]?.state ?? r.initial;
}
