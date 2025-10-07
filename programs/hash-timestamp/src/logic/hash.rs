use anchor_lang::prelude::*;

use crate::state::{HashAccount, PreviousBlock};
use crate::utils::{hash_seed_bundle, SeedBundle};
use crate::ErrorCode;

#[derive(Clone, Copy, Debug)]
pub struct HashSnapshot {
    canonical_id: [u8; 32],
    created_at: i64,
    generation: u64,
    bump: u8,
    voters: u64,
}

impl HashSnapshot {
    pub fn canonical_id(&self) -> &[u8; 32] {
        &self.canonical_id
    }

    pub fn created_at(&self) -> i64 {
        self.created_at
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn voters(&self) -> u64 {
        self.voters
    }

    pub fn previous_block(&self) -> PreviousBlock {
        PreviousBlock {
            hash_id: self.canonical_id,
            created_at: self.created_at,
            generation: self.generation,
        }
    }

    pub fn bump(&self) -> u8 {
        self.bump
    }
}

#[derive(Clone, Debug)]
pub struct DerivedHash {
    canonical_id: [u8; 32],
    pub key: Pubkey,
    pub bump: u8,
}

impl DerivedHash {
    pub fn canonical_id(&self) -> &[u8; 32] {
        &self.canonical_id
    }

    pub fn seeds(&self) -> SeedBundle {
        hash_seed_bundle(&self.canonical_id, self.bump)
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
        created_at: hash_account.created_at,
        generation: hash_account.current_generation(),
        bump: hash_account.bump,
        voters: hash_account.voters,
    })
}

pub fn derive_hash(
    program_id: &Pubkey,
    previous: &PreviousBlock,
    new_hash: &[u8; 32],
) -> DerivedHash {
    let canonical_id = HashAccount::derive_id(&previous.hash_id, previous.created_at, new_hash);
    let (pda, bump) = HashAccount::derive_pda(program_id, &canonical_id);
    DerivedHash {
        canonical_id,
        key: pda,
        bump,
    }
}

pub fn genesis_previous_block() -> PreviousBlock {
    PreviousBlock::default()
}

pub fn new_state(previous: PreviousBlock, hash: [u8; 32], bump: u8) -> Result<HashAccount> {
    let created_at = Clock::get()?.unix_timestamp;
    Ok(HashAccount {
        previous,
        hash,
        voters: 1,
        created_at,
        bump,
    })
}
