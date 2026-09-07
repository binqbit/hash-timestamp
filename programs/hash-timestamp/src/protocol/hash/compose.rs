use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use super::HashSnapshot;
use crate::state::{HashAccount, HashSource};
use crate::ErrorCode;

const FINGERPRINT_SIZE: usize = 32 + 1 + 8;

#[derive(Clone, Copy, Debug)]
pub(crate) struct AccountFingerprint {
    hash: [u8; 32],
    source_kind: u8,
    created_at: i64,
}

impl AccountFingerprint {
    pub(crate) fn from_account(account: &HashAccount) -> Self {
        Self {
            hash: account.hash,
            source_kind: account.source.discriminator(),
            created_at: account.created_at,
        }
    }

    pub(crate) fn from_snapshot(snapshot: &HashSnapshot) -> Self {
        Self {
            hash: *snapshot.hash(),
            source_kind: snapshot.source().discriminator(),
            created_at: snapshot.created_at(),
        }
    }

    pub(crate) fn from_parts(hash: [u8; 32], source_kind: u8, created_at: i64) -> Self {
        Self {
            hash,
            source_kind,
            created_at,
        }
    }

    fn append_to(self, preimage: &mut Vec<u8>) {
        preimage.extend_from_slice(&self.hash);
        preimage.push(self.source_kind);
        preimage.extend_from_slice(&self.created_at.to_le_bytes());
    }

    pub(crate) fn source_kind(&self) -> u8 {
        self.source_kind
    }
}

fn fingerprint_digest(
    fingerprints: &[AccountFingerprint],
    empty_error: ErrorCode,
) -> Result<[u8; 32]> {
    if fingerprints.is_empty() {
        return Err(empty_error.into());
    }

    let mut preimage = Vec::with_capacity(fingerprints.len() * FINGERPRINT_SIZE);
    for fingerprint in fingerprints {
        fingerprint.append_to(&mut preimage);
    }
    Ok(hashv(&[preimage.as_slice()]).to_bytes())
}

pub(crate) fn compose_pack(fingerprints: &[AccountFingerprint]) -> Result<[u8; 32]> {
    fingerprint_digest(fingerprints, ErrorCode::PackMembersEmpty)
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct BatchMember {
    pub(crate) canonical_id: [u8; 32],
    pub(crate) fingerprint: AccountFingerprint,
}

#[derive(Clone, Debug)]
pub(crate) struct BatchComposition {
    pub(crate) source: HashSource,
    pub(crate) hash: [u8; 32],
}

pub(crate) fn compose_batch(members: &[BatchMember]) -> Result<BatchComposition> {
    let fingerprints = members
        .iter()
        .map(|member| member.fingerprint)
        .collect::<Vec<_>>();
    let hash = fingerprint_digest(&fingerprints, ErrorCode::BatchMembersEmpty)?;
    let member_ids = members.iter().map(|member| member.canonical_id).collect();

    Ok(BatchComposition {
        source: HashSource::batch(member_ids),
        hash,
    })
}
