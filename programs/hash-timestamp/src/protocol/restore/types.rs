use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::protocol::hash::compose::AccountFingerprint;
use crate::state::{HashAccount, HashSource};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RestoreAccountSnapshot {
    pub owner: Pubkey,
    pub lamports: u64,
    pub executable: bool,
    pub rent_epoch: u64,
    pub data: Vec<u8>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RestoreHashFingerprint {
    pub hash: [u8; 32],
    pub source_kind: u8,
    pub created_at: i64,
    pub generation: u64,
}

impl RestoreHashFingerprint {
    pub(crate) fn canonical_id(&self) -> [u8; 32] {
        hashv(&[self.hash.as_ref(), &[self.source_kind]]).to_bytes()
    }

    pub(super) fn fingerprint(&self) -> AccountFingerprint {
        AccountFingerprint::from_parts(self.hash, self.source_kind, self.created_at)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum RestoreParameters {
    Hash {
        payload: Vec<u8>,
    },
    Account {
        snapshot: Option<RestoreAccountSnapshot>,
    },
    Branch {
        parent: RestoreHashFingerprint,
    },
    Batch {
        members: Vec<RestoreHashFingerprint>,
    },
    Pack {
        members: Vec<RestoreHashFingerprint>,
    },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RestoreProofLink {
    pub hash: [u8; 32],
    pub source: HashSource,
    pub created_at: i64,
    pub params: Option<RestoreParameters>,
}

impl RestoreProofLink {
    pub(crate) fn canonical_id(&self) -> [u8; 32] {
        HashAccount::derive_id(&self.source, &self.hash)
    }
}
