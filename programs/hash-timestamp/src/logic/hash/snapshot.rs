use anchor_lang::prelude::*;

use crate::state::{HashAccount, HashSource};
use crate::ErrorCode;

#[derive(Clone, Debug)]
pub struct HashSnapshot {
    canonical_id: [u8; 32],
    hash: [u8; 32],
    source: HashSource,
    created_at: i64,
    bump: u8,
    voters: u64,
}

impl HashSnapshot {
    pub fn canonical_id(&self) -> &[u8; 32] {
        &self.canonical_id
    }

    pub fn hash(&self) -> &[u8; 32] {
        &self.hash
    }

    pub fn source(&self) -> &HashSource {
        &self.source
    }

    pub fn created_at(&self) -> i64 {
        self.created_at
    }

    pub fn generation(&self) -> u64 {
        self.source.generation()
    }

    pub fn voters(&self) -> u64 {
        self.voters
    }

    pub fn bump(&self) -> u8 {
        self.bump
    }

    pub fn space(&self) -> usize {
        self.source.space()
    }
}

pub fn ensure_initialized<'info>(
    hash_account: &Account<'info, HashAccount>,
    program_id: &Pubkey,
) -> Result<HashSnapshot> {
    require!(hash_account.created_at != 0, ErrorCode::HashNotFound);
    hash_account.verify_account(program_id, &hash_account.to_account_info())?;
    Ok(HashSnapshot {
        canonical_id: hash_account.canonical_id(),
        hash: hash_account.hash,
        source: hash_account.source.clone(),
        created_at: hash_account.created_at,
        bump: hash_account.bump,
        voters: hash_account.voters,
    })
}
