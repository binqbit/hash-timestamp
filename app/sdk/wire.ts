/** Anchor representations are derived from the generated IDL, never duplicated. */
import type { IdlTypes } from "@coral-xyz/anchor";
import type { HashTimestamp } from "../../target/types/hash_timestamp";
import type { HashSource, RestoreParametersInput } from "./types";

type WireTypes = IdlTypes<HashTimestamp>;
export type WireHashSource = WireTypes["hashSource"];
export type WireRestoreParameters = WireTypes["restoreParameters"];
export type WireAccountSnapshot = WireTypes["restoreAccountSnapshot"];
export type WireFingerprint = WireTypes["restoreHashFingerprint"];
export type WireProofLink = WireTypes["restoreProofLink"];

// Literal inputs retain their specific variant for useful editor completion.
type Variant<Wire, Kind extends string> = Kind extends string
  ? Extract<Wire, Record<Kind, unknown>>
  : never;
export type EncodedSource<S extends HashSource> = Variant<
  WireHashSource,
  S["kind"]
>;
export type EncodedParameters<P extends RestoreParametersInput> = Variant<
  WireRestoreParameters,
  P["kind"]
>;
