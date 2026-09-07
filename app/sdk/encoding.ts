import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  HashBytes,
  HashSource,
  RestoreAccountSnapshotInput,
  RestoreHashFingerprintInput,
  RestoreParametersInput,
} from "./types";
import {
  accountPublicKey,
  asI64,
  asU64,
  coerceBigInt,
  to32Bytes,
  toBigInt,
  toBytes,
} from "./protocol/normalization";
import { normalizeSourceKind } from "./protocol/source";
import type {
  EncodedSource,
  EncodedParameters,
  WireHashSource,
  WireRestoreParameters,
  WireAccountSnapshot,
  WireFingerprint,
} from "./wire";

function pickField(object: unknown, ...keys: string[]): unknown {
  const fields = object as Record<string, unknown> | null;
  for (const key of keys) {
    if (fields && fields[key] !== undefined && fields[key] !== null) {
      return fields[key];
    }
  }
  return undefined;
}

export function decodeHashSource(raw: unknown): HashSource {
  if (!raw || typeof raw !== "object") {
    return { kind: "hash" };
  }

  const entries = Object.entries(raw);
  if (entries.length === 0) {
    return { kind: "hash" };
  }

  const [variantRaw, value] = entries[0];
  const variant = variantRaw.toLowerCase();

  switch (variant) {
    case "hash":
      return { kind: "hash" };
    case "account": {
      const accountValue = pickField(
        value,
        "account",
        "pubkey",
        "pubKey",
        "key"
      );
      const resolved = accountValue ?? value;
      const account = new Uint8Array(
        accountPublicKey(resolved as PublicKey | HashBytes).toBuffer()
      );
      return { kind: "account", account };
    }
    case "branch": {
      const previous = pickField(
        value,
        "previousHashId",
        "previous_hash_id",
        "previousHashID"
      );
      const payload = pickField(value, "payload");
      const generation = pickField(value, "generation") ?? 0;
      if (!previous || !payload) {
        throw new Error("branch source missing previous hash or payload");
      }
      return {
        kind: "branch",
        previousHashId: to32Bytes(previous as HashBytes),
        payload: to32Bytes(payload as HashBytes),
        generation: coerceBigInt(generation),
      };
    }
    case "batch": {
      const membersValue = pickField(value, "members") ?? [];
      const membersArray = Array.isArray(membersValue) ? membersValue : [];
      const normalized = membersArray.map((member) =>
        to32Bytes(member as HashBytes)
      );
      return { kind: "batch", members: normalized };
    }
    case "pack": {
      return { kind: "pack" };
    }
    default:
      return { kind: "hash" };
  }
}

function encodeAccountSnapshot(
  snapshot?: RestoreAccountSnapshotInput
): WireAccountSnapshot | null {
  if (!snapshot) {
    return null;
  }
  const owner = accountPublicKey(snapshot.owner);
  const lamportsBig = toBigInt(snapshot.lamports);
  const rentEpochBig = toBigInt(snapshot.rentEpoch);
  const clampU64 = (value: bigint): bigint => {
    if (value < 0n) {
      return 0n;
    }
    const max = 0xffffffffffffffffn;
    if (value > max) {
      return max;
    }
    return value;
  };
  const lamports = new anchor.BN(clampU64(lamportsBig).toString());
  const rentEpoch = new anchor.BN(clampU64(rentEpochBig).toString());
  const dataBytes = Buffer.from(toBytes(snapshot.data));
  return {
    owner,
    lamports,
    executable: snapshot.executable,
    rentEpoch,
    data: dataBytes,
  };
}

export function encodeHashSource<S extends HashSource>(
  source: S
): EncodedSource<S>;
export function encodeHashSource(source: HashSource): WireHashSource {
  switch (source.kind) {
    case "hash":
      return { hash: {} };
    case "account": {
      const key = accountPublicKey(source.account);
      return { account: { account: key } };
    }
    case "branch": {
      return {
        branch: {
          previousHashId: [...to32Bytes(source.previousHashId)],
          payload: [...to32Bytes(source.payload)],
          generation: new anchor.BN(asU64(source.generation).toString()),
        },
      };
    }
    case "batch": {
      return {
        batch: {
          members: source.members.map((m) => [...to32Bytes(m)]),
        },
      };
    }
    case "pack":
      return { pack: {} };
    default:
      return { hash: {} };
  }
}

function encodeFingerprint(
  fingerprint: RestoreHashFingerprintInput
): WireFingerprint {
  return {
    hash: [...to32Bytes(fingerprint.hash)],
    sourceKind: normalizeSourceKind(fingerprint.sourceKind),
    createdAt: new anchor.BN(asI64(fingerprint.createdAt).toString()),
    generation: new anchor.BN(asU64(fingerprint.generation).toString()),
  };
}

export function encodeRestoreParameters<P extends RestoreParametersInput>(
  params: P
): EncodedParameters<P>;
export function encodeRestoreParameters(
  params: RestoreParametersInput
): WireRestoreParameters {
  switch (params.kind) {
    case "hash": {
      const payloadBytes = Buffer.from(toBytes(params.payload));
      return { hash: { payload: payloadBytes } };
    }
    case "account":
      return {
        account: {
          snapshot: encodeAccountSnapshot(params.snapshot),
        },
      };
    case "branch":
      return {
        branch: {
          parent: encodeFingerprint(params.parent),
        },
      };
    case "batch":
      return {
        batch: {
          members: params.members.map(encodeFingerprint),
        },
      };
    case "pack":
      return {
        pack: {
          members: params.members.map(encodeFingerprint),
        },
      };
    default:
      throw new Error("Unsupported restore parameters variant");
  }
}
