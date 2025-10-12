use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use super::snapshot::HashSnapshot;
use crate::state::{HashAccount, HashSource};
use crate::ErrorCode;

#[derive(Clone, Copy, Debug)]
pub struct AccountFingerprint {
    hash: [u8; 32],
    source_kind: u8,
    created_at: i64,
}

impl AccountFingerprint {
    pub fn from_account(account: &HashAccount) -> Self {
        Self {
            hash: account.hash,
            source_kind: account.source.discriminator(),
            created_at: account.created_at,
        }
    }

    pub fn from_snapshot(snapshot: &HashSnapshot) -> Self {
        Self {
            hash: *snapshot.hash(),
            source_kind: snapshot.source().discriminator(),
            created_at: snapshot.created_at(),
        }
    }

    pub fn segments(&self) -> [Vec<u8>; 3] {
        [
            self.hash.to_vec(),
            vec![self.source_kind],
            self.created_at.to_le_bytes().to_vec(),
        ]
    }

    pub fn source_kind(&self) -> u8 {
        self.source_kind
    }
}

pub fn compose_pack(fingerprints: &[AccountFingerprint]) -> Result<[u8; 32]> {
    require!(!fingerprints.is_empty(), ErrorCode::PackMembersEmpty);

    let mut buffers: Vec<Vec<u8>> = Vec::with_capacity(fingerprints.len() * 3);
    for fingerprint in fingerprints {
        let parts = fingerprint.segments();
        buffers.extend(parts.into_iter());
    }

    let segments: Vec<&[u8]> = buffers.iter().map(|buf| buf.as_slice()).collect();
    Ok(hashv(&segments).to_bytes())
}

#[derive(Clone, Copy, Debug)]
pub struct BatchMember {
    pub canonical_id: [u8; 32],
    pub fingerprint: AccountFingerprint,
}

#[derive(Clone, Debug)]
pub struct BatchComposition {
    pub source: HashSource,
    pub hash: [u8; 32],
}

pub fn compose_batch(members: &[BatchMember]) -> Result<BatchComposition> {
    require!(!members.is_empty(), ErrorCode::BatchMembersEmpty);

    let mut buffers: Vec<Vec<u8>> = Vec::with_capacity(members.len() * 3);
    for member in members {
        let parts = member.fingerprint.segments();
        buffers.extend(parts.into_iter());
    }
    let segments: Vec<&[u8]> = buffers.iter().map(|buf| buf.as_slice()).collect();

    let hash = hashv(&segments).to_bytes();
    let member_ids: Vec<[u8; 32]> = members.iter().map(|m| m.canonical_id).collect();

    Ok(BatchComposition {
        source: HashSource::batch(member_ids),
        hash,
    })
}
