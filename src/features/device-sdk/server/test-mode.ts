import "server-only";
import { failed } from "../adapters/shared";
import { SIMULATOR_ADAPTER_ID, magicFailure } from "../adapters/simulator";
import type { ActionResult, Device, ErrorCode } from "../types";
import type { DeliveryStore, DeviceRow, Scope } from "./delivery-store";

/**
 * TEST MODE (SPEC-v1 › C10, A6): the C10 magic ids for devices a developer can actually create.
 *
 * `TEST_MAGIC_DEVICE_IDS` (`sim_device_offline`, `sim_confirm_denied`) are matched against the
 * DEVICE id by the simulator adapter, but a Connect-created device's id is a database uuid, so that
 * path is reachable only from in-process tests. The reachable path is the END USER: in the `test`
 * env, every `simulator` device of an end user whose `external_user_id` is a magic id — exactly or
 * as `<magic>_<suffix>` (e.g. `sim_device_offline_ci42`) — behaves as that magic id:
 *   - `sim_device_offline` → the device reads offline (context omits it; deliver/actions answer
 *     `device_offline`, retryable);
 *   - `sim_confirm_denied` → every capability call fails `confirmation_denied` (not retryable).
 * ⚠ Matching on `external_user_id` is A6's reading of C10, not a contract change: Samuel to rule.
 *
 * 🔒 NEVER IN LIVE: `simulatorMagicFor` answers null outside `test` and for any adapter but the
 * simulator, so no live device is ever marked.
 */

const forced = new WeakMap<Device, ErrorCode>();

/** The magic failure a `devices` row carries in this scope, by device id or by its end user's id. */
export async function simulatorMagicFor(
  store: Pick<DeliveryStore, "externalUserId">,
  scope: Scope,
  row: Pick<DeviceRow, "id" | "adapter_id" | "end_user_id">
): Promise<ErrorCode | null> {
  if (scope.env !== "test" || row.adapter_id !== SIMULATOR_ADAPTER_ID) return null;
  const byDevice = magicFailure(row.id);
  if (byDevice) return byDevice;
  const externalUserId = await store.externalUserId(scope, row.end_user_id);
  return externalUserId ? magicFailure(externalUserId) : null;
}

/** Remember that `device` (the object `toDevice` built) is forced to fail with `code`. */
export function markForcedFailure(device: Device, code: ErrorCode): void {
  forced.set(device, code);
}

/** The forced C10 failure for a device `toDevice` built, or null. */
export function forcedFailureOf(device: Device): ActionResult | null {
  const code = forced.get(device);
  return code ? failed(code, `simulated ${code} (test-mode magic end user)`, device.kind) : null;
}
