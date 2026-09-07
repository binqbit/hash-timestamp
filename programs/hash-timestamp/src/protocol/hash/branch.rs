use crate::{state::HashSource, ErrorCode};
use anchor_lang::prelude::Result;
use anchor_lang::solana_program::hash::hashv;

use super::{AccountFingerprint, HashSnapshot};

pub(crate) fn branch_hash_digest(
    previous_hash_id: &[u8; 32],
    previous_source_kind: u8,
    previous_created_at: i64,
    previous_generation: u64,
    payload: &[u8; 32],
) -> [u8; 32] {
    hashv(&[
        previous_hash_id.as_ref(),
        &[previous_source_kind],
        &previous_created_at.to_le_bytes(),
        &previous_generation.to_le_bytes(),
        payload.as_ref(),
    ])
    .to_bytes()
}

pub(crate) fn branch_hash_from_snapshot(snapshot: &HashSnapshot, payload: &[u8; 32]) -> [u8; 32] {
    let fingerprint = AccountFingerprint::from_snapshot(snapshot);
    branch_hash_digest(
        snapshot.canonical_id(),
        fingerprint.source_kind(),
        snapshot.created_at(),
        snapshot.generation(),
        payload,
    )
}

pub(crate) fn branch_source_from_snapshot(
    snapshot: &HashSnapshot,
    payload: &[u8; 32],
) -> Result<(HashSource, [u8; 32])> {
    let new_hash = branch_hash_from_snapshot(snapshot, payload);
    let generation = snapshot
        .generation()
        .checked_add(1)
        .ok_or(ErrorCode::GenerationOverflow)?;
    let source = HashSource::branch(*snapshot.canonical_id(), *payload, generation);
    Ok((source, new_hash))
}
