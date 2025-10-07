use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::state::{HashAccount, HashType, PreviousBlock};
use crate::utils::{hash_seed_bundle, SeedBundle};
use crate::ErrorCode;

#[derive(Clone, Copy, Debug)]
pub struct HashSnapshot {
    canonical_id: [u8; 32],
    created_at: i64,
    generation: u64,
    bump: u8,
    voters: u64,
    hash_type: HashType,
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

    pub fn hash_type(&self) -> HashType {
        self.hash_type
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
        hash_type: hash_account.hash_type,
    })
}

pub fn derive_hash(
    program_id: &Pubkey,
    previous: &PreviousBlock,
    new_hash: &[u8; 32],
    hash_type: HashType,
) -> DerivedHash {
    let canonical_id =
        HashAccount::derive_id(&previous.hash_id, previous.created_at, new_hash, hash_type);
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

pub fn new_state(
    previous: PreviousBlock,
    hash: [u8; 32],
    hash_type: HashType,
    bump: u8,
) -> Result<HashAccount> {
    let created_at = Clock::get()?.unix_timestamp;
    Ok(HashAccount {
        previous,
        hash,
        hash_type,
        voters: 1,
        created_at,
        bump,
    })
}

#[derive(Clone, Copy, Debug)]
pub struct BatchMember {
    pub canonical_id: [u8; 32],
    pub created_at: i64,
    pub generation: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct BatchComposition {
    pub previous: PreviousBlock,
    pub hash: [u8; 32],
}

pub fn compose_batch(members: &[BatchMember]) -> Result<BatchComposition> {
    require!(!members.is_empty(), ErrorCode::BatchMembersEmpty);

    let mut created_components: Vec<[u8; 8]> = Vec::with_capacity(members.len());
    let mut generation_components: Vec<[u8; 8]> = Vec::with_capacity(members.len());
    for member in members {
        created_components.push(member.created_at.to_le_bytes());
        generation_components.push(member.generation.to_le_bytes());
    }

    let mut segments: Vec<&[u8]> = Vec::with_capacity(members.len() * 3);
    for (index, member) in members.iter().enumerate() {
        segments.push(member.canonical_id.as_ref());
        segments.push(created_components[index].as_ref());
        segments.push(generation_components[index].as_ref());
    }

    let hash = hashv(&segments).to_bytes();

    Ok(BatchComposition {
        previous: PreviousBlock::default(),
        hash,
    })
}
