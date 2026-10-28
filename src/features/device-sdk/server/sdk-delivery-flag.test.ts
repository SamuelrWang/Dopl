import { describe, expect, it, vi } from "vitest";
import { sdkDeliveryFor, type SdkDeliveryRpc } from "./sdk-delivery-flag";

const USER = "11111111-1111-4111-8111-111111111111";
const DEV = "22222222-2222-4222-8222-222222222222";

const rpcReturning = (data: unknown, error: { message: string } | null = null) =>
  vi.fn<SdkDeliveryRpc>(async () => ({ data, error }));

describe("sdkDeliveryFor", () => {
  it("calls sdk_delivery_state with the user id", async () => {
    const rpc = rpcReturning([{ enabled: true, device_ids: [DEV] }]);
    await expect(sdkDeliveryFor(USER, rpc)).resolves.toEqual({ on: true, deviceIds: [DEV] });
    expect(rpc).toHaveBeenCalledWith("sdk_delivery_state", { p_user_id: USER });
  });

  it("flag off with a migrated device: off, ids still reported", async () => {
    await expect(sdkDeliveryFor(USER, rpcReturning([{ enabled: false, device_ids: [DEV] }]))).resolves.toEqual({
      on: false,
      deviceIds: [DEV],
    });
  });

  it("🔒 never on without a device, whatever the row says", async () => {
    await expect(sdkDeliveryFor(USER, rpcReturning([{ enabled: true, device_ids: [] }]))).resolves.toEqual({ on: false, deviceIds: [] });
    await expect(sdkDeliveryFor(USER, rpcReturning([{ enabled: true }]))).resolves.toEqual({ on: false, deviceIds: [] });
    await expect(sdkDeliveryFor(USER, rpcReturning([]))).resolves.toEqual({ on: false, deviceIds: [] });
    await expect(sdkDeliveryFor(USER, rpcReturning(null))).resolves.toEqual({ on: false, deviceIds: [] });
  });

  it("🔒 only a literal true enables", async () => {
    await expect(sdkDeliveryFor(USER, rpcReturning([{ enabled: "true", device_ids: [DEV] }]))).resolves.toMatchObject({ on: false });
  });

  it("accepts a single-row object as well as an array", async () => {
    await expect(sdkDeliveryFor(USER, rpcReturning({ enabled: true, device_ids: [DEV] }))).resolves.toEqual({ on: true, deviceIds: [DEV] });
  });

  it("a read error throws (the caller picks its fallback)", async () => {
    await expect(sdkDeliveryFor(USER, rpcReturning(null, { message: "boom" }))).rejects.toThrow(/sdk_delivery_state failed: boom/);
  });

  it("a non-uuid never reaches the database", async () => {
    const rpc = rpcReturning([{ enabled: true, device_ids: [DEV] }]);
    await expect(sdkDeliveryFor("not-a-uuid", rpc)).resolves.toEqual({ on: false, deviceIds: [] });
    expect(rpc).not.toHaveBeenCalled();
  });
});
