import "server-only";
import { createAdapterRegistry, type AdapterRegistry } from "../adapters/registry";
import { createDesktopAdapter } from "../adapters/desktop";
import { createEvenG2Adapter } from "../adapters/even-g2";
import { createGoogleHomeAdapter } from "../adapters/google-home";
import { failed, type Dispatcher } from "../adapters/shared";
import { createSimulatorAdapter } from "../adapters/simulator";
import { createBridgeDispatcher } from "./bridge/dispatch";
import { createEvenG2Dispatcher } from "./glasses/even-g2-dispatch";
import { sdkGlassesStore } from "./glasses/sdk-glasses-store";

/**
 * The PRODUCTION adapter registry the delivery routes run (A8): `adapters/registry.ts ›
 * deviceAdapters` with the transports wired.
 *
 *   even_g2 → the SDK device's own lens queue (`glasses/even-g2-dispatch.ts`), read by the plugin
 *             through `/api/glasses/device/*` with its `device_credentials` token.
 *   desktop → a typed `capability_unsupported` refusal: the Dopl desktop app receives notices only
 *             as a SIGNED-IN DOPL ACCOUNT (its heartbeat, `desktop_devices`, is keyed to `auth.users`),
 *             and an SDK end user has none (D1). Not a `vendor_error`: retrying will not help.
 *   google_home → the device's own queue (`dev_device_messages`), read by the local Cast bridge on the
 *             user's network through `/api/device-bridge/*` with its `device_credentials` token.
 *   simulator → unchanged.
 */

export const DESKTOP_SDK_DELIVERY_UNAVAILABLE =
  "desktop: delivery to an SDK-owned computer is not available. The Dopl desktop app receives notices only while signed in to a Dopl account.";

export const desktopUnavailable: Dispatcher = async (device) => failed("capability_unsupported", DESKTOP_SDK_DELIVERY_UNAVAILABLE, device.kind);

export const wiredDeviceAdapters: AdapterRegistry = createAdapterRegistry([
  createEvenG2Adapter({ dispatch: createEvenG2Dispatcher({ store: sdkGlassesStore }) }),
  createDesktopAdapter({ dispatch: desktopUnavailable }),
  createGoogleHomeAdapter({ dispatch: createBridgeDispatcher({ store: sdkGlassesStore }) }),
  createSimulatorAdapter(),
]);
