use anchor_lang::solana_program::hash::hashv;

use super::compose::AccountFingerprint;
use super::snapshot::HashSnapshot;

pub fn branch_hash_digest(
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

pub fn branch_hash_from_snapshot(snapshot: &HashSnapshot, payload: &[u8; 32]) -> [u8; 32] {
    let fingerprint = AccountFingerprint::from_snapshot(snapshot);
    branch_hash_digest(
        snapshot.canonical_id(),
        fingerprint.source_kind(),
        snapshot.created_at(),
        snapshot.generation(),
        payload,
    )
}
