use crate::protocol::hash::branch::branch_hash_digest;
use crate::protocol::hash::compose::{compose_batch, compose_pack, BatchMember};
use crate::protocol::hash::metadata::account_metadata_digest;
use crate::state::HashSource;
use crate::ErrorCode;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use std::collections::{HashMap, HashSet};

use super::graph::ProofGraph;
use super::types::{
    RestoreAccountSnapshot, RestoreHashFingerprint, RestoreParameters, RestoreProofLink,
};

#[derive(Clone)]
pub(super) struct ValidatedEntry {
    hash: [u8; 32],
    source: HashSource,
    created_at: i64,
}

impl ValidatedEntry {
    pub(super) fn new(link: &RestoreProofLink) -> Self {
        Self {
            hash: link.hash,
            source: link.source.clone(),
            created_at: link.created_at,
        }
    }
}

fn hash_account_metadata_from_snapshot(
    account_key: &Pubkey,
    snapshot: &RestoreAccountSnapshot,
) -> [u8; 32] {
    account_metadata_digest(
        account_key,
        &snapshot.owner,
        snapshot.lamports,
        snapshot.executable,
        snapshot.rent_epoch,
        snapshot.data.as_slice(),
    )
}

fn fingerprint_matches_entry(meta: &RestoreHashFingerprint, entry: &ValidatedEntry) -> bool {
    meta.hash == entry.hash
        && meta.source_kind == entry.source.discriminator()
        && meta.created_at == entry.created_at
        && meta.generation == entry.source.generation()
}

fn validate_account_link(
    snapshot: Option<&RestoreAccountSnapshot>,
    account_exists: bool,
    account: &Pubkey,
    expected_hash: &[u8; 32],
) -> Result<()> {
    if let Some(snapshot) = snapshot {
        let recomputed = hash_account_metadata_from_snapshot(account, snapshot);
        if recomputed != *expected_hash {
            return Err(ErrorCode::RestoreProofMismatch.into());
        }
    } else if !account_exists {
        return Err(ErrorCode::RestoreAccountSnapshotMissing.into());
    }

    Ok(())
}

fn validate_hash_link(hash: &[u8; 32], payload: &[u8]) -> Result<()> {
    if payload.is_empty() {
        return Err(ErrorCode::RestoreHashPayloadMissing.into());
    }
    let recomputed = hashv(&[payload]).to_bytes();
    if recomputed != *hash {
        if payload.len() == 32 && payload == hash {
            return Ok(());
        }
        return Err(ErrorCode::RestoreProofMismatch.into());
    }
    Ok(())
}

fn validate_branch_link(
    link: &RestoreProofLink,
    validated: &HashMap<[u8; 32], ValidatedEntry>,
    is_tip: bool,
    parent_meta: &RestoreHashFingerprint,
) -> Result<()> {
    let (previous_hash_id, payload, generation) = match &link.source {
        HashSource::Branch {
            previous_hash_id,
            payload,
            generation,
        } => (previous_hash_id, payload, generation),
        _ => return Err(ErrorCode::RestoreProofMismatch.into()),
    };

    if parent_meta.canonical_id() != *previous_hash_id {
        return Err(ErrorCode::RestoreProofMismatch.into());
    }

    let parent = validated
        .get(previous_hash_id)
        .ok_or(ErrorCode::RestoreDependencyMissing)?;

    if !fingerprint_matches_entry(parent_meta, parent) {
        return Err(if is_tip {
            ErrorCode::RestoreTipMismatch
        } else {
            ErrorCode::RestoreProofMismatch
        }
        .into());
    }

    let expected_generation = parent_meta
        .generation
        .checked_add(1)
        .ok_or(ErrorCode::GenerationOverflow)?;
    if *generation != expected_generation {
        return Err(if is_tip {
            ErrorCode::RestoreTipMismatch
        } else {
            ErrorCode::RestoreGenerationMismatch
        }
        .into());
    }

    let recomputed = branch_hash_digest(
        previous_hash_id,
        parent_meta.source_kind,
        parent_meta.created_at,
        parent_meta.generation,
        payload,
    );
    if recomputed != link.hash {
        return Err(if is_tip {
            ErrorCode::RestoreTipMismatch
        } else {
            ErrorCode::RestoreProofMismatch
        }
        .into());
    }

    Ok(())
}

fn validate_batch_link(
    link: &RestoreProofLink,
    validated: &HashMap<[u8; 32], ValidatedEntry>,
    members_meta: &[RestoreHashFingerprint],
) -> Result<()> {
    let members = match &link.source {
        HashSource::Batch { members } => members,
        _ => return Err(ErrorCode::RestoreProofMismatch.into()),
    };

    if members.is_empty() || members_meta.is_empty() {
        return Err(ErrorCode::BatchMembersEmpty.into());
    }

    if members.len() != members_meta.len() {
        return Err(ErrorCode::RestoreProofMismatch.into());
    }

    let mut batch_members = Vec::with_capacity(members.len());
    for (expected_canonical, meta) in members.iter().zip(members_meta.iter()) {
        if meta.canonical_id() != *expected_canonical {
            return Err(ErrorCode::RestoreProofMismatch.into());
        }

        let entry = validated
            .get(expected_canonical)
            .ok_or(ErrorCode::RestoreDependencyMissing)?;

        if !fingerprint_matches_entry(meta, entry) {
            return Err(ErrorCode::RestoreProofMismatch.into());
        }

        batch_members.push(BatchMember {
            canonical_id: *expected_canonical,
            fingerprint: meta.fingerprint(),
        });
    }

    let composition = compose_batch(&batch_members)?;
    if composition.hash != link.hash || composition.source != link.source {
        return Err(ErrorCode::RestoreProofMismatch.into());
    }

    Ok(())
}

fn validate_pack_link(
    link: &RestoreProofLink,
    validated: &HashMap<[u8; 32], ValidatedEntry>,
    members_meta: &[RestoreHashFingerprint],
) -> Result<()> {
    if members_meta.is_empty() {
        return Err(ErrorCode::RestorePackMembersMissing.into());
    }

    let mut fingerprints = Vec::with_capacity(members_meta.len());
    let mut seen = HashSet::with_capacity(members_meta.len());
    for meta in members_meta.iter() {
        let canonical = meta.canonical_id();
        if !seen.insert(canonical) {
            return Err(ErrorCode::RestoreProofMismatch.into());
        }

        let entry = validated
            .get(&canonical)
            .ok_or(ErrorCode::RestoreDependencyMissing)?;

        if !fingerprint_matches_entry(meta, entry) {
            return Err(ErrorCode::RestoreProofMismatch.into());
        }

        fingerprints.push(meta.fingerprint());
    }

    let recomputed = compose_pack(&fingerprints)?;
    if recomputed != link.hash {
        return Err(ErrorCode::RestoreProofMismatch.into());
    }

    Ok(())
}

pub(super) fn validate_variant(
    link: &RestoreProofLink,
    validated: &HashMap<[u8; 32], ValidatedEntry>,
    account_exists: bool,
    is_tip: bool,
) -> Result<()> {
    let Some(params) = link.params.as_ref() else {
        return match link.source {
            HashSource::Hash => Ok(()),
            _ => Err(ErrorCode::RestoreProofMismatch.into()),
        };
    };

    match (&link.source, params) {
        (HashSource::Hash, RestoreParameters::Hash { payload }) => {
            validate_hash_link(&link.hash, payload)
        }
        (HashSource::Account { account }, RestoreParameters::Account { snapshot }) => {
            validate_account_link(snapshot.as_ref(), account_exists, account, &link.hash)
        }
        (HashSource::Branch { .. }, RestoreParameters::Branch { parent }) => {
            validate_branch_link(link, validated, is_tip, parent)
        }
        (HashSource::Batch { .. }, RestoreParameters::Batch { members }) => {
            validate_batch_link(link, validated, members)
        }
        (HashSource::Pack, RestoreParameters::Pack { members }) => {
            validate_pack_link(link, validated, members)
        }
        _ => Err(ErrorCode::RestoreProofMismatch.into()),
    }
}

/// Validate every proof node in dependency-first order without mutating accounts.
pub(super) fn validate_graph(
    graph: &ProofGraph<'_>,
    existing_indices: &HashSet<usize>,
) -> Result<()> {
    let mut validated = HashMap::with_capacity(graph.entries.len());

    for index in graph.ordered_indices.iter().copied() {
        let entry = graph
            .entries
            .get(index)
            .ok_or(ErrorCode::RestoreProofMismatch)?;

        require!(
            entry.link.created_at != 0,
            ErrorCode::RestoreTimestampMismatch
        );
        validate_variant(
            entry.link,
            &validated,
            existing_indices.contains(&entry.index),
            entry.index == 0,
        )?;
        validated.insert(entry.canonical_id, ValidatedEntry::new(entry.link));
    }

    Ok(())
}

// Anchor's IDL parser needs the module name to match the file stem.
#[cfg(test)]
#[path = "validate_tests.rs"]
mod validate_tests;
